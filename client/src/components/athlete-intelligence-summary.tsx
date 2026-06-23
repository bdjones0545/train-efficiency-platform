import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getAuthHeaders } from "@/lib/authToken";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle,
  CheckCircle2, ShieldAlert, Activity, Target, Clock, Zap, ChevronDown, ChevronUp, Wand2,
} from "lucide-react";
import { ProgramAdaptationDraftsPanel } from "@/components/program-adaptation-drafts-panel";

interface AthleteContext {
  id: string;
  athleteUserId: string;
  orgId: string;
  currentProgramId: string | null;
  currentProgramWeek: number | null;
  currentProgramPhase: string | null;
  complianceRate: number | null;
  readinessTrend: string | null;
  riskLevel: string | null;
  last30DayReadinessTrend: any[];
  recentRPETrend: any[];
  riskFlags: any[];
  interventionHistory: any[];
  injuryNotes: any[];
  aiSummary: string | null;
  lastRefreshTrigger: string | null;
  updatedAt: string | null;
}

interface Props {
  athleteUserId: string;
  orgId: string;
  athleteName?: string;
}

function getWbHeaders(orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const bearerHeaders = getAuthHeaders();
  Object.assign(headers, bearerHeaders);
  if (orgId) {
    const orgToken = localStorage.getItem(`orgToken_${orgId}`);
    if (orgToken) headers["x-org-auth-token"] = orgToken;
  }
  return headers;
}

function ReadinessBadge({ trend }: { trend: string | null }) {
  if (trend === "high") return (
    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-xs gap-1">
      <TrendingUp className="h-3 w-3" /> High
    </Badge>
  );
  if (trend === "low") return (
    <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-xs gap-1">
      <TrendingDown className="h-3 w-3" /> Low
    </Badge>
  );
  if (trend === "moderate") return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs gap-1">
      <Minus className="h-3 w-3" /> Moderate
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">Unknown</Badge>
  );
}

function RiskBadge({ level }: { level: string | null }) {
  if (level === "red") return (
    <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-xs gap-1">
      <ShieldAlert className="h-3 w-3" /> High Risk
    </Badge>
  );
  if (level === "yellow") return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs gap-1">
      <AlertTriangle className="h-3 w-3" /> Moderate Risk
    </Badge>
  );
  return (
    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-xs gap-1">
      <CheckCircle2 className="h-3 w-3" /> Low Risk
    </Badge>
  );
}

