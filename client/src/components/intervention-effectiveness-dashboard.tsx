import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, TrendingUp, TrendingDown, Brain, CheckCircle2,
  AlertTriangle, RefreshCw, Loader2, BookOpen, Activity,
} from "lucide-react";

interface EffectivenessStats {
  interventionType: string;
  label: string;
  totalOutcomes: number;
  improvedCount: number;
  noChangeCount: number;
  worsenedCount: number;
  inconclusiveCount: number;
  effectivenessRate: number;
  avgReadinessDelta: number | null;
  avgComplianceDelta: number | null;
  avgRpeDelta: number | null;
  avgDaysToEvaluation: number | null;
  confidence: "high" | "medium" | "low";
  insight: string;
}

interface OrgLearningInsights {
  topEffectiveType: string | null;
  leastEffectiveType: string | null;
  avgResolutionDays: number | null;
  totalOutcomesTracked: number;
  byType: EffectivenessStats[];
  recentTrend: string;
  keyInsight: string;
}

interface Props {
  orgId: string;
  headers: Record<string, string>;
  compact?: boolean;
}

const CONFIDENCE_CONFIG = {
  high: { color: "text-emerald-400", label: "High confidence" },
  medium: { color: "text-amber-400", label: "Medium confidence" },
  low: { color: "text-muted-foreground", label: "Low confidence" },
};

function EffectivenessBar({ rate, n }: { rate: number; n: number }) {
  const color = rate >= 70 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs font-medium w-10 text-right">{rate}%</span>
      <span className="text-[10px] text-muted-foreground w-12">n={n}</span>
    </div>
  );
}

function DeltaChip({ label, value, invertGood }: { label: string; value: number | null; invertGood?: boolean }) {
  if (value === null) return null;
  const isPositive = value > 0;
  const isGood = invertGood ? !isPositive : isPositive;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded ${isGood ? "text-emerald-400 bg-emerald-500/8" : value === 0 ? "text-muted-foreground" : "text-red-400 bg-red-500/8"}`}>
      {isGood ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {label} {value > 0 ? "+" : ""}{value}
    </span>
  );
}

function TypeCard({ stats }: { stats: EffectivenessStats }) {
  const confCfg = CONFIDENCE_CONFIG[stats.confidence];
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-2" data-testid={`effectiveness-card-${stats.interventionType}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{stats.label}</p>
          <p className={`text-[10px] ${confCfg.color}`}>{confCfg.label}</p>
        </div>
        <span className="text-[10px] text-muted-foreground">{stats.totalOutcomes} outcomes</span>
      </div>

      <EffectivenessBar rate={stats.effectivenessRate} n={stats.totalOutcomes} />

      {/* Outcome breakdown */}
      <div className="flex gap-2 text-[10px]">
        {stats.improvedCount > 0 && <span className="text-emerald-400">✓ {stats.improvedCount} improved</span>}
        {stats.noChangeCount > 0 && <span className="text-muted-foreground">→ {stats.noChangeCount} no change</span>}
        {stats.worsenedCount > 0 && <span className="text-red-400">↓ {stats.worsenedCount} worsened</span>}
      </div>

      {/* Delta chips */}
      <div className="flex flex-wrap gap-1">
        <DeltaChip label="Readiness" value={stats.avgReadinessDelta} />
        <DeltaChip label="Compliance" value={stats.avgComplianceDelta} />
        <DeltaChip label="RPE" value={stats.avgRpeDelta} invertGood />
        {stats.avgDaysToEvaluation !== null && (
          <span className="text-[10px] text-muted-foreground px-1">{stats.avgDaysToEvaluation}d avg resolution</span>
        )}
      </div>

      {/* Insight */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">{stats.insight}</p>
    </div>
  );
}

export function InterventionEffectivenessDashboard({ orgId, headers, compact = false }: Props) {
  const { toast } = useToast();
  const queryKey = ["/api/org/intelligence/learning-insights", orgId];

  const { data, isLoading } = useQuery<{ insights: OrgLearningInsights }>({
    queryKey,
    queryFn: async () => {
      const res = await fetch("/api/org/intelligence/learning-insights", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load learning insights");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const evalCronMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/org/intelligence/outcomes/run-evaluation-cron", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" }, credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Evaluation run complete", description: `${result.evaluated} outcomes evaluated.` });
    },
    onError: () => toast({ title: "Evaluation failed", variant: "destructive" }),
  });

  const insights = data?.insights;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
        <Activity className="h-4 w-4" /> Loading effectiveness data…
      </div>
    );
  }

  const noData = !insights || insights.totalOutcomesTracked === 0;

  if (compact && noData) return null;

  return (
    <div className="space-y-4" data-testid="intervention-effectiveness-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Intervention Effectiveness</span>
          {insights && insights.totalOutcomesTracked > 0 && (
            <Badge variant="outline" className="text-xs">{insights.totalOutcomesTracked} outcomes tracked</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => evalCronMutation.mutate()}
          disabled={evalCronMutation.isPending}
          data-testid="btn-run-eval-cron"
        >
          {evalCronMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Evaluate
        </Button>
      </div>

      {noData ? (
        <div className="py-6 text-center text-sm text-muted-foreground space-y-2">
          <Brain className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p>No outcome data yet.</p>
          <p className="text-xs">Approve and track interventions to start building the learning database.</p>
        </div>
      ) : (
        <>
          {/* Key insight */}
          {insights.keyInsight && (
            <div className="rounded-lg bg-primary/8 border border-primary/20 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Brain className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-primary/90">{insights.keyInsight}</p>
              </div>
            </div>
          )}

          {/* Recent trend */}
          <div className="rounded-lg bg-muted/20 border border-border/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Recent trend (30 days)</p>
            <p className="text-xs text-muted-foreground">{insights.recentTrend}</p>
          </div>

          {/* Top-level stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center px-2 py-2 rounded-lg bg-muted/20 border border-border/50">
              <p className="text-xs font-bold text-foreground">{insights.totalOutcomesTracked}</p>
              <p className="text-[10px] text-muted-foreground">Tracked</p>
            </div>
            <div className="text-center px-2 py-2 rounded-lg bg-muted/20 border border-border/50">
              <p className="text-xs font-bold text-foreground">{insights.avgResolutionDays ?? "—"}d</p>
              <p className="text-[10px] text-muted-foreground">Avg resolution</p>
            </div>
            <div className="text-center px-2 py-2 rounded-lg bg-muted/20 border border-border/50">
              <p className="text-xs font-bold text-emerald-400">{insights.topEffectiveType ? (insights.byType.find((t) => t.interventionType === insights.topEffectiveType)?.effectivenessRate ?? "—") : "—"}%</p>
              <p className="text-[10px] text-muted-foreground">Best type</p>
            </div>
          </div>

          {/* By type cards */}
          {insights.byType.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">By Intervention Type</p>
              {insights.byType.slice(0, compact ? 3 : 10).map((stats) => (
                <TypeCard key={stats.interventionType} stats={stats} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
