/**
 * Athlete Intelligence Timeline — Phase 4
 *
 * Chronological event feed for a single athlete, showing readiness changes,
 * interventions, adaptations, outreach, education, coach actions, and outcomes.
 * Pulled from the organization_event_log table via the orchestration API.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle2, Clock, AlertTriangle, Zap, BookOpen, Activity, MessageSquare, TrendingDown, TrendingUp, Minus, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  eventId: string;
  eventType: string;
  sourceSystem: string;
  payload: Record<string, any>;
  resultingActions: string[] | null;
  triggeredWorkflows: string[] | null;
  resolutionState: "open" | "resolved" | "escalated" | "dismissed";
  escalationLevel: number;
  resolvedAt: string | null;
  createdAt: string;
}

interface Props {
  orgId: string;
  athleteUserId: string;
  athleteName?: string;
  headers?: Record<string, string>;
  compact?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventIcon(type: string) {
  if (type.includes("readiness")) return TrendingDown;
  if (type.includes("compliance")) return Activity;
  if (type.includes("risk.escalated") || type.includes("escalation")) return ShieldAlert;
  if (type.includes("session.missed")) return Clock;
  if (type.includes("session.completed")) return CheckCircle2;
  if (type.includes("pain")) return AlertTriangle;
  if (type.includes("intervention")) return Zap;
  if (type.includes("education")) return BookOpen;
  if (type.includes("followup")) return MessageSquare;
  return Activity;
}

function eventColor(type: string, resolutionState: string): string {
  if (resolutionState === "resolved") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (type.includes("pain") || type.includes("escalation")) return "text-red-400 bg-red-500/10 border-red-500/20";
  if (type.includes("risk.escalated")) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
  if (type.includes("compliance") || type.includes("session.missed")) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (type.includes("intervention.approved") || type.includes("session.completed")) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (type.includes("intervention")) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  if (type.includes("education")) return "text-purple-400 bg-purple-500/10 border-purple-500/20";
  return "text-muted-foreground bg-muted/10 border-border/30";
}

function escalationLevelLabel(level: number): string {
  const labels: Record<number, string> = {
    1: "Monitoring",
    2: "Draft recommended",
    3: "Outreach required",
    4: "Critical — escalated",
  };
  return labels[level] ?? "";
}

function escalationBadgeColor(level: number): string {
  if (level >= 4) return "bg-red-500/20 text-red-400 border-red-500/30";
  if (level >= 3) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (level >= 2) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-muted/20 text-muted-foreground border-border/30";
}

function formatEventTitle(type: string, payload: Record<string, any>): string {
  const map: Record<string, string> = {
    "athlete.readiness.updated": `Readiness updated${payload.readinessScore != null ? ` — ${payload.readinessScore}/10` : ""}`,
    "athlete.compliance.declined": `Compliance declined${payload.complianceRate != null ? ` to ${Math.round(payload.complianceRate)}%` : ""}`,
    "athlete.risk.escalated": `Risk escalated to ${(payload.riskLevel ?? "").toUpperCase()}`,
    "athlete.session.completed": "Session completed",
    "athlete.session.missed": `Session missed${payload.consecutiveMissed > 1 ? ` (${payload.consecutiveMissed} in a row)` : ""}`,
    "athlete.pain.reported": `Pain reported${payload.painLocation ? ` — ${payload.painLocation}` : ""}`,
    "athlete.intervention.created": `Intervention created — ${(payload.interventionType ?? "").replace(/_/g, " ")}`,
    "athlete.intervention.approved": `Intervention approved — ${(payload.interventionType ?? "").replace(/_/g, " ")}`,
    "athlete.intervention.failed": "Intervention draft generation failed",
    "athlete.education.completed": `Education completed — ${payload.moduleTitle ?? ""}`,
    "athlete.escalation.triggered": `Escalation triggered — Level ${payload.escalationLevel}`,
    "coach.followup.required": "Coach follow-up required",
    "coach.intervention.pending": "Critical intervention pending review",
  };
  return map[type] ?? type.replace(/\./g, " → ");
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AthleteIntelligenceTimeline({ orgId, athleteUserId, athleteName, headers, compact }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/org/intelligence/athletes", athleteUserId, "timeline"],
    queryFn: async () => {
      return authenticatedFetch(
        `/api/org/intelligence/athletes/${athleteUserId}/timeline?limit=${compact ? 10 : 30}`,
        { headers: headers }
      ) as Promise<{ athleteUserId: string; events: TimelineEvent[] }>;
    },
    staleTime: 2 * 60 * 1000,
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/org/intelligence/event-log/${id}/resolve`, {}, headers ?? {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/intelligence/athletes", athleteUserId, "timeline"] });
      toast({ title: "Event resolved" });
    },
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading intelligence timeline…
    </div>
  );

  const events = data?.events ?? [];

  if (events.length === 0) return (
    <div className="text-center py-6 text-muted-foreground text-xs">
      No intelligence events recorded for this athlete yet.
      <p className="text-[10px] mt-1">Events are logged as the system detects readiness changes, compliance drops, and interventions.</p>
    </div>
  );

  return (
    <div className="space-y-2" data-testid="athlete-intelligence-timeline">
      {events.map((event, i) => {
        const Icon = eventIcon(event.eventType);
        const colorClass = eventColor(event.eventType, event.resolutionState);
        const title = formatEventTitle(event.eventType, event.payload ?? {});
        const payload = event.payload ?? {};
        const isOpen = event.resolutionState === "open";

        return (
          <div
            key={event.id}
            data-testid={`timeline-event-${event.id}`}
            className={`relative flex gap-3 px-3 py-2.5 rounded-lg border ${colorClass}`}
          >
            {/* Timeline connector */}
            {i < events.length - 1 && (
              <div className="absolute left-[22px] top-[38px] w-px h-2 bg-border/40" />
            )}

            <div className="flex-shrink-0 mt-0.5">
              <Icon className="h-3.5 w-3.5" />
            </div>

            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium leading-snug">{title}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {event.escalationLevel > 0 && (
                    <Badge className={`text-[9px] px-1.5 py-0 h-4 border ${escalationBadgeColor(event.escalationLevel)}`}>
                      L{event.escalationLevel}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {timeAgo(event.createdAt)}
                  </span>
                </div>
              </div>

              {/* Escalation label */}
              {event.escalationLevel > 0 && (
                <p className="text-[10px] text-muted-foreground">{escalationLevelLabel(event.escalationLevel)}</p>
              )}

              {/* Resulting actions */}
              {!compact && event.resultingActions && event.resultingActions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {event.resultingActions.map((action, j) => (
                    <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30">
                      {action.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}

              {/* Source + resolution */}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-muted-foreground/60">{event.sourceSystem}</span>
                <div className="flex items-center gap-1">
                  {event.resolutionState === "resolved" ? (
                    <span className="text-[9px] text-emerald-400">Resolved</span>
                  ) : isOpen && !compact ? (
                    <button
                      onClick={() => resolveMutation.mutate(event.id)}
                      disabled={resolveMutation.isPending}
                      data-testid={`button-resolve-event-${event.id}`}
                      className="text-[9px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border/30 hover:border-border"
                    >
                      Mark resolved
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