function ComplianceMeter({ rate }: { rate: number | null }) {
  const value = rate ?? 0;
  const color = value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Compliance</span>
        <span data-testid="compliance-rate-value">{value}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function formatPhase(phase: string | null): string {
  if (!phase) return "—";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function formatTrigger(trigger: string | null): string {
  const map: Record<string, string> = {
    manual: "Manual",
    manual_coach_refresh: "Coach refresh",
    session_completion: "Session completed",
    daily_cron: "Daily cron",
    auto: "Auto",
    auto_stale_refresh: "Auto (stale)",
  };
  return trigger ? (map[trigger] ?? trigger) : "—";
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AthleteIntelligenceSummary({ athleteUserId, orgId, athleteName }: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const headers = getWbHeaders(orgId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/org/workout-builder/athletes", athleteUserId, "context", orgId],
    queryFn: async () => {
      return authenticatedFetch(`/api/org/workout-builder/athletes/${athleteUserId}/context`, {
        headers: headers,
      }) as Promise<{ context: AthleteContext | null; message?: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      return authenticatedFetch(`/api/org/workout-builder/athletes/${athleteUserId}/context/refresh`, {
        method: "POST",
        headers: headers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/athletes", athleteUserId, "context", orgId] });
      toast({ title: "Intelligence updated", description: "Athlete context has been refreshed." });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not refresh athlete context.", variant: "destructive" });
    },
  });

  const context = data?.context;

  const activeFlags = (context?.riskFlags as any[])?.filter((f) => f.severity === "high" || f.severity === "critical") ?? [];
  const recentInjuries = (context?.injuryNotes as any[])?.slice(0, 3) ?? [];

  return (
    <Card className="border-border bg-card" data-testid="athlete-intelligence-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Athlete Intelligence
            {athleteName && <span className="text-muted-foreground font-normal">— {athleteName}</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            {context && (
              <span className="text-xs text-muted-foreground">
                {timeAgo(context.updatedAt)} · {formatTrigger(context.lastRefreshTrigger)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || isLoading}
              data-testid="btn-refresh-context"
            >
              <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
            <Activity className="h-4 w-4" /> Loading athlete intelligence…
          </div>
        )}

        {isError && (
          <div className="text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Failed to load context.
          </div>
        )}

        {!isLoading && !context && (
          <div className="text-sm text-muted-foreground">
            No context object yet. Click <strong>Refresh</strong> to build one from this athlete's data.
          </div>
        )}

        {context && (
          <>
            {/* ── Key signals row ─── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1" data-testid="signal-readiness-trend">
                <p className="text-xs text-muted-foreground">Readiness Trend</p>
                <ReadinessBadge trend={context.readinessTrend} />
              </div>
              <div className="space-y-1" data-testid="signal-risk-level">
                <p className="text-xs text-muted-foreground">Risk Level</p>
                <RiskBadge level={context.riskLevel} />
              </div>
              <div className="space-y-1" data-testid="signal-program-phase">
                <p className="text-xs text-muted-foreground">Program Phase</p>
                <p className="text-xs font-medium">
                  {formatPhase(context.currentProgramPhase)}
                  {context.currentProgramWeek && (
                    <span className="text-muted-foreground"> · Wk {context.currentProgramWeek}</span>
                  )}
                </p>
              </div>
              <div className="space-y-1" data-testid="signal-active-flags">
                <p className="text-xs text-muted-foreground">Active Flags</p>
                <p className={`text-xs font-semibold ${activeFlags.length > 0 ? "text-red-400" : "text-emerald-500"}`}>
                  {activeFlags.length > 0 ? `${activeFlags.length} High` : "None"}
                </p>
              </div>
            </div>

            {/* ── Compliance meter ─── */}
            <ComplianceMeter rate={context.complianceRate} />

            {/* ── AI summary ─── */}
            {context.aiSummary && (
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground leading-relaxed" data-testid="ai-summary-text">
                {context.aiSummary}
              </div>
            )}

            {/* ── Pending adaptation drafts (compact) ─── */}
            <ProgramAdaptationDraftsPanel
              orgId={orgId}
              athleteUserId={athleteUserId}
              headers={headers}
              compact
            />

            {/* ── Expandable detail ─── */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
              data-testid="btn-toggle-intelligence-detail"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide details" : "Show details"}
            </button>

            {expanded && (
              <div className="space-y-3 pt-1" data-testid="intelligence-detail-panel">
                {/* Risk flags */}
                {activeFlags.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Risk Flags</p>
                    {activeFlags.map((f: any, i: number) => (
                      <div key={i} className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2" data-testid={`risk-flag-${i}`}>
                        <p className="text-xs font-medium text-red-400">{f.title}</p>
                        {f.summary && <p className="text-xs text-muted-foreground mt-0.5">{f.summary}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Injury notes */}
                {recentInjuries.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Pain Reports</p>
                    {recentInjuries.map((inj: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-amber-400" data-testid={`injury-note-${i}`}>
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>
                          {Array.isArray(inj.areas) && inj.areas.length > 0
                            ? inj.areas.join(", ")
                            : "Reported pain area"}
                          {inj.date && (
                            <span className="text-muted-foreground"> · {new Date(inj.date).toLocaleDateString()}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* RPE trend */}
                {Array.isArray(context.recentRPETrend) && context.recentRPETrend.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent RPE</p>
                    <div className="flex gap-1 flex-wrap">
                      {(context.recentRPETrend as any[]).slice(0, 10).map((r: any, i: number) => {
                        const rpe = r.rpe;
                        const color = rpe >= 9 ? "bg-red-500" : rpe >= 7 ? "bg-amber-500" : "bg-emerald-500";
                        return (
                          <div
                            key={i}
                            className={`h-6 w-6 rounded flex items-center justify-center text-white text-xs font-bold ${color}`}
                            title={r.exerciseName ?? "Exercise"}
                            data-testid={`rpe-dot-${i}`}
                          >
                            {rpe}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Intervention history */}
                {Array.isArray(context.interventionHistory) && context.interventionHistory.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Interventions</p>
                    {(context.interventionHistory as any[]).slice(0, 3).map((inv: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs" data-testid={`intervention-${i}`}>
                        <span className="text-muted-foreground">{inv.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {inv.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
