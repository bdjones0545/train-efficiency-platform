import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, RefreshCw, Brain, TrendingUp, AlertTriangle, CheckCircle,
  XCircle, Clock, Target, Zap, BarChart3, Shield, Users, Settings,
  ChevronRight, ChevronDown, ArrowUp, ArrowDown, Minus, Trophy,
  DollarSign, Activity, Lightbulb, MessageSquare, FileText, Download,
  Calendar, CircleDot, Star, AlertCircle, Cpu, Radio, Layers,
  Crosshair, BookOpen, Send,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Briefing = {
  date: string;
  businessHealthScore: number;
  wins: string[];
  risks: string[];
  opportunities: string[];
  recommendedActions: { rank: number; action: string; reason: string; impact: string }[];
  stats: { meetingsToday: number; followUps: number; pendingApprovals: number; openOpportunities: number; criticalAlerts: number; failedWorkflows: number };
};

type ForecastWindow = { period: string; label: string; projected: number; atRisk: number; recovery: number; pipelineVelocity: number; confidence: number };
type Forecast = { windows: ForecastWindow[]; pipelineValue: number; pipelineCount: number; topOpportunities: any[]; generatedAt: string };

type Bottleneck = { id: string; problem: string; impact: string; severity: string; fix: string; metric: string };
type Bottlenecks = { bottlenecks: Bottleneck[]; total: number; critical: number; generatedAt: string };

type Risk = { id: string; title: string; description: string; category: string; level: string; probability: number; impact: string; mitigation: string };
type Risks = { risks: Risk[]; summary: { critical: number; high: number; moderate: number; low: number }; generatedAt: string };

type Recommendation = { id: string; title: string; description: string; impact: string; confidence: number; effort: string; category: string; status: string };
type Recommendations = { recommendations: Recommendation[]; total: number; generatedAt: string };

type Scorecard = { domain: string; score: number; color: string; icon: string; trend: string; highlights: string[] };
type Scorecards = { scorecards: Scorecard[]; generatedAt: string };

type WeeklyReport = { period: { start: string; end: string }; executiveSummary: any; revenue: any; operations: any; workforce: any; opportunities: any[]; generatedAt: string };

