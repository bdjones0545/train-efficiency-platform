/**
 * Org Health Overview — Phase 4
 *
 * Displays the organization-wide intelligence state:
 * overall health score, fatigue risk, engagement trend, compliance health,
 * readiness distribution, and critical athlete count.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Heart, Zap, Users, TrendingUp, TrendingDown, Minus, ShieldCheck, Shield, ShieldAlert, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgIntelligenceState {
  orgId: string;
  overallHealthScore: number;
  interventionLoad: number;
  criticalAthleteCount: number;
  unresolvedCriticalAthletes: string[] | null;
  coachWorkloadScore: number;
  complianceHealthScore: number;
  engagementTrendDirection: "improving" | "stable" | "declining";
  fatigueRiskLevel: "low" | "medium" | "high" | "critical";
  recoveryTrendDirection: "improving" | "stable" | "declining";
  readinessDistribution: { green: number; yellow: number; red: number } | null;
  predictedChurnRisks: number;
  unresolvedInterventions: number;
  lastDailyOpsAt: string | null;
  lastUpdatedAt: string;
}

interface Props {
  orgId: string;
  headers?: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function healthScoreLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Caution";
  if (score >= 40) return "Stressed";
  return "Critical";
}

function fatigueRiskBadge(level: string): string {
  const map: Record<string, string> = {
    low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return map[level] ?? "bg-muted/20 text-muted-foreground border-border/30";
}

function trendIcon(direction: string) {
  if (direction === "improving") return TrendingUp;
  if (direction === "declining") return TrendingDown;
  return Minus;
}

function trendColor(direction: string): string {
  if (direction === "improving") return "text-emerald-400";
  if (direction === "declining") return "text-rose-400";
  return "text-muted-foreground";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const size = 64;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;
  const colorMap = [
    { min: 80, color: "#34d399" },
    { min: 60, color: "#fbbf24" },
    { min: 40, color: "#fb923c" },
    { min: 0, color: "#f87171" },
  ];
  const color = colorMap.find(c => pct >= c.min)?.color ?? "#f87171";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor"
          strokeWidth={stroke} className="text-muted/20" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-bold leading-none ${healthScoreColor(score)}`}>{score}</span>
        <span className="text-[8px] text-muted-foreground mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OrgHealthOverview({ orgId, headers }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: state, isLoading } = useQuery({
    queryKey: ["/api/org/intelligence/state", orgId],
    queryFn: async () => {
      return authenticatedFetch("/api/org/intelligence/state", { headers: headers }) as Promise<OrgIntelligenceState>;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/org/intelligence/state/refresh", {}, headers ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/intelligence/state", orgId] });
      toast({ title: "Org state refreshed" });
    },
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading org intelligence state…
    </div>
  );

  if (!state) return null;

  const dist = state.readinessDistribution;
  const EngagementIcon = trendIcon(state.engagementTrendDirection);
  const RecoveryIcon = trendIcon(state.recoveryTrendDirection);

  return (
    <div className="space-y-4" data-testid="org-health-overview">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Organization Health</h3>
        </div>
        <div className="flex items-center gap-2">
          {state.lastUpdatedAt && (
            <span className="text-[10px] text-muted-foreground">
              Updated {timeAgo(state.lastUpdatedAt)}
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid="button-refresh-org-state"
          >
            <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Main stats row */}
      <div className="flex items-center gap-4">
        <HealthRing score={state.overallHealthScore} />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-base font-bold ${healthScoreColor(state.overallHealthScore)}`}>
              {healthScoreLabel(state.overallHealthScore)}
            </span>
            <Badge className={`text-[9px] px-1.5 py-0 h-4 border capitalize ${fatigueRiskBadge(state.fatigueRiskLevel)}`}>
              {state.fatigueRiskLevel} fatigue
            </Badge>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 text-[11px]">
              <EngagementIcon className={`h-3 w-3 ${trendColor(state.engagementTrendDirection)}`} />
              <span className={trendColor(state.engagementTrendDirection)}>
                {state.engagementTrendDirection} engagement
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <RecoveryIcon className={`h-3 w-3 ${trendColor(state.recoveryTrendDirection)}`} />
              <span className={trendColor(state.recoveryTrendDirection)}>
                {state.recoveryTrendDirection} recovery
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center justify-center rounded-lg border border-border/40 bg-muted/10 py-2.5 px-2 text-center">
          <span className={`text-lg font-bold leading-none ${state.criticalAthleteCount > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {state.criticalAthleteCount}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Critical</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border/40 bg-muted/10 py-2.5 px-2 text-center">
          <span className={`text-lg font-bold leading-none ${state.unresolvedInterventions > 5 ? "text-amber-400" : "text-foreground"}`}>
            {state.unresolvedInterventions}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Open Drafts</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border/40 bg-muted/10 py-2.5 px-2 text-center">
          <span className={`text-lg font-bold leading-none ${state.predictedChurnRisks > 2 ? "text-orange-400" : "text-foreground"}`}>
            {state.predictedChurnRisks}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Churn Risk</span>
        </div>
      </div>

      {/* Readiness distribution */}
      {dist && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Athlete Readiness Distribution</p>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 text-[11px]">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">{dist.green}</span>
              <span className="text-muted-foreground">On Track</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Shield className="h-3 w-3 text-amber-400" />
              <span className="text-amber-400 font-semibold">{dist.yellow}</span>
              <span className="text-muted-foreground">Monitor</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <ShieldAlert className="h-3 w-3 text-rose-400" />
              <span className="text-rose-400 font-semibold">{dist.red}</span>
              <span className="text-muted-foreground">Critical</span>
            </div>
          </div>
          {/* Visual bar */}
          <div className="flex rounded-full overflow-hidden h-1.5 mt-2 gap-px">
            {dist.green > 0 && (
              <div className="bg-emerald-500/60 transition-all" style={{ flex: dist.green }} />
            )}
            {dist.yellow > 0 && (
              <div className="bg-amber-500/60 transition-all" style={{ flex: dist.yellow }} />
            )}
            {dist.red > 0 && (
              <div className="bg-rose-500/60 transition-all" style={{ flex: dist.red }} />
            )}
            {dist.green === 0 && dist.yellow === 0 && dist.red === 0 && (
              <div className="bg-muted/30 flex-1 rounded-full" />
            )}
          </div>
        </div>
      )}

      {/* Compliance health */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">Compliance Health</span>
          <span className={`text-xs font-semibold ${state.complianceHealthScore >= 70 ? "text-emerald-400" : state.complianceHealthScore >= 50 ? "text-amber-400" : "text-rose-400"}`}>
            {state.complianceHealthScore}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${state.complianceHealthScore >= 70 ? "bg-emerald-500/60" : state.complianceHealthScore >= 50 ? "bg-amber-500/60" : "bg-rose-500/60"}`}
            style={{ width: `${state.complianceHealthScore}%` }}
          />
        </div>
      </div>
    </div>
  );
}
