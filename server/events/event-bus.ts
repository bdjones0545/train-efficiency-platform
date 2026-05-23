/**
 * Event Bus — Phase 4
 *
 * Lightweight internal pub/sub event bus for TrainEfficiency's cross-agent
 * intelligence network. Built on Node.js EventEmitter, wrapped with:
 *   - Typed event payloads (EventPayloadMap)
 *   - Idempotency deduplication (per event type + idempotency key)
 *   - Non-blocking async dispatch (setImmediate + isolated error handling)
 *   - In-memory recent event ring buffer (last 500 events per org)
 *   - Subscriber registration with named handler IDs for clean unsubscription
 *   - Per-handler retry logic (up to 2 retries with exponential backoff)
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type {
  EventType,
  EventPayloadMap,
  SystemEvent,
  EventMetadata,
} from "./event-types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventHandler<T extends EventType = EventType> = (
  event: SystemEvent<EventPayloadMap[T]>
) => Promise<void> | void;

interface HandlerRegistration {
  handlerId: string;
  eventType: EventType;
  handler: EventHandler<any>;
  subscriberName: string;
}

interface RecentEvent {
  eventId: string;
  type: EventType;
  meta: EventMetadata;
  payload: unknown;
  receivedAt: string;
  handlerResults: { subscriber: string; success: boolean; error?: string }[];
}

// ─── EventBus Implementation ──────────────────────────────────────────────────

class TrainEventBus {
  private emitter = new EventEmitter();
  private handlers = new Map<string, HandlerRegistration>();
  private processedKeys = new Set<string>();
  private recentEvents: RecentEvent[] = [];
  private readonly RING_BUFFER_SIZE = 500;
  private readonly MAX_RETRIES = 2;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  /**
   * Publish an event to all subscribers.
   * Non-blocking — handlers run asynchronously via setImmediate.
   * Idempotent — duplicate events (same type + idempotency key) are dropped.
   */
  publish<T extends EventType>(
    type: T,
    payload: EventPayloadMap[T],
    meta: Omit<EventMetadata, "eventId" | "timestamp">
  ): string {
    const eventId = randomUUID();
    const timestamp = new Date().toISOString();

    // Idempotency check
    if (meta.idempotencyKey) {
      const dedupKey = `${type}:${meta.idempotencyKey}`;
      if (this.processedKeys.has(dedupKey)) {
        return eventId;
      }
      this.processedKeys.add(dedupKey);
      // Clean old keys every 10k entries
      if (this.processedKeys.size > 10000) {
        const arr = [...this.processedKeys];
        arr.splice(0, 5000).forEach(k => this.processedKeys.delete(k));
      }
    }

    const fullMeta: EventMetadata = { ...meta, eventId, timestamp };
    const event: SystemEvent<EventPayloadMap[T]> = { type, meta: fullMeta, payload };

    // Track in ring buffer
    const entry: RecentEvent = {
      eventId,
      type,
      meta: fullMeta,
      payload,
      receivedAt: timestamp,
      handlerResults: [],
    };
    this.recentEvents.push(entry);
    if (this.recentEvents.length > this.RING_BUFFER_SIZE) {
      this.recentEvents.shift();
    }

    // Dispatch non-blocking
    setImmediate(() => {
      this.emitter.emit(type, event, entry);
    });

    return eventId;
  }

  /**
   * Subscribe to an event type. Returns a handlerId for unsubscription.
   */
  subscribe<T extends EventType>(
    eventType: T,
    handler: EventHandler<T>,
    subscriberName: string
  ): string {
    const handlerId = randomUUID();

    const wrappedHandler = async (event: SystemEvent<EventPayloadMap[T]>, entry: RecentEvent) => {
      let lastError: string | undefined;
      let success = false;

      for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          await handler(event);
          success = true;
          break;
        } catch (err: any) {
          lastError = err?.message ?? String(err);
          if (attempt < this.MAX_RETRIES) {
            await new Promise(res => setTimeout(res, 200 * Math.pow(2, attempt)));
          }
        }
      }

      if (!success) {
        console.error(
          `[EventBus] Handler "${subscriberName}" failed for event "${eventType}" (eventId=${event.meta.eventId}): ${lastError}`
        );
      }

      if (entry) {
        entry.handlerResults.push({ subscriber: subscriberName, success, error: lastError });
      }
    };

    this.handlers.set(handlerId, { handlerId, eventType, handler, subscriberName });
    this.emitter.on(eventType, wrappedHandler);

    // Store the wrapped handler so we can remove it on unsubscribe
    (this.handlers.get(handlerId) as any)._wrapped = wrappedHandler;

    return handlerId;
  }

  /**
   * Unsubscribe a handler by handlerId.
   */
  unsubscribe(handlerId: string): void {
    const reg = this.handlers.get(handlerId) as any;
    if (!reg) return;
    this.emitter.off(reg.eventType, reg._wrapped);
    this.handlers.delete(handlerId);
  }

  /**
   * Get recent events from the ring buffer (optionally filtered by orgId or type).
   */
  getRecentEvents(opts?: { orgId?: string; type?: EventType; limit?: number }): RecentEvent[] {
    let events = [...this.recentEvents].reverse();
    if (opts?.orgId) events = events.filter(e => e.meta.orgId === opts.orgId);
    if (opts?.type) events = events.filter(e => e.type === opts.type);
    return events.slice(0, opts?.limit ?? 50);
  }

  /**
   * Get all registered subscriber names (for diagnostics).
   */
  getSubscriberList(): Array<{ handlerId: string; eventType: string; subscriberName: string }> {
    return [...this.handlers.values()].map(h => ({
      handlerId: h.handlerId,
      eventType: h.eventType,
      subscriberName: h.subscriberName,
    }));
  }

  /**
   * Get stats about the event bus.
   */
  getStats(): { subscriberCount: number; recentEventCount: number; processedKeyCount: number } {
    return {
      subscriberCount: this.handlers.size,
      recentEventCount: this.recentEvents.length,
      processedKeyCount: this.processedKeys.size,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const eventBus = new TrainEventBus();

/**
 * Convenience function: publish with org + source system context.
 */
export function publishEvent<T extends EventType>(
  type: T,
  payload: EventPayloadMap[T],
  context: {
    orgId: string;
    sourceSystem: string;
    athleteUserId?: string;
    coachUserId?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }
): string {
  return eventBus.publish(type, payload, context);
}

/**
 * Convenience function: subscribe with a named subscriber.
 */
export function subscribeToEvent<T extends EventType>(
  type: T,
  handler: EventHandler<T>,
  subscriberName: string
): string {
  return eventBus.subscribe(type, handler, subscriberName);
}