// ─── Shared helpers ────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  critical: { color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/20",     border: "border-rose-200 dark:border-rose-800",    dot: "bg-rose-500" },
  high:     { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20", border: "border-orange-200 dark:border-orange-800", dot: "bg-orange-500" },
  moderate: { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500" },
  medium:   { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500" },
  low:      { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500" },
  info:     { color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20",     border: "border-blue-200 dark:border-blue-800",     dot: "bg-blue-500" },
};

const DOMAIN_COLORS: Record<string, { ring: string; text: string; bg: string; bar: string }> = {
  emerald: { ring: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", bar: "bg-emerald-500" },
  blue:    { ring: "stroke-blue-500",    text: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-500/10",    bar: "bg-blue-500" },
  violet:  { ring: "stroke-violet-500",  text: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-500/10",  bar: "bg-violet-500" },
  amber:   { ring: "stroke-amber-500",   text: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10",   bar: "bg-amber-500" },
  pink:    { ring: "stroke-pink-500",    text: "text-pink-600 dark:text-pink-400",       bg: "bg-pink-500/10",    bar: "bg-pink-500" },
  sky:     { ring: "stroke-sky-500",     text: "text-sky-600 dark:text-sky-400",         bg: "bg-sky-500/10",     bar: "bg-sky-500" },
};

const EFFORT_CONFIG: Record<string, { color: string; label: string }> = {
  Low:    { color: "text-emerald-600 dark:text-emerald-400", label: "Low effort" },
  Medium: { color: "text-amber-600 dark:text-amber-400",     label: "Medium effort" },
  High:   { color: "text-rose-600 dark:text-rose-400",       label: "High effort" },
};

function RingScore({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const strokeColor = DOMAIN_COLORS[color]?.ring ?? "stroke-primary";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={size * 0.08} stroke="currentColor" className="text-muted/30" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={size * 0.08} strokeLinecap="round"
        className={strokeColor} strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
    </svg>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <ArrowUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (trend === "down") return <ArrowDown className="h-3.5 w-3.5 text-rose-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "briefing",        label: "Daily Briefing",      icon: BookOpen },
  { id: "forecast",        label: "Revenue Forecast",    icon: TrendingUp },
  { id: "bottlenecks",     label: "Bottlenecks",         icon: AlertTriangle },
  { id: "risks",           label: "Risk Monitor",        icon: Shield },
  { id: "recommendations", label: "Recommendations",     icon: Lightbulb },
  { id: "scorecards",      label: "Scorecards",          icon: BarChart3 },
  { id: "boardroom",       label: "AI Boardroom",        icon: MessageSquare },
  { id: "report",          label: "Weekly Report",       icon: FileText },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Daily Briefing ───────────────────────────────────────────────────────

function BriefingTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<Briefing>({
    queryKey: ["/api/executive/briefing"],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const healthColor = (score: number) =>
    score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const healthRing = (score: number) =>
    score >= 80 ? "stroke-emerald-500" : score >= 60 ? "stroke-amber-500" : "stroke-rose-500";

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;
  }

  const score = data?.businessHealthScore ?? 0;
  const circ = 2 * Math.PI * 36;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="space-y-4" data-testid="tab-briefing">
      {/* Header card */}
      <div className="flex items-start gap-4 p-5 rounded-xl border bg-card">
        <div className="relative shrink-0">
          <svg className="-rotate-90 h-20 w-20" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" strokeWidth="6" stroke="currentColor" className="text-muted/30" />
            <circle cx="40" cy="40" r="36" fill="none" strokeWidth="6" strokeLinecap="round"
              className={healthRing(score)} strokeDasharray={circ} strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.8s ease" }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-extrabold ${healthColor(score)}`}>{score}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold">Executive Briefing</h2>
            <Badge variant="outline" className="text-[10px]">{format(new Date(), "EEEE, MMMM d, yyyy")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Business Health Score: <span className={`font-bold ${healthColor(score)}`}>{score}/100</span></p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
            {[
              { label: "Meetings", value: data?.stats.meetingsToday ?? 0, good: true },
              { label: "Outreach", value: data?.stats.followUps ?? 0, good: true },
              { label: "Opportunities", value: data?.stats.openOpportunities ?? 0, good: true },
              { label: "Approvals", value: data?.stats.pendingApprovals ?? 0, good: (data?.stats.pendingApprovals ?? 0) === 0 },
              { label: "Alerts", value: data?.stats.criticalAlerts ?? 0, good: (data?.stats.criticalAlerts ?? 0) === 0 },
              { label: "Failed WF", value: data?.stats.failedWorkflows ?? 0, good: (data?.stats.failedWorkflows ?? 0) === 0 },
            ].map(s => (
              <div key={s.label} className="text-center p-2 rounded-lg bg-muted/40">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-lg font-bold ${s.good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-briefing">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Wins */}
        <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10" data-testid="section-wins">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Top Wins</h3>
          </div>
          <div className="space-y-2">
            {(data?.wins ?? []).map((win, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-sm">{win}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Risks */}
        <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10" data-testid="section-risks">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Risks</h3>
          </div>
          {(data?.risks ?? []).length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />No risks detected — all systems operational.
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.risks ?? []).map((risk, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-sm">{risk}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Opportunities */}
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10" data-testid="section-opps">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300">Opportunities</h3>
          </div>
          <div className="space-y-2">
            {(data?.opportunities ?? []).map((opp, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CircleDot className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-sm">{opp}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Actions */}
        <div className="p-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10" data-testid="section-recommended-actions">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-300">Recommended Actions</h3>
          </div>
          <div className="space-y-2.5">
            {(data?.recommendedActions ?? []).map((rec, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="h-5 w-5 rounded-full bg-violet-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{rec.rank}</div>
                <div>
                  <p className="text-sm font-medium">{rec.action}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{rec.reason} · <span className="text-violet-600 dark:text-violet-400 font-medium">{rec.impact}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Revenue Forecast ─────────────────────────────────────────────────────

function ForecastTab() {
  const [selected, setSelected] = useState("7d");
  const { data, isLoading } = useQuery<Forecast>({ queryKey: ["/api/executive/forecast"], staleTime: 10 * 60_000 });

  const window = data?.windows.find(w => w.period === selected);

  return (
    <div className="space-y-4" data-testid="tab-forecast">
      {/* Period selector */}
      <div className="flex gap-2">
        {(data?.windows ?? [{ period: "7d", label: "7 Day" }, { period: "30d", label: "30 Day" }, { period: "90d", label: "90 Day" }]).map((w: any) => (
          <button key={w.period} onClick={() => setSelected(w.period)}
            data-testid={`forecast-period-${w.period}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selected === w.period ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {w.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Projected Revenue",    value: `$${(window?.projected ?? 0).toLocaleString()}`,    color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", icon: TrendingUp },
              { label: "Revenue At Risk",       value: `$${(window?.atRisk ?? 0).toLocaleString()}`,       color: "text-rose-600 dark:text-rose-400",       bg: "bg-rose-500/10",    icon: AlertTriangle },
              { label: "Recovery Opportunity",  value: `$${(window?.recovery ?? 0).toLocaleString()}`,     color: "text-blue-600 dark:text-blue-400",        bg: "bg-blue-500/10",    icon: Target },
              { label: "Pipeline Velocity",     value: `${window?.pipelineVelocity ?? 0} opps`,            color: "text-violet-600 dark:text-violet-400",     bg: "bg-violet-500/10",  icon: Activity },
            ].map(m => {
              const Icon = m.icon;
              return (
                <div key={m.label} className={`p-4 rounded-xl border ${m.bg}`} data-testid={`forecast-metric-${m.label}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                    <span className="text-[10px] text-muted-foreground">{m.label}</span>
                  </div>
                  <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                </div>
              );
            })}
          </div>

          {/* Confidence */}
          {window && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Forecast Confidence</span>
                <span className={`text-sm font-bold ${window.confidence >= 75 ? "text-emerald-600 dark:text-emerald-400" : window.confidence >= 55 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{window.confidence}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${window.confidence >= 75 ? "bg-emerald-500" : window.confidence >= 55 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${window.confidence}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {window.confidence >= 75 ? "High confidence — based on strong historical data" : window.confidence >= 55 ? "Moderate confidence — limited historical data available" : "Low confidence — insufficient activity data for accurate projection"}
              </p>
            </div>
          )}

          {/* Pipeline summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Total Pipeline Value</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${(data?.pipelineValue ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">{data?.pipelineCount ?? 0} open opportunities</p>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Top Opportunities</p>
              <div className="space-y-1.5 mt-1">
                {(data?.topOpportunities ?? []).slice(0, 3).map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="truncate mr-2 text-muted-foreground">{o.title}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">${(o.value ?? 0).toLocaleString()}</span>
                  </div>
                ))}
                {(data?.topOpportunities ?? []).length === 0 && <p className="text-xs text-muted-foreground">No opportunities tracked yet</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Bottleneck Detection ─────────────────────────────────────────────────

function BottlenecksTab() {
  const { data, isLoading } = useQuery<Bottlenecks>({ queryKey: ["/api/executive/bottlenecks"], staleTime: 5 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-bottlenecks">
      {data && (
        <div className="flex items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {data.critical > 0 && (
              <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{data.critical} Critical</Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">{data.total} Bottleneck{data.total !== 1 ? "s" : ""} Detected</Badge>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            Analyzed {data.generatedAt ? formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true }) : ""}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.bottlenecks ?? []).map(b => {
            const cfg = RISK_CONFIG[b.severity] ?? RISK_CONFIG.info;
            return (
              <div key={b.id} className={`p-4 rounded-xl border ${cfg.border} ${cfg.bg}`} data-testid={`bottleneck-${b.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`h-2 w-2 rounded-full ${cfg.dot} shrink-0 mt-2`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold">{b.problem}</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${cfg.color}`}>{b.severity}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{b.impact}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${cfg.color}`}>{b.metric}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex items-start gap-2">
                  <Zap className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cfg.color}`} />
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Recommended Fix</p>
                    <p className="text-xs">{b.fix}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Predictive Risk Monitor ─────────────────────────────────────────────

function RisksTab() {
  const { data, isLoading } = useQuery<Risks>({ queryKey: ["/api/executive/risks"], staleTime: 5 * 60_000 });

  const LEVEL_ORDER = ["critical", "high", "moderate", "medium", "low"];
  const sorted = [...(data?.risks ?? [])].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));

  return (
    <div className="space-y-4" data-testid="tab-risks">
      {/* Summary */}
      {data?.summary && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Critical", value: data.summary.critical, level: "critical" },
            { label: "High",     value: data.summary.high,     level: "high" },
            { label: "Moderate", value: data.summary.moderate + (data.summary as any).medium, level: "moderate" },
            { label: "Low",      value: data.summary.low,      level: "low" },
          ].map(s => {
            const cfg = RISK_CONFIG[s.level];
            return (
              <div key={s.label} className={`p-3 rounded-lg border text-center ${cfg.border} ${cfg.bg}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-2xl font-bold ${cfg.color}`}>{s.value}</p>
              </div>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {sorted.map(risk => {
            const cfg = RISK_CONFIG[risk.level] ?? RISK_CONFIG.info;
            return (
              <div key={risk.id} className={`p-4 rounded-xl border ${cfg.border}`} data-testid={`risk-${risk.id}`}>
                <div className="flex items-start gap-3">
                  <div className={`h-2 w-2 rounded-full ${cfg.dot} shrink-0 mt-2`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{risk.title}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${cfg.color}`}>{risk.level}</Badge>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{risk.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{risk.description}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Probability</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${cfg.dot}`} style={{ width: `${risk.probability}%` }} />
                          </div>
                          <span className={`text-xs font-semibold ${cfg.color}`}>{risk.probability}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Business Impact</p>
                        <p className="text-xs mt-1">{risk.impact}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Mitigation</p>
                        <p className="text-xs mt-1">{risk.mitigation}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Strategic Recommendations ───────────────────────────────────────────

function RecommendationsTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<Recommendations>({ queryKey: ["/api/executive/recommendations"], staleTime: 10 * 60_000 });
  const [actionedIds, setActionedIds] = useState<Record<string, string>>({});

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const r = await apiRequest("POST", `/api/executive/recommendations/${id}/action`, { action });
      return r.json();
    },
    onSuccess: (data: any, vars: any) => {
      setActionedIds(prev => ({ ...prev, [vars.id]: vars.action }));
      toast({ title: data.message ?? "Action recorded." });
    },
    onError: () => toast({ title: "Failed to process recommendation", variant: "destructive" }),
  });

  const categoryColors: Record<string, string> = {
    Revenue:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    Workforce:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    Governance: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    Operations: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  };

  return (
    <div className="space-y-4" data-testid="tab-recommendations">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data?.total ?? 0} strategic recommendations · ranked by confidence
        </p>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.recommendations ?? []).map((rec, idx) => {
            const actioned = actionedIds[rec.id];
            const effortCfg = EFFORT_CONFIG[rec.effort] ?? EFFORT_CONFIG.Medium;
            return (
              <div key={rec.id} className={`p-4 rounded-xl border bg-card transition-opacity ${actioned ? "opacity-60" : ""}`} data-testid={`rec-${rec.id}`}>
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">{idx + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{rec.title}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 h-4 ${categoryColors[rec.category] ?? "bg-muted text-muted-foreground"}`}>{rec.category}</Badge>
                      {actioned && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 h-4 capitalize ${actioned === "approve" ? "text-emerald-600 dark:text-emerald-400" : actioned === "reject" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {actioned === "approve" ? "✓ Approved" : actioned === "reject" ? "✗ Rejected" : "⏱ Scheduled"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.description}</p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Expected Impact</p>
                        <p className="text-xs mt-0.5 text-emerald-600 dark:text-emerald-400 font-medium">{rec.impact}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Confidence</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${rec.confidence >= 75 ? "bg-emerald-500" : rec.confidence >= 55 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${rec.confidence}%` }} />
                          </div>
                          <span className="text-xs font-semibold">{rec.confidence}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Effort</p>
                        <p className={`text-xs mt-0.5 font-medium ${effortCfg.color}`}>{effortCfg.label}</p>
                      </div>
                    </div>
                  </div>
                </div>
                {!actioned && (
                  <div className="flex gap-2 mt-3 pt-3 border-t">
                    <Button size="sm" className="h-7 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => actionMutation.mutate({ id: rec.id, action: "approve" })}
                      disabled={actionMutation.isPending}
                      data-testid={`button-approve-rec-${rec.id}`}>
                      <CheckCircle className="h-3 w-3 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1"
                      onClick={() => actionMutation.mutate({ id: rec.id, action: "schedule" })}
                      disabled={actionMutation.isPending}
                      data-testid={`button-schedule-rec-${rec.id}`}>
                      <Clock className="h-3 w-3 mr-1" />Schedule
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1 border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400"
                      onClick={() => actionMutation.mutate({ id: rec.id, action: "reject" })}
                      disabled={actionMutation.isPending}
                      data-testid={`button-reject-rec-${rec.id}`}>
                      <XCircle className="h-3 w-3 mr-1" />Reject
                    </Button>
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

// ─── Tab: Executive Scorecards ─────────────────────────────────────────────────

function ScorecardsTab() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading } = useQuery<Scorecards>({ queryKey: ["/api/executive/scorecards"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-scorecards">
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(data?.scorecards ?? []).map(sc => {
            const colors = DOMAIN_COLORS[sc.color] ?? DOMAIN_COLORS.blue;
            const isExpanded = expanded === sc.domain;
            return (
              <div key={sc.domain}
                className={`rounded-xl border bg-card overflow-hidden cursor-pointer transition-all hover:shadow-md ${isExpanded ? "ring-2 ring-primary/30" : ""}`}
                data-testid={`scorecard-${sc.domain.toLowerCase()}`}
                onClick={() => setExpanded(isExpanded ? null : sc.domain)}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <RingScore score={sc.score} color={sc.color} size={56} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-sm font-extrabold ${colors.text}`}>{sc.score}</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{sc.domain}</h3>
                        <TrendIcon trend={sc.trend} />
                      </div>
                      <div className="mt-1.5">
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-muted-foreground">Score</span>
                          <span className={`font-semibold ${colors.text}`}>{sc.score}/100</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${sc.score}%` }} />
                        </div>
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </div>
                </div>
                {isExpanded && (
                  <div className={`px-4 pb-4 border-t ${colors.bg} space-y-1.5`}>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium pt-3">Key Signals</p>
                    {sc.highlights.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className={`h-1.5 w-1.5 rounded-full ${colors.bar} shrink-0`} />
                        <span>{h}</span>
                      </div>
                    ))}
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

// ─── Tab: AI Boardroom ─────────────────────────────────────────────────────────

const BOARDROOM_PROMPTS = [
  "What is currently limiting our growth?",
  "What opportunities are we missing?",
  "Where should resources be allocated this week?",
  "What should the AI workforce prioritize next week?",
  "What is our biggest revenue risk right now?",
  "Which agents are delivering the most value?",
];

type ChatMessage = { role: "user" | "assistant"; content: string; time: string };

function BoardroomTab() {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const boardroomMutation = useMutation({
    mutationFn: async (q: string) => {
      const r = await apiRequest("POST", "/api/executive/boardroom", { question: q });
      return r.json();
    },
    onSuccess: (data: any) => {
      setHistory(prev => [
        ...prev,
        { role: "assistant", content: data.answer, time: new Date().toLocaleTimeString() },
      ]);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: () => toast({ title: "Failed to get AI response", variant: "destructive" }),
  });

  const handleAsk = (q: string) => {
    if (!q.trim()) return;
    const qText = q.trim();
    setHistory(prev => [...prev, { role: "user", content: qText, time: new Date().toLocaleTimeString() }]);
    setQuestion("");
    boardroomMutation.mutate(qText);
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  return (
    <div className="space-y-4" data-testid="tab-boardroom">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <Brain className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">AI CEO Advisor</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Ask any strategic question. The AI analyzes your actual business data and provides executive-level answers.</p>
        </div>
      </div>

      {/* Suggested questions */}
      {history.length === 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">Suggested questions:</p>
          <div className="flex flex-wrap gap-2">
            {BOARDROOM_PROMPTS.map(p => (
              <button key={p} onClick={() => handleAsk(p)}
                data-testid={`boardroom-prompt-${p.slice(0, 20)}`}
                className="px-3 py-1.5 rounded-full border bg-card text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat history */}
      {history.length > 0 && (
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {history.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-violet-500/10"}`}>
                {msg.role === "user" ? <span className="text-xs font-bold">You</span> : <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
              </div>
              <div className={`flex-1 max-w-[85%] ${msg.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block p-3 rounded-xl text-sm text-left ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border rounded-tl-sm"}`}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{msg.time}</p>
              </div>
            </div>
          ))}
          {boardroomMutation.isPending && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400 animate-pulse" />
              </div>
              <div className="p-3 rounded-xl border bg-card">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => <div key={i} className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask the AI CEO Advisor a strategic question..."
          className="text-sm min-h-16 max-h-32 resize-none"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(question); } }}
          data-testid="input-boardroom-question"
        />
        <Button onClick={() => handleAsk(question)} disabled={!question.trim() || boardroomMutation.isPending} className="shrink-0 h-16" data-testid="button-boardroom-ask">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {history.length > 0 && (
        <button onClick={() => setHistory([])} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Clear conversation
        </button>
      )}
    </div>
  );
}

// ─── Tab: Weekly CEO Report ────────────────────────────────────────────────────

function ReportTab() {
  const { data, isLoading } = useQuery<WeeklyReport>({ queryKey: ["/api/executive/weekly-report"], staleTime: 10 * 60_000 });

  const sections = [
    {
      title: "Executive Summary",
      icon: Trophy,
      color: "text-primary",
      content: data ? [
        `${data.executiveSummary.totalActions} total agent actions with ${data.executiveSummary.successRate}% success rate`,
        `${data.executiveSummary.activeAgents} agents actively executing tasks`,
        `$${Number(data.executiveSummary.revenueInfluenced ?? 0).toLocaleString()} in AI-influenced revenue`,
        `${data.executiveSummary.hoursSaved?.toFixed?.(1) ?? 0} hours of labor saved through automation`,
      ] : [],
    },
    {
      title: "Revenue",
      icon: DollarSign,
      color: "text-emerald-600 dark:text-emerald-400",
      content: data ? [
        `Revenue generated: $${Number(data.revenue.generated ?? 0).toLocaleString()}`,
        `Revenue influenced: $${Number(data.revenue.influenced ?? 0).toLocaleString()}`,
        `Revenue recovered: $${Number(data.revenue.recovered ?? 0).toLocaleString()}`,
        `Pipeline value: $${Number(data.revenue.pipelineValue ?? 0).toLocaleString()} across ${data.revenue.openOpportunities} opportunities`,
      ] : [],
    },
    {
      title: "Operations",
      icon: Settings,
      color: "text-violet-600 dark:text-violet-400",
      content: data ? [
        `${data.operations.totalWorkflows} workflows tracked: ${data.operations.successfulWorkflows} successful, ${data.operations.failedWorkflows} failed`,
        `${data.operations.totalAgentActions} automated agent actions executed`,
        `${data.operations.automationHours?.toFixed?.(1) ?? 0} hours of automation time delivered`,
      ] : [],
    },
    {
      title: "Workforce",
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      content: data ? [
        `${data.workforce.activeAgents} of ${data.workforce.totalAgents} configured agents were active`,
        `Top performer this week: ${data.workforce.topPerformer}`,
        `$${Number(data.workforce.laborSaved ?? 0).toLocaleString()} in estimated labor savings`,
      ] : [],
    },
    {
      title: "Open Opportunities",
      icon: Target,
      color: "text-amber-600 dark:text-amber-400",
      content: (data?.opportunities ?? []).map((o: any) => `${o.title} — $${Number(o.value ?? 0).toLocaleString()}`),
    },
  ];

  return (
    <div className="space-y-4" data-testid="tab-report">
      {data && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold">Weekly CEO Report</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Period: {data.period ? `${format(new Date(data.period.start), "MMM d")} — ${format(new Date(data.period.end), "MMM d, yyyy")}` : "Last 7 days"}
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" data-testid="button-download-report">
            <Download className="h-3.5 w-3.5" />Export Report
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {sections.map(section => {
            const Icon = section.icon;
            return (
              <div key={section.title} className="p-4 rounded-xl border bg-card" data-testid={`report-section-${section.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`h-4 w-4 ${section.color}`} />
                  <h4 className="text-sm font-semibold">{section.title}</h4>
                </div>
                {section.content.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No data available for this period.</p>
                ) : (
                  <div className="space-y-1.5">
                    {section.content.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0 mt-1.5" />
                        <span>{item}</span>
                      </div>
                    ))}
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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminExecutiveIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>("briefing");

  const { data: briefing } = useQuery<Briefing>({ queryKey: ["/api/executive/briefing"], staleTime: 5 * 60_000 });
  const { data: risks } = useQuery<Risks>({ queryKey: ["/api/executive/risks"], staleTime: 5 * 60_000 });

  const criticalCount = risks?.summary?.critical ?? 0;
  const healthScore = briefing?.businessHealthScore ?? 0;
  const healthColor = healthScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : healthScore >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-executive-intelligence">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/ai-operations">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />AI Operations
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Executive Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Strategic AI advisor — interpreting your business data into actionable decisions.
          </p>
        </div>

        {/* Health summary */}
        {briefing && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Health Score</p>
              <p className={`text-2xl font-extrabold ${healthColor}`}>{healthScore}</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Risks</p>
              <p className={`text-2xl font-extrabold ${criticalCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{criticalCount}</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Opps</p>
              <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">{briefing.stats?.openOpportunities ?? 0}</p>
            </div>
          </div>
        )}
      </div>

      {/* Architecture breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup Wizard",     href: "/admin/ai-workforce" },
          { label: "Workforce Mgmt",   href: "/admin/ai-workforce/settings" },
          { label: "Operations",       href: "/admin/ai-operations" },
          { label: "Executive Intel",  href: null, active: true },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href ? (
              <Link href={step.href}>
                <span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span>
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{step.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasBadge = tab.id === "risks" && criticalCount > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {hasBadge && (
                <span className="h-4 w-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ml-0.5">
                  {criticalCount > 9 ? "9+" : criticalCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "briefing"        && <BriefingTab />}
        {activeTab === "forecast"        && <ForecastTab />}
        {activeTab === "bottlenecks"     && <BottlenecksTab />}
        {activeTab === "risks"           && <RisksTab />}
        {activeTab === "recommendations" && <RecommendationsTab />}
        {activeTab === "scorecards"      && <ScorecardsTab />}
        {activeTab === "boardroom"       && <BoardroomTab />}
        {activeTab === "report"          && <ReportTab />}
      </div>
    </div>
  );
}
