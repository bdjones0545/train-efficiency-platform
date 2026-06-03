import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Network, TrendingUp, BarChart3, Users, Trophy, Zap,
  ChevronRight, Target, BookOpen, Lightbulb, Copy, Star, Award,
  CheckCircle, ArrowUp, ArrowDown, Minus, Activity, Globe, Shield,
  RefreshCw, Layers, BarChart2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type NetworkOverview = { industryPercentile: number; performanceRank: string; growthVelocity: number; aiAdoptionScore: number; aiAdoptionLevel: string; networkSize: number; similarOrgs: number; summary: string; keyInsights: { insight: string; category: string; positive: boolean }[]; generatedAt: string };
type BenchmarkData = { benchmarks: { metric: string; unit: string; yours: number; industry: number; top10pct: number; yourPercentile: number; higherIsBetter: boolean; category: string }[]; categories: string[]; generatedAt: string };
type BestPracticesData = { practices: { id: string; category: string; title: string; adoptionRate: number; avgImpact: string; confidence: number; difficulty: string; agents: string[]; description: string }[]; generatedAt: string };
type PlaybooksData = { playbooks: { id: string; name: string; category: string; successRate: number; avgRevenueImpact: number; industryFit: string; steps: number; avgTimeToResult: string; uses: number; description: string }[]; generatedAt: string };
type LeaderboardData = { categories: { name: string; yourScore: number; yourPercentile: number; leaders: { rank: number; score: number; label: string }[] }[]; networkSize: number; generatedAt: string };
type PatternsData = { patterns: { id: string; pattern: string; dataPoints: number; finding: string; confidence: number; trend: string; category: string; actionable: boolean; recommendation: string }[]; emergingPatterns: { title: string; impact: string }[]; generatedAt: string };
type ReplicationData = { replicationTargets: { id: string; title: string; similarity: number; whatChanged: string; whatWorked: string; revenueImpact: string; timeToResult: string; confidence: number; steps: string[] }[]; generatedAt: string };
type ReportsData = { latestReport: { title: string; publishedAt: string; sections: { title: string; summary: string; highlight: string }[] }; pastReports: { title: string; publishedAt: string; highlights: string[] }[]; generatedAt: string };
type NetworkRecs = { recommendations: { id: string; title: string; rationale: string; expectedImpact: string; confidence: number; category: string; effort: string; networkDataPoints: number }[]; networkSize: number; generatedAt: string };
type StrategyData = { strategicPriorities: { priority: string; rationale: string; expectedROI: string; timeframe: string; effort: string }[]; investmentRecommendations: { area: string; recommendation: string; expectedReturn: string }[]; expansionOpportunities: { opportunity: string; marketSize: string; readinessScore: number; firstStep: string }[]; marketPositioning: { currentPosition: string; targetPosition: string; keyDifferentiators: string[]; recommendedMessage: string }; horizonSummary: string; horizon: string; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ProgressBar({ value, color = "bg-primary", height = "h-2" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function PercentileBadge({ pct }: { pct: number }) {
  const color = pct >= 90 ? "text-emerald-600 dark:text-emerald-400" : pct >= 75 ? "text-blue-600 dark:text-blue-400" : pct >= 50 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  const label = pct >= 90 ? "Top 10%" : pct >= 75 ? "Top 25%" : pct >= 50 ? "Top 50%" : "Building";
  return <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${color}`}>{label}</Badge>;
}

function DifficultyBadge({ d }: { d: string }) {
  const cfg: Record<string, string> = { low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  return <Badge className={`text-[9px] px-1.5 py-0 h-4 capitalize ${cfg[d] ?? "bg-muted text-muted-foreground"}`}>{d}</Badge>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",      label: "Overview",       icon: Network },
  { id: "benchmarks",    label: "Benchmarks",     icon: BarChart3 },
  { id: "practices",     label: "Best Practices", icon: CheckCircle },
  { id: "playbooks",     label: "Playbooks",      icon: BookOpen },
  { id: "leaderboards",  label: "Leaderboards",   icon: Trophy },
  { id: "patterns",      label: "Patterns",       icon: Activity },
  { id: "replication",   label: "Replication",    icon: Copy },
  { id: "reports",       label: "Reports",        icon: BarChart2 },
  { id: "recs",          label: "Recommendations",icon: Lightbulb },
  { id: "strategy",      label: "Strategy",       icon: Target },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<NetworkOverview>({ queryKey: ["/api/network/overview"], staleTime: 5 * 60_000 });
  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;
  const pctColor = (data?.industryPercentile ?? 0) >= 75 ? "text-emerald-600 dark:text-emerald-400" : (data?.industryPercentile ?? 0) >= 50 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  return (
    <div className="space-y-4" data-testid="tab-network-overview">
      <div className="flex items-start gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <div className="shrink-0 text-center p-3 rounded-xl bg-card border min-w-20">
          <p className={`text-4xl font-extrabold ${pctColor}`}>{data?.industryPercentile ?? 0}<span className="text-lg">th</span></p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Percentile</p>
          <p className={`text-[10px] font-semibold mt-0.5 ${pctColor}`}>{data?.performanceRank}</p>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-bold">Network Position</h2>
            <Badge variant="secondary" className="text-[10px]">{data?.networkSize.toLocaleString()} orgs in network</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{data?.summary}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Industry Percentile", value: `${data?.industryPercentile ?? 0}th`,      color: pctColor },
              { label: "Growth Velocity",     value: `${data?.growthVelocity ?? 0} / 100`,      color: "text-blue-600 dark:text-blue-400" },
              { label: "AI Adoption Score",   value: `${data?.aiAdoptionScore ?? 0} / 100`,     color: "text-violet-600 dark:text-violet-400" },
              { label: "Similar Orgs",        value: `${data?.similarOrgs ?? 0} tracked`,       color: "text-muted-foreground" },
            ].map(m => (
              <div key={m.label} className="p-2.5 rounded-lg bg-background border">
                <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-network">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(data?.keyInsights ?? []).map((ins, i) => (
          <div key={i} className={`p-3.5 rounded-xl border ${ins.positive ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-900" : "bg-amber-500/5 border-amber-200 dark:border-amber-900"}`} data-testid={`network-insight-${i}`}>
            <div className={`h-1.5 w-1.5 rounded-full mb-1.5 ${ins.positive ? "bg-emerald-500" : "bg-amber-500"}`} />
            <p className="text-xs">{ins.insight}</p>
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 mt-1.5 capitalize">{ins.category}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Benchmarks ──────────────────────────────────────────────────────────

function BenchmarksTab() {
  const { data, isLoading } = useQuery<BenchmarkData>({ queryKey: ["/api/network/benchmarks"], staleTime: 5 * 60_000 });
  const [catFilter, setCatFilter] = useState("all");
  const filtered = catFilter === "all" ? (data?.benchmarks ?? []) : (data?.benchmarks ?? []).filter(b => b.category === catFilter);

  return (
    <div className="space-y-4" data-testid="tab-benchmarks">
      <div className="flex gap-1.5 flex-wrap">
        {["all", "speed", "retention", "automation", "revenue", "efficiency"].map(c => (
          <button key={c} onClick={() => setCatFilter(c)} data-testid={`bench-filter-${c}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {c === "all" ? "All Metrics" : c}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(b => {
            const isAboveIndustry = b.higherIsBetter ? b.yours >= b.industry : b.yours <= b.industry;
            const isTop10 = b.higherIsBetter ? b.yours >= b.top10pct : b.yours <= b.top10pct;
            const displayYours = b.unit === "hours" || b.unit === "agents" ? b.yours : b.unit === "%" ? `${b.yours}%` : b.unit === "$/yr" ? `$${b.yours.toLocaleString()}` : `${b.yours}`;
            const displayIndustry = b.unit === "hours" ? `${b.industry}h` : b.unit === "%" ? `${b.industry}%` : b.unit === "$/yr" ? `$${b.industry.toLocaleString()}` : `${b.industry}`;
            const displayTop = b.unit === "hours" ? `${b.top10pct}h` : b.unit === "%" ? `${b.top10pct}%` : b.unit === "$/yr" ? `$${b.top10pct.toLocaleString()}` : `${b.top10pct}`;
            return (
              <div key={b.metric} className="p-4 rounded-xl border bg-card" data-testid={`bench-${b.metric.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <p className="text-sm font-semibold flex-1">{b.metric}</p>
                  <PercentileBadge pct={b.yourPercentile} />
                  {isTop10 && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Top 10%</Badge>}
                  {!isAboveIndustry && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 dark:text-amber-400">Below Average</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[
                    { label: "You",       value: displayYours, highlight: isAboveIndustry },
                    { label: "Industry",  value: displayIndustry, highlight: false },
                    { label: "Top 10%",   value: displayTop,   highlight: false },
                  ].map(col => (
                    <div key={col.label} className="text-center p-2 rounded-lg bg-muted/30">
                      <p className={`text-base font-bold ${col.highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{col.value}</p>
                      <p className="text-[9px] text-muted-foreground">{col.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground shrink-0">Your percentile</span>
                  <ProgressBar value={b.yourPercentile} color={b.yourPercentile >= 75 ? "bg-emerald-500" : b.yourPercentile >= 50 ? "bg-primary" : "bg-amber-500"} />
                  <span className="text-[10px] font-bold shrink-0">{b.yourPercentile}th</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Best Practices ──────────────────────────────────────────────────────

function BestPracticesTab() {
  const { data, isLoading } = useQuery<BestPracticesData>({ queryKey: ["/api/network/best-practices"], staleTime: 10 * 60_000 });
  const [catFilter, setCatFilter] = useState("all");
  const filtered = catFilter === "all" ? (data?.practices ?? []) : (data?.practices ?? []).filter(p => p.category === catFilter);

  return (
    <div className="space-y-4" data-testid="tab-practices">
      <div className="flex gap-1.5 flex-wrap">
        {["all", "retention", "revenue", "leads", "automation", "hiring"].map(c => (
          <button key={c} onClick={() => setCatFilter(c)} data-testid={`practice-filter-${c}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {c === "all" ? "All" : c}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <div key={p.id} className="p-4 rounded-xl border bg-card" data-testid={`practice-${p.id}`}>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold">{p.title}</p>
                    <DifficultyBadge d={p.difficulty} />
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{p.category}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{p.description}</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{p.avgImpact}</p>
                      <p className="text-[9px] text-muted-foreground">Avg Impact</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold">{p.adoptionRate}%</p>
                      <p className="text-[9px] text-muted-foreground">Network Adoption</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{p.confidence}%</p>
                      <p className="text-[9px] text-muted-foreground">Confidence</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Playbooks ────────────────────────────────────────────────────────────

function PlaybooksTab() {
  const { data, isLoading } = useQuery<PlaybooksData>({ queryKey: ["/api/network/playbooks"], staleTime: 10 * 60_000 });
  const FIT_COLORS: Record<string, string> = { high: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", low: "text-muted-foreground" };

  return (
    <div className="space-y-4" data-testid="tab-playbooks">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <BookOpen className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">Battle-tested playbooks from top-performing organizations. Each playbook has been validated across hundreds of S&C coaching businesses in the network.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data?.playbooks ?? []).map(pl => (
            <div key={pl.id} className="p-4 rounded-xl border bg-card" data-testid={`playbook-${pl.id}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold">{pl.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{pl.category}</Badge>
                    <span className={`text-[9px] font-medium capitalize ${FIT_COLORS[pl.industryFit]}`}>{pl.industryFit} fit</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{pl.successRate}%</p>
                  <p className="text-[9px] text-muted-foreground">success rate</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mb-3 leading-snug">{pl.description}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-1.5 rounded-lg bg-muted/30">
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${(pl.avgRevenueImpact / 1000).toFixed(1)}K</p>
                  <p className="text-[8px] text-muted-foreground">Avg Revenue</p>
                </div>
                <div className="p-1.5 rounded-lg bg-muted/30">
                  <p className="text-xs font-bold">{pl.steps} steps</p>
                  <p className="text-[8px] text-muted-foreground">Complexity</p>
                </div>
                <div className="p-1.5 rounded-lg bg-muted/30">
                  <p className="text-xs font-bold">{pl.avgTimeToResult}</p>
                  <p className="text-[8px] text-muted-foreground">Time to Result</p>
                </div>
              </div>
              <p className="text-[9px] text-muted-foreground mt-2 text-right">{pl.uses.toLocaleString()} organizations used this playbook</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Leaderboards ────────────────────────────────────────────────────────

function LeaderboardsTab() {
  const { data, isLoading } = useQuery<LeaderboardData>({ queryKey: ["/api/network/leaderboards"], staleTime: 5 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-leaderboards">
      {data && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />All rankings are anonymous — no individual organization data is shared.</p>}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data?.categories ?? []).map(cat => {
            const pctColor = cat.yourPercentile >= 75 ? "text-emerald-600 dark:text-emerald-400" : cat.yourPercentile >= 50 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
            return (
              <div key={cat.name} className="p-4 rounded-xl border bg-card" data-testid={`leaderboard-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold">{cat.name}</p>
                  <PercentileBadge pct={cat.yourPercentile} />
                </div>
                <div className="flex items-end gap-3 mb-3">
                  <div className="text-center">
                    <p className="text-[9px] text-muted-foreground">Your Score</p>
                    <p className={`text-3xl font-extrabold ${pctColor}`}>{cat.yourScore}</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] text-muted-foreground">Percentile</span>
                      <span className="text-[9px] font-bold">{cat.yourPercentile}th</span>
                    </div>
                    <ProgressBar value={cat.yourPercentile} color={cat.yourPercentile >= 75 ? "bg-emerald-500" : cat.yourPercentile >= 50 ? "bg-primary" : "bg-amber-500"} />
                  </div>
                </div>
                <div className="space-y-1.5 border-t pt-2">
                  {cat.leaders.map(l => (
                    <div key={l.rank} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-center font-bold text-amber-500">#{l.rank}</span>
                      <span className="text-muted-foreground flex-1">{l.label}</span>
                      <span className="font-semibold">{l.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Patterns ────────────────────────────────────────────────────────────

function PatternsTab() {
  const { data, isLoading } = useQuery<PatternsData>({ queryKey: ["/api/network/patterns"], staleTime: 10 * 60_000 });
  const TREND_CFG: Record<string, { color: string; icon: any }> = {
    accelerating: { color: "text-emerald-600 dark:text-emerald-400", icon: ArrowUp },
    growing:      { color: "text-blue-600 dark:text-blue-400",       icon: TrendingUp },
    stable:       { color: "text-muted-foreground",                  icon: Minus },
    seasonal:     { color: "text-amber-600 dark:text-amber-400",     icon: Activity },
  };

  return (
    <div className="space-y-4" data-testid="tab-patterns">
      {(data?.emergingPatterns ?? []).length > 0 && (
        <div className="p-4 rounded-xl border bg-violet-500/5 border-violet-200 dark:border-violet-900">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Emerging Patterns</h3>
          </div>
          <div className="space-y-1.5">
            {(data?.emergingPatterns ?? []).map((ep, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${ep.impact === "high" ? "bg-rose-500" : "bg-amber-500"}`} />
                <span>{ep.title}</span>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ml-auto capitalize ${ep.impact === "high" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{ep.impact}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.patterns ?? []).map(pt => {
            const tCfg = TREND_CFG[pt.trend] ?? TREND_CFG.stable;
            const TrendIcon = tCfg.icon;
            return (
              <div key={pt.id} className="p-4 rounded-xl border bg-card" data-testid={`pattern-${pt.id}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold">{pt.pattern}</p>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{pt.category}</Badge>
                      <div className={`flex items-center gap-0.5 text-[9px] ${tCfg.color}`}>
                        <TrendIcon className="h-2.5 w-2.5" />
                        <span className="capitalize">{pt.trend}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{pt.dataPoints.toLocaleString()} data points</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{pt.finding}</p>
                    <p className="text-[9px] text-muted-foreground">{pt.confidence}% confidence</p>
                  </div>
                </div>
                {pt.actionable && (
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px]"><span className="font-semibold text-primary">Recommended: </span>{pt.recommendation}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Replication ─────────────────────────────────────────────────────────

function ReplicationTab() {
  const { data, isLoading } = useQuery<ReplicationData>({ queryKey: ["/api/network/replication"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-replication">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900">
        <Copy className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
        <p className="text-xs">These are real success patterns from organizations similar to yours. Similarity score is based on business size, service model, and growth stage.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-4">
          {(data?.replicationTargets ?? []).map(rt => (
            <div key={rt.id} className="p-4 rounded-xl border bg-card" data-testid={`replication-${rt.id}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-semibold">{rt.title}</p>
                    <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary">{rt.similarity}% similar to you</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{rt.timeToResult} to results · {rt.confidence}% confidence</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{rt.revenueImpact}</p>
                  <p className="text-[9px] text-muted-foreground">revenue impact</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="p-2.5 rounded-lg bg-muted/30">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">What Changed</p>
                  <p className="text-xs">{rt.whatChanged}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/30">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">What Worked</p>
                  <p className="text-xs">{rt.whatWorked}</p>
                </div>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Replication Plan</p>
                <div className="space-y-1">
                  {rt.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Reports ─────────────────────────────────────────────────────────────

function ReportsTab() {
  const { data, isLoading } = useQuery<ReportsData>({ queryKey: ["/api/network/reports"], staleTime: 30 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-reports">
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <>
          {data?.latestReport && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-primary text-primary-foreground text-[9px] px-1.5 py-0 h-4">Latest</Badge>
                <p className="text-sm font-bold">{data.latestReport.title}</p>
              </div>
              <div className="space-y-3">
                {data.latestReport.sections.map(s => (
                  <div key={s.title} className="p-3 rounded-lg bg-muted/30 border" data-testid={`report-section-${s.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold">{s.title}</p>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-emerald-600 dark:text-emerald-400 ml-auto">{s.highlight}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Past Reports</h3>
            {(data?.pastReports ?? []).map(r => (
              <div key={r.title} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`past-report-${r.publishedAt}`}>
                <BarChart2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold">{r.title}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {r.highlights.map(h => <span key={h} className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{h}</span>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Network Recommendations ────────────────────────────────────────────

function RecommendationsTab() {
  const { data, isLoading } = useQuery<NetworkRecs>({ queryKey: ["/api/network/recommendations"], staleTime: 5 * 60_000 });
  const EFFORT_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-recs">
      {data && (
        <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
          <Network className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs">These recommendations are generated from {data.networkSize.toLocaleString()} organizations — patterns validated at scale, personalized to your profile.</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.recommendations ?? []).map(rec => (
            <div key={rec.id} className="p-4 rounded-xl border bg-card" data-testid={`network-rec-${rec.id}`}>
              <div className="flex items-start gap-3">
                <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold">{rec.title}</p>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{rec.category}</Badge>
                    <span className={`text-[9px] font-medium capitalize ${EFFORT_COLORS[rec.effort]}`}>{rec.effort} effort</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{rec.rationale}</p>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <p className="text-[9px] text-muted-foreground">Expected Impact</p>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{rec.expectedImpact}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground">Confidence</p>
                      <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{rec.confidence}%</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground">Data Points</p>
                      <p className="text-sm font-bold">{rec.networkDataPoints.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: AI Strategy Engine ──────────────────────────────────────────────────

function StrategyTab() {
  const { toast } = useToast();
  const [horizon, setHorizon] = useState("90 days");
  const [result, setResult] = useState<StrategyData | null>(null);

  const strategyMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/network/strategy", { horizon })).json(),
    onSuccess: (data: StrategyData) => setResult(data),
    onError: () => toast({ title: "Strategy generation failed", variant: "destructive" }),
  });

  const EFFORT_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-strategy">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <Target className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">AI Strategy Engine</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Combines internal performance data, external market intelligence, and network benchmarks to generate your strategic priorities for any planning horizon.</p>
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-44">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Planning horizon</label>
          <Select value={horizon} onValueChange={setHorizon}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-strategy-horizon"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["30 days", "60 days", "90 days", "6 months", "12 months"].map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => strategyMutation.mutate()} disabled={strategyMutation.isPending} className="h-8 gap-1.5 shrink-0" data-testid="button-generate-strategy">
          <Target className="h-3.5 w-3.5" />{strategyMutation.isPending ? "Generating..." : "Generate Strategy"}
        </Button>
      </div>

      {result && (
        <div className="space-y-4" data-testid="strategy-result">
          {/* Horizon summary */}
          <div className="p-4 rounded-xl border bg-primary/5 border-primary/20">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{result.horizon} Strategic Summary</p>
            <p className="text-sm">{result.horizonSummary}</p>
          </div>

          {/* Strategic priorities */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Strategic Priorities</h3>
            </div>
            <div className="divide-y">
              {(result.strategicPriorities ?? []).map((p, i) => (
                <div key={i} className="flex items-start gap-3 p-4" data-testid={`priority-${i}`}>
                  <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-xs font-semibold">{p.priority}</p>
                      <span className={`text-[9px] font-medium capitalize ${EFFORT_COLORS[p.effort]}`}>{p.effort} effort</span>
                      <span className="text-[9px] text-muted-foreground">{p.timeframe}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-1">{p.rationale}</p>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-emerald-600 dark:text-emerald-400">{p.expectedROI}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Investment + Expansion + Positioning */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">Investment Recommendations</h3>
              </div>
              <div className="space-y-3">
                {(result.investmentRecommendations ?? []).map((inv, i) => (
                  <div key={i} data-testid={`investment-${i}`}>
                    <p className="text-xs font-semibold">{inv.area}</p>
                    <p className="text-[10px] text-muted-foreground mb-1">{inv.recommendation}</p>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-emerald-600 dark:text-emerald-400">{inv.expectedReturn}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold">Expansion Opportunities</h3>
              </div>
              <div className="space-y-3">
                {(result.expansionOpportunities ?? []).map((exp, i) => (
                  <div key={i} data-testid={`expansion-${i}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs font-semibold flex-1">{exp.opportunity}</p>
                      <p className="text-[9px] text-muted-foreground">{exp.readinessScore}% ready</p>
                    </div>
                    <p className="text-[9px] text-muted-foreground">{exp.marketSize}</p>
                    <p className="text-[10px] mt-0.5 text-primary">→ {exp.firstStep}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Market positioning */}
          {result.marketPositioning && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Award className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold">Market Positioning</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="p-2.5 rounded-lg bg-muted/30">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Current Position</p>
                  <p className="text-xs">{result.marketPositioning.currentPosition}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Target Position</p>
                  <p className="text-xs font-medium">{result.marketPositioning.targetPosition}</p>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-200 dark:border-emerald-900 mb-2">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Recommended Message</p>
                <p className="text-xs italic font-medium">"{result.marketPositioning.recommendedMessage}"</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(result.marketPositioning.keyDifferentiators ?? []).map((d, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-muted">{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminNetworkIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<NetworkOverview>({ queryKey: ["/api/network/overview"], staleTime: 5 * 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-network-intelligence">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/market-intelligence">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />External Intelligence
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Network className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Network Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Learn from the platform network — benchmarks, best practices, and AI strategy powered by aggregate intelligence.
          </p>
        </div>

        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Percentile",  value: `${overview.industryPercentile}th`, color: overview.industryPercentile >= 75 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
              { label: "AI Adoption", value: overview.aiAdoptionLevel,           color: "text-primary" },
              { label: "Network",     value: `${overview.networkSize.toLocaleString()}`,  color: "text-muted-foreground" },
            ].map((s, i) => (
              <div key={s.label} className="text-center">
                {i > 0 && <div className="hidden sm:block w-px h-8 bg-border mx-2 -mt-2" />}
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-lg font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup Wizard",         href: "/admin/ai-workforce" },
          { label: "Workforce",             href: "/admin/ai-workforce/settings" },
          { label: "Operations",            href: "/admin/ai-operations" },
          { label: "Executive Intel",       href: "/admin/executive-intelligence" },
          { label: "Autonomous",            href: "/admin/autonomous-management" },
          { label: "Trust",                 href: "/admin/trust-attribution" },
          { label: "External Intel",        href: "/admin/market-intelligence" },
          { label: "Network Intelligence",  href: null, active: true },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href ? (
              <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
            ) : (
              <span className="font-semibold text-foreground">{step.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-network">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "overview"     && <OverviewTab />}
        {activeTab === "benchmarks"   && <BenchmarksTab />}
        {activeTab === "practices"    && <BestPracticesTab />}
        {activeTab === "playbooks"    && <PlaybooksTab />}
        {activeTab === "leaderboards" && <LeaderboardsTab />}
        {activeTab === "patterns"     && <PatternsTab />}
        {activeTab === "replication"  && <ReplicationTab />}
        {activeTab === "reports"      && <ReportsTab />}
        {activeTab === "recs"         && <RecommendationsTab />}
        {activeTab === "strategy"     && <StrategyTab />}
      </div>

      {/* Forward navigation → Productization & Revenue Engine */}
      <Link href="/admin/billing-intelligence">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5 hover:from-primary/10 hover:to-emerald-500/10 transition-colors cursor-pointer group" data-testid="nav-billing-intelligence">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Productization &amp; Revenue Engine</p>
            <p className="text-xs text-muted-foreground mt-0.5">Plan architecture, feature entitlements, activation scoring, expansion opportunities, and the full SaaS revenue operations dashboard.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
