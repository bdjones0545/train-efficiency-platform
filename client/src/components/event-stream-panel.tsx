/**
 * Event Stream Panel — Phase 4
 *
 * Live view of the organization's event bus ring buffer.
 * Shows recent events flowing through the intelligence network,
 * active subscribers, and bus diagnostics.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Loader2, Radio, Zap, Activity, Users } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentEvent {
  eventId: string;
  type: string;
  meta: {
    timestamp: string;
    sourceSystem: string;
    orgId: string;
    athleteUserId?: string;
  };
  payload: Record<string, any>;
  handlerResults: Array<{ subscriber: string; success: boolean; error?: string }>;
}

interface Subscriber {
  handlerId: string;
  eventType: string;
  subscriberName: string;
}

interface EventStreamData {
  recentEvents: RecentEvent[];
  stats: { subscriberCount: number; recentEventCount: number; processedKeyCount: number };
  subscribers: Subscriber[];
  orgId: string;
}

interface Props {
  orgId: string;
  headers: Record<string, string>;
  compact?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventTypeColor(type: string): string {
  if (type.includes("pain") || type.includes("escalation")) return "bg-red-500/20 text-red-400 border-red-500/30";
  if (type.includes("risk.escalated") || type.includes("compliance")) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (type.includes("approved") || type.includes("completed")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (type.includes("intervention") || type.includes("readiness")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (type.includes("org.")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  return "bg-muted/20 text-muted-foreground border-border/30";
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatEventType(type: string): string {
  return type.replace(/\./g, " · ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventStreamPanel({ orgId, headers, compact }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/org/intelligence/event-stream", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/org/intelligence/event-stream?limit=${compact ? 10 : 20}`, { headers });
      if (!res.ok) throw new Error("Failed to load event stream");
      return res.json() as Promise<EventStreamData>;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading event stream…
    </div>
  );

  const events = data?.recentEvents ?? [];
  const stats = data?.stats;
  const subscribers = data?.subscribers ?? [];

  return (
    <div className="space-y-3" data-testid="event-stream-panel">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold">Intelligence Event Stream</h3>
        {stats && (
          <div className="flex items-center gap-1 ml-auto">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Live</span>
          </div>
        )}
      </div>

      {/* Stats strip */}
      {stats && !compact && (
        <div className="flex gap-3 text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>{stats.subscriberCount} subscribers</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Activity className="h-3 w-3" />
            <span>{stats.recentEventCount} buffered</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>{stats.processedKeyCount} processed</span>
          </div>
        </div>
      )}

      {/* Active subscribers */}
      {!compact && subscribers.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Active Subscribers</p>
          <div className="flex flex-wrap gap-1">
            {[...new Set(subscribers.map(s => s.subscriberName))].map((name, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Event feed */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5">
          Recent Events {events.length > 0 ? `(${events.length})` : ""}
        </p>
        {events.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-xs">
            No events in the buffer for this org yet.
            <p className="text-[10px] mt-1">Events flow through here as athletes complete sessions, trigger readiness alerts, and receive interventions.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {events.map((event, i) => (
              <div key={event.eventId ?? i}
                data-testid={`event-stream-item-${i}`}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border bg-muted/5 border-border/30">
                <Badge className={`text-[8px] px-1 py-0 h-3.5 border flex-shrink-0 ${eventTypeColor(event.type)}`}>
                  {event.type.split(".").slice(0, 2).join(".")}
                </Badge>
                <p className="text-[10px] text-muted-foreground truncate flex-1">
                  {formatEventType(event.type)}
                  {event.meta.athleteUserId && (
                    <span className="text-muted-foreground/60 ml-1">· {event.meta.athleteUserId.slice(0, 8)}…</span>
                  )}
                </p>
                <span className="text-[9px] text-muted-foreground/60 flex-shrink-0">
                  {timeAgo(event.meta.timestamp)}
                </span>
                {event.handlerResults.length > 0 && (
                  <div className="flex gap-0.5 flex-shrink-0">
                    {event.handlerResults.map((r, j) => (
                      <div key={j}
                        title={r.success ? `${r.subscriber}: ok` : `${r.subscriber}: ${r.error}`}
                        className={`h-1.5 w-1.5 rounded-full ${r.success ? "bg-emerald-400" : "bg-rose-400"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
