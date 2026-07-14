/**
 * Kevin Circuit Breaker — Phase 3
 *
 * Process-local circuit breaker protecting all Kevin/Hermes outbound calls.
 *
 * States: closed → open → half_open → closed
 * - closed:    all calls pass through
 * - open:      all calls fast-fail (Kevin unreachable)
 * - half_open: one probe call allowed to test recovery
 *
 * NOTE: Process-local only. In multi-instance deployments each instance
 * maintains its own state. A distributed breaker would require shared storage.
 * Document this limitation explicitly.
 *
 * Validation errors from TrainEfficiency input are NOT counted as Kevin failures.
 */

import { recordKevinAuditEvent } from "./kevin-audit-service";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  lastProbeAt: string | null;
  nextAllowedAt: string | null;
  note: string;
}

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 60_000;
const ROLLING_WINDOW_MS = 60_000;

let state: CircuitState = "closed";
let failureCount = 0;
let openedAt: number | null = null;
let lastFailureAt: number | null = null;
let lastProbeAt: number | null = null;
let windowStart = Date.now();

function resetWindow() {
  windowStart = Date.now();
  failureCount = 0;
}

export function getCircuitState(): CircuitState {
  if (state === "open" && openedAt !== null) {
    if (Date.now() - openedAt >= OPEN_DURATION_MS) {
      state = "half_open";
      lastProbeAt = null;
    }
  }
  return state;
}

export function getCircuitStatus(): CircuitBreakerStatus {
  const current = getCircuitState();
  const nextAllowed =
    state === "open" && openedAt !== null
      ? new Date(openedAt + OPEN_DURATION_MS).toISOString()
      : null;
  return {
    state: current,
    failures: failureCount,
    lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : null,
    openedAt: openedAt ? new Date(openedAt).toISOString() : null,
    lastProbeAt: lastProbeAt ? new Date(lastProbeAt).toISOString() : null,
    nextAllowedAt: nextAllowed,
    note:
      current === "closed"
        ? "All calls allowed"
        : current === "open"
          ? "Kevin calls blocked — circuit open after failures"
          : "Probe call allowed to test Kevin recovery",
  };
}

/**
 * Returns true if a call should be allowed through.
 * half_open: allows exactly one probe (marks lastProbeAt).
 */
export function isCallAllowed(): boolean {
  const s = getCircuitState();
  if (s === "closed") return true;
  if (s === "open") return false;
  // half_open: allow one probe if no probe in-flight
  if (lastProbeAt === null) {
    lastProbeAt = Date.now();
    return true;
  }
  // Probe already in-flight (pending result) — block subsequent calls
  return false;
}

/**
 * Record a qualifying failure.
 * Pass `isValidationError = true` for TrainEfficiency-side validation failures
 * that should NOT count against Kevin's availability.
 */
export async function recordCircuitFailure(
  err: Error | string,
  isValidationError = false,
): Promise<void> {
  if (isValidationError) return;

  const now = Date.now();
  lastFailureAt = now;

  // Roll window
  if (now - windowStart > ROLLING_WINDOW_MS) resetWindow();
  failureCount++;

  if (state === "half_open") {
    // Probe failed — reopen
    state = "open";
    openedAt = now;
    lastProbeAt = null;
    void recordKevinAuditEvent({
      eventType: "circuit_breaker.reopened",
      payload: {
        reason: "half_open probe failed",
        error: String(err).slice(0, 300),
        failures: failureCount,
      },
    });
    return;
  }

  if (state === "closed" && failureCount >= FAILURE_THRESHOLD) {
    state = "open";
    openedAt = now;
    void recordKevinAuditEvent({
      eventType: "circuit_breaker.opened",
      payload: {
        reason: `${failureCount} failures in rolling window`,
        error: String(err).slice(0, 300),
        failures: failureCount,
      },
    });
  }
}

/**
 * Record a successful call.
 * Closes the circuit if in half_open.
 */
export async function recordCircuitSuccess(): Promise<void> {
  if (state === "half_open") {
    state = "closed";
    openedAt = null;
    lastProbeAt = null;
    resetWindow();
    void recordKevinAuditEvent({
      eventType: "circuit_breaker.closed",
      payload: { reason: "half_open probe succeeded" },
    });
  } else if (state === "closed") {
    // Decay: partial success reduces failure count
    if (failureCount > 0) failureCount = Math.max(0, failureCount - 1);
  }
}

/**
 * Wrap any async Kevin call with circuit-breaker protection.
 * Returns undefined (fail-open) when the circuit is open.
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  fallback?: T,
): Promise<T | undefined> {
  if (!isCallAllowed()) {
    return fallback;
  }
  try {
    const result = await fn();
    await recordCircuitSuccess();
    return result;
  } catch (err: any) {
    await recordCircuitFailure(err);
    return fallback;
  }
}
