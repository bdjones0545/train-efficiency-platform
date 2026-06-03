import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Shield, TrendingUp, BarChart3, Activity, ChevronRight,
  DollarSign, CheckCircle, XCircle, AlertTriangle, Star, Zap, Lock,
  Unlock, RefreshCw, RotateCcw, FlaskConical, BookOpen, Trophy,
  ArrowUp, Minus, Clock, Cpu, Users, Target, Eye, Award, Layers,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────────────────

type Oversight = {
  trustScore: number; trustLevel: string;
  trustBreakdown: { reliability: number; accuracy: number; safety: number; roi: number };
  roi: { generated: number; influenced: number; recovered: number; laborSaved: number; hoursSaved: number; roiPct: number; totalValue: number };
  safetyStatus: string; recentChanges: any[]; rollbackAvailable: number;
  highRiskActions: number; recAccuracy: number; generatedAt: string;
};

type ROIData = {
  period: string; generated: number; influenced: number; recovered: number; protected: number;
  laborHoursSaved: number; laborValueSaved: number; costAvoided: number; totalValue: number;
  estimatedCost: number; roiPct: number; costPerAction: number;
  agentROI: { agentName: string; agentType: string; direct: number; assisted: number; totalValue: number; totalActions: number; successRate: number; laborSaved: number }[];
  trend7d: { generated: number; influenced: number; hoursSaved: number };
  generatedAt: string;
};

type Attribution = {
  agentAttribution: { agentName: string; agentType: string; direct: number; assisted: number; total: number; confidence: number; attributionShare: number; totalActions: number }[];
  funnel: { stage: string; count: number; color: string }[];
  totalAttributed: number; topAgent: any; generatedAt: string;
};

type AuditData = {
  actions: any[];
  changeLog: { id: string; date: string; agent: string; agentType: string; action: string; toolName?: string; status: string; revenueImpact: number; isReversible: boolean }[];
  total: number; generatedAt: string;
};

type SafetyData = {
  categories: { name: string; description: string; risk: string; examples: string[]; status: string }[];
  riskScore: number; riskLevel: string; recentViolations: number; blockedActions: number;
  approvalRequired: boolean; maxAutonomyLevel: string; generatedAt: string;
};

type RecEffectiveness = {
  recommendations: any[];
  stats: { approved: number; rejected: number; successful: number; failed: number; totalROI: number; accuracy: number };
  generatedAt: string;
};

type LabResult = {
  manual: { revenue: number; hoursSpent: number; conversionRate: number; responseTime: string; label: string };
  autonomous: { revenue: number; hoursSpent: number; conversionRate: number; responseTime: string; label: string };
  winner: string; lift: number; metric: string; confidence: number; generatedAt: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

const RISK_CFG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  high:     { color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/20",     border: "border-rose-200 dark:border-rose-800",    dot: "bg-rose-500" },
  medium:   { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500" },
  low:      { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500" },
  safe:     { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500" },
  warning:  { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500" },
  critical: { color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/20",     border: "border-rose-200 dark:border-rose-800",     dot: "bg-rose-500" },
};

function ProgressBar({ value, color = "bg-primary", height = "h-2" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function TrustRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const stroke = score >= 90 ? "stroke-emerald-500" : score >= 75 ? "stroke-blue-500" : score >= 55 ? "stroke-amber-500" : "stroke-rose-500";
  const text = score >= 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 75 ? "text-blue-600 dark:text-blue-400" : score >= 55 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={size * 0.07} stroke="currentColor" className="text-muted/30" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={size * 0.07} strokeLinecap="round" className={stroke} strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-extrabold ${size >= 80 ? "text-xl" : "text-sm"} ${text}`}>{score}</span>
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "oversight",    label: "Oversight",     icon: Eye },
  { id: "roi",          label: "ROI Center",    icon: DollarSign },
  { id: "attribution",  label: "Attribution",   icon: Target },
  { id: "audit",        label: "Change Log",    icon: BookOpen },
  { id: "safety",       label: "Safety",        icon: Shield },
  { id: "effectiveness",label: "Effectiveness", icon: Award },
  { id: "lab",          label: "Perf Lab",      icon: FlaskConical },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Executive Oversight ─────────────────────────────────────────────────

function OversightTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<Oversight>({
    queryKey: ["/api/autonomy/oversight"],
    staleTime: 3 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>;

  const safetyCfg = RISK_CFG[data?.safetyStatus ?? "safe"];

  return (
    <div className="space-y-4" data-testid="tab-oversight">
      {/* Trust score hero */}
      <div className="flex items-start gap-5 p-5 rounded-xl border bg-card">
        <TrustRing score={data?.trustScore ?? 0} size={96} />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-base font-bold">Executive Trust Score</h2>
            <Badge className="bg-primary/10 text-primary text-xs font-semibold">{data?.trustLevel}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Composite score across reliability, accuracy, safety, and ROI performance</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Reliability", value: data?.trustBreakdown.reliability ?? 0, color: "bg-blue-500" },
              { label: "Accuracy",    value: data?.trustBreakdown.accuracy ?? 0,    color: "bg-violet-500" },
              { label: "Safety",      value: data?.trustBreakdown.safety ?? 0,      color: "bg-emerald-500" },
              { label: "ROI",         value: data?.trustBreakdown.roi ?? 0,         color: "bg-amber-500" },
            ].map(m => (
              <div key={m.label}>
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className="font-bold">{m.value}</span>
                </div>
                <ProgressBar value={m.value} color={m.color} />
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-oversight">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* 6-metric executive grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Trust Score",      value: `${data?.trustScore ?? 0}`, icon: Star,        color: "text-primary" },
          { label: "30d ROI",          value: `${data?.roi.roiPct ?? 0}%`, icon: TrendingUp,  color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Total Value",      value: `$${Math.round(data?.roi.totalValue ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Rollback Ready",   value: `${data?.rollbackAvailable ?? 0}`, icon: RotateCcw,  color: "text-amber-600 dark:text-amber-400" },
          { label: "Rec Accuracy",     value: `${data?.recAccuracy ?? 0}%`, icon: Award,       color: "text-blue-600 dark:text-blue-400" },
          { label: "Safety",           value: data?.safetyStatus === "safe" ? "✓ Safe" : "⚠ Review", icon: Shield, color: safetyCfg.color },
        ].map(m => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`oversight-kpi-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <Icon className={`h-4 w-4 mx-auto mb-1 ${m.color}`} />
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          );
        })}
      </div>

      {/* Recent changes + ROI snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Recent Changes</h3>
          </div>
          {(data?.recentChanges ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No recent changes recorded.</p>
          ) : (
            <div className="space-y-2">
              {(data?.recentChanges ?? []).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className={`h-1.5 w-1.5 rounded-full ${c.status === "completed" || c.status === "success" ? "bg-emerald-500" : c.status === "failed" ? "bg-rose-500" : "bg-amber-500"} shrink-0`} />
                  <span className="text-muted-foreground shrink-0">{c.date ? format(new Date(c.date), "MMM d") : "—"}</span>
                  <span className="font-medium">{c.agent}</span>
                  <span className="text-muted-foreground truncate">{c.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`p-4 rounded-xl border ${safetyCfg.border} ${safetyCfg.bg}`}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className={`h-4 w-4 ${safetyCfg.color}`} />
            <h3 className="text-sm font-semibold">Safety Status</h3>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ml-auto capitalize ${safetyCfg.color}`}>{data?.safetyStatus ?? "safe"}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            {[
              { label: "High-Risk Actions",  value: data?.highRiskActions ?? 0,   bad: (data?.highRiskActions ?? 0) > 0 },
              { label: "Rollback Available", value: data?.rollbackAvailable ?? 0, bad: false },
            ].map(s => (
              <div key={s.label} className="p-2 rounded-lg bg-background/50">
                <p className="text-[9px] text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold ${s.bad ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Approval required: <span className="font-semibold">{data?.safetyStatus !== "safe" ? "⚠ Review governance settings" : "Configured correctly"}</span></p>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: ROI Command Center ───────────────────────────────────────────────────

function ROITab() {
  const [period, setPeriod] = useState("30d");
  const { data, isLoading } = useQuery<ROIData>({
    queryKey: ["/api/autonomy/roi", period],
    queryFn: async () => {
      const r = await fetch(`/api/autonomy/roi?period=${period}`, { credentials: "include" });
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4" data-testid="tab-roi">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5">
          {["7d", "30d", "90d"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} data-testid={`roi-period-${p}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
            </button>
          ))}
        </div>
        {data?.roiPct != null && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{data.roiPct}% ROI</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <>
          {/* Main metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Revenue Generated",    value: `$${Math.round(data?.generated ?? 0).toLocaleString()}`,       color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Revenue Influenced",   value: `$${Math.round(data?.influenced ?? 0).toLocaleString()}`,      color: "text-blue-600 dark:text-blue-400",        bg: "bg-blue-500/10" },
              { label: "Revenue Recovered",    value: `$${Math.round(data?.recovered ?? 0).toLocaleString()}`,       color: "text-violet-600 dark:text-violet-400",    bg: "bg-violet-500/10" },
              { label: "Labor Hours Saved",    value: `${(data?.laborHoursSaved ?? 0).toFixed(1)}h`,                 color: "text-amber-600 dark:text-amber-400",      bg: "bg-amber-500/10" },
              { label: "Labor Value Saved",    value: `$${Math.round(data?.laborValueSaved ?? 0).toLocaleString()}`, color: "text-orange-600 dark:text-orange-400",    bg: "bg-orange-500/10" },
              { label: "Total AI Value",       value: `$${Math.round(data?.totalValue ?? 0).toLocaleString()}`,      color: "text-primary",                            bg: "bg-primary/10" },
            ].map(m => (
              <div key={m.label} className={`p-4 rounded-xl border ${m.bg}`} data-testid={`roi-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className="text-[10px] text-muted-foreground mb-1">{m.label}</p>
                <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* ROI calculation */}
          {data && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">ROI Calculation</h3>
              </div>
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <div className="text-center"><p className="text-[10px] text-muted-foreground">Total Value</p><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">${Math.round(data.totalValue).toLocaleString()}</p></div>
                <div className="text-muted-foreground">÷</div>
                <div className="text-center"><p className="text-[10px] text-muted-foreground">Platform Cost</p><p className="text-lg font-bold">${data.estimatedCost}/mo</p></div>
                <div className="text-muted-foreground">=</div>
                <div className="text-center"><p className="text-[10px] text-muted-foreground">ROI</p><p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{data.roiPct}%</p></div>
              </div>
            </div>
          )}

          {/* Per-agent ROI table */}
          {(data?.agentROI ?? []).filter(a => a.totalActions > 0).length > 0 && (
            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b">
                <h3 className="text-xs font-semibold">Agent ROI Breakdown</h3>
              </div>
              <div className="divide-y">
                {(data?.agentROI ?? []).filter(a => a.totalActions > 0).slice(0, 8).map(agent => (
                  <div key={agent.agentType} className="flex items-center gap-3 px-4 py-2.5" data-testid={`agent-roi-${agent.agentType}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{agent.agentName}</p>
                      <p className="text-[10px] text-muted-foreground">{agent.totalActions} actions · {agent.successRate}% success</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${Math.round(agent.totalValue).toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">total value</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Attribution ─────────────────────────────────────────────────────────

function AttributionTab() {
  const { data, isLoading } = useQuery<Attribution>({ queryKey: ["/api/autonomy/attribution"], staleTime: 5 * 60_000 });

  const FUNNEL_COLORS: Record<string, string> = { blue: "bg-blue-500", violet: "bg-violet-500", amber: "bg-amber-500", orange: "bg-orange-500", emerald: "bg-emerald-500" };
  const maxFunnel = Math.max(1, ...(data?.funnel ?? []).map(f => f.count));

  return (
    <div className="space-y-4" data-testid="tab-attribution">
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <>
          {/* Top attribution summary */}
          {data?.topAgent && (
            <div className="flex items-center gap-4 p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-800">
              <Trophy className="h-8 w-8 text-emerald-500 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Top Revenue Agent</p>
                <p className="text-sm font-bold mt-0.5">{data.topAgent.agentName}</p>
                <p className="text-xs text-muted-foreground">$<span className="font-semibold text-emerald-600 dark:text-emerald-400">{Math.round(data.topAgent.total).toLocaleString()}</span> attributed · {data.topAgent.totalActions} actions</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{data.topAgent.attributionShare}%</p>
                <p className="text-[10px] text-muted-foreground">of pipeline</p>
              </div>
            </div>
          )}

          {/* Multi-touch funnel */}
          <div className="p-4 rounded-xl border bg-card">
            <h3 className="text-sm font-semibold mb-3">Revenue Attribution Funnel</h3>
            <div className="space-y-2.5">
              {(data?.funnel ?? []).map((stage, i) => (
                <div key={stage.stage} className="flex items-center gap-3" data-testid={`funnel-${stage.stage.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-[10px] text-muted-foreground w-24 text-right shrink-0">{stage.stage}</span>
                  <div className="flex-1 h-6 rounded-lg bg-muted overflow-hidden">
                    <div className={`h-full rounded-lg ${FUNNEL_COLORS[stage.color] ?? "bg-primary"} flex items-center px-2 transition-all`} style={{ width: `${Math.max(5, (stage.count / maxFunnel) * 100)}%` }}>
                      <span className="text-[10px] text-white font-bold">{stage.count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent attribution table */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b">
              <div className="grid grid-cols-5 text-[10px] text-muted-foreground font-medium">
                <span className="col-span-2">Agent</span>
                <span className="text-right">Direct</span>
                <span className="text-right">Assisted</span>
                <span className="text-right">Confidence</span>
              </div>
            </div>
            <div className="divide-y">
              {(data?.agentAttribution ?? []).slice(0, 8).map(agent => (
                <div key={agent.agentType} className="grid grid-cols-5 items-center px-4 py-2.5 gap-1" data-testid={`attribution-${agent.agentType}`}>
                  <div className="col-span-2 min-w-0">
                    <p className="text-xs font-medium truncate">{agent.agentName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <ProgressBar value={agent.attributionShare} color="bg-primary" height="h-1" />
                      <span className="text-[9px] text-muted-foreground shrink-0">{agent.attributionShare}%</span>
                    </div>
                  </div>
                  <span className="text-xs text-right font-medium text-emerald-600 dark:text-emerald-400">${Math.round(agent.direct).toLocaleString()}</span>
                  <span className="text-xs text-right text-muted-foreground">${Math.round(agent.assisted).toLocaleString()}</span>
                  <div className="flex justify-end">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${agent.confidence >= 80 ? "text-emerald-600 dark:text-emerald-400" : agent.confidence >= 60 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {agent.confidence}%
                    </Badge>
                  </div>
                </div>
              ))}
              {(data?.agentAttribution ?? []).length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No attribution data yet. Agents need to complete actions to generate attribution.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Change Log / Audit ──────────────────────────────────────────────────

function AuditTab() {
  const [filterStatus, setFilterStatus] = useState("all");
  const { data, isLoading } = useQuery<AuditData>({
    queryKey: ["/api/autonomy/audit"],
    staleTime: 2 * 60_000,
  });

  const filtered = filterStatus === "all" ? (data?.changeLog ?? []) : (data?.changeLog ?? []).filter(e => e.status === filterStatus);
  const statusColor: Record<string, string> = { completed: "text-emerald-600 dark:text-emerald-400", success: "text-emerald-600 dark:text-emerald-400", failed: "text-rose-600 dark:text-rose-400", error: "text-rose-600 dark:text-rose-400", pending: "text-amber-600 dark:text-amber-400" };

  return (
    <div className="space-y-4" data-testid="tab-audit">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[{ v: "all", l: "All" }, { v: "completed", l: "Success" }, { v: "failed", l: "Failed" }, { v: "pending", l: "Pending" }].map(f => (
            <button key={f.v} onClick={() => setFilterStatus(f.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === f.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              data-testid={`audit-filter-${f.v}`}>
              {f.l}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} entries</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-dashed">
          <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No change log entries</p>
          <p className="text-xs text-muted-foreground mt-1">Agent actions will appear here as they execute</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="divide-y">
            {filtered.slice(0, 100).map((entry, i) => (
              <div key={entry.id ?? i} className="flex items-start gap-3 px-4 py-3" data-testid={`audit-entry-${entry.id ?? i}`}>
                <div className={`h-1.5 w-1.5 rounded-full mt-2 shrink-0 ${statusColor[entry.status]?.replace("text-", "bg-").replace(" dark:text-emerald-400", "").replace(" dark:text-rose-400", "").replace(" dark:text-amber-400", "") ?? "bg-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{entry.agent}</span>
                    <span className="text-xs text-muted-foreground">{entry.action}</span>
                    {entry.toolName && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{entry.toolName}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-medium capitalize ${statusColor[entry.status] ?? "text-muted-foreground"}`}>{entry.status}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {entry.date ? formatDistanceToNow(new Date(entry.date), { addSuffix: true }) : ""}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Safety Center ───────────────────────────────────────────────────────

function SafetyTab() {
  const { data, isLoading } = useQuery<SafetyData>({ queryKey: ["/api/autonomy/safety"], staleTime: 5 * 60_000 });

  const CATEGORY_ICONS: Record<string, any> = { "Fully Autonomous": Zap, "Approval Required": CheckCircle, "Restricted": Lock };
  const CATEGORY_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };
  const riskCfg = data ? (data.riskScore >= 85 ? RISK_CFG.safe : data.riskScore >= 65 ? RISK_CFG.warning : RISK_CFG.high) : RISK_CFG.safe;

  return (
    <div className="space-y-4" data-testid="tab-safety">
      {/* Risk summary */}
      {data && (
        <div className={`flex items-center gap-4 p-4 rounded-xl border ${riskCfg.border} ${riskCfg.bg}`}>
          <Shield className={`h-8 w-8 ${riskCfg.color} shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">Autonomy Risk Score</h3>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${riskCfg.color}`}>{data.riskLevel}</Badge>
            </div>
            <ProgressBar value={data.riskScore} color={data.riskScore >= 85 ? "bg-emerald-500" : data.riskScore >= 65 ? "bg-amber-500" : "bg-rose-500"} />
          </div>
          <div className="text-right shrink-0">
            <p className={`text-2xl font-extrabold ${riskCfg.color}`}>{data.riskScore}</p>
            <p className="text-[10px] text-muted-foreground">/ 100</p>
          </div>
        </div>
      )}

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Recent Violations",   value: data.recentViolations, bad: data.recentViolations > 0 },
            { label: "Blocked Actions",     value: data.blockedActions,   bad: data.blockedActions > 0 },
            { label: "Approval Required",   value: data.approvalRequired ? "Yes" : "No", bad: !data.approvalRequired },
            { label: "Autonomy Level",      value: data.maxAutonomyLevel,  bad: false },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border bg-card text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className={`text-base font-bold mt-0.5 capitalize ${s.bad ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Permission categories */}
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.categories ?? []).map(cat => {
            const Icon = CATEGORY_ICONS[cat.name] ?? Shield;
            const col = CATEGORY_COLORS[cat.risk] ?? "text-muted-foreground";
            const STATUS_BADGE: Record<string, string> = { enabled: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", enforced: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", optional: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", blocked: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
            return (
              <div key={cat.name} className="p-4 rounded-xl border bg-card" data-testid={`safety-category-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 shrink-0 ${col}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{cat.name}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 h-4 capitalize ${STATUS_BADGE[cat.status] ?? "bg-muted text-muted-foreground"}`}>{cat.status}</Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${col}`}>{cat.risk} risk</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{cat.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.examples.map(ex => (
                        <span key={ex} className="px-2 py-0.5 rounded-md bg-muted text-[10px] text-muted-foreground">{ex}</span>
                      ))}
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

// ─── Tab: Recommendation Effectiveness ────────────────────────────────────────

function EffectivenessTab() {
  const { data, isLoading } = useQuery<RecEffectiveness>({ queryKey: ["/api/autonomy/recommendations-effectiveness"], staleTime: 5 * 60_000 });

  const OUTCOME_CFG: Record<string, { color: string; label: string; icon: any }> = {
    exceeded: { color: "text-emerald-600 dark:text-emerald-400", label: "Exceeded Expectations", icon: ArrowUp },
    met:      { color: "text-blue-600 dark:text-blue-400",       label: "Met Expectations",      icon: CheckCircle },
    missed:   { color: "text-rose-600 dark:text-rose-400",       label: "Missed Target",          icon: XCircle },
    pending:  { color: "text-muted-foreground",                  label: "Measuring",              icon: Clock },
  };

  return (
    <div className="space-y-4" data-testid="tab-effectiveness">
      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Approved",    value: data.stats.approved,    color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Rejected",    value: data.stats.rejected,    color: "text-rose-600 dark:text-rose-400" },
            { label: "Successful",  value: data.stats.successful,  color: "text-blue-600 dark:text-blue-400" },
            { label: "Failed",      value: data.stats.failed,      color: "text-amber-600 dark:text-amber-400" },
            { label: "Total ROI",   value: `$${Math.round(data.stats.totalROI).toLocaleString()}`, color: "text-primary" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border bg-card text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Recommendation Accuracy</span>
            <span className={`text-sm font-bold ${(data.stats.accuracy ?? 0) >= 75 ? "text-emerald-600 dark:text-emerald-400" : (data.stats.accuracy ?? 0) >= 50 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{data.stats.accuracy ?? 0}%</span>
          </div>
          <ProgressBar value={data.stats.accuracy ?? 0} color={(data.stats.accuracy ?? 0) >= 75 ? "bg-emerald-500" : "bg-amber-500"} />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {(data.stats.accuracy ?? 0) >= 75 ? "High accuracy — AI recommendations are well-calibrated" : "Building accuracy — more data needed for better calibration"}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.recommendations ?? []).map((rec: any) => {
            const outcomeCfg = OUTCOME_CFG[rec.outcome ?? "pending"] ?? OUTCOME_CFG.pending;
            const OutcomeIcon = outcomeCfg.icon;
            return (
              <div key={rec.id} className="p-4 rounded-xl border bg-card" data-testid={`rec-track-${rec.id}`}>
                <div className="flex items-start gap-3">
                  <OutcomeIcon className={`h-4 w-4 shrink-0 mt-0.5 ${outcomeCfg.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{rec.title}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${rec.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{rec.status}</Badge>
                      {rec.outcome && <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${outcomeCfg.color}`}>{outcomeCfg.label}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {rec.expected_impact && <div><span className="text-[9px] text-muted-foreground block uppercase tracking-wide">Expected</span>{rec.expected_impact}</div>}
                      {rec.actual_impact ? <div><span className="text-[9px] text-muted-foreground block uppercase tracking-wide">Actual</span><span className={outcomeCfg.color}>{rec.actual_impact}</span></div> : <div><span className="text-[9px] text-muted-foreground block uppercase tracking-wide">Actual</span><span className="text-muted-foreground italic">Measuring...</span></div>}
                      {rec.revenue_impact > 0 && <div><span className="text-[9px] text-muted-foreground block uppercase tracking-wide">Revenue Impact</span><span className="text-emerald-600 dark:text-emerald-400 font-semibold">${Number(rec.revenue_impact).toLocaleString()}</span></div>}
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

// ─── Tab: Performance Lab ─────────────────────────────────────────────────────

function LabTab() {
  const { toast } = useToast();
  const [metric, setMetric] = useState("overall");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<LabResult | null>(null);

  const compareMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/autonomy/lab/compare", { metric, description })).json(),
    onSuccess: (data: LabResult) => setResult(data),
    onError: () => toast({ title: "Comparison failed", variant: "destructive" }),
  });

  const metrics = [
    { value: "overall",    label: "Overall Performance" },
    { value: "revenue",    label: "Revenue Generation" },
    { value: "conversion", label: "Lead Conversion" },
    { value: "retention",  label: "Client Retention" },
    { value: "efficiency", label: "Time Efficiency" },
    { value: "scheduling", label: "Scheduling" },
  ];

  return (
    <div className="space-y-4" data-testid="tab-lab">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-blue-500/5 to-violet-500/5">
        <FlaskConical className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Autonomous vs Manual A/B Comparison</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Compare your AI autonomous system against estimated manual baseline performance using your actual business data.</p>
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Compare metric</label>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-lab-metric"><SelectValue /></SelectTrigger>
            <SelectContent>{metrics.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => compareMutation.mutate()} disabled={compareMutation.isPending} className="h-8 gap-1.5 shrink-0" data-testid="button-run-lab">
          <FlaskConical className="h-3.5 w-3.5" />{compareMutation.isPending ? "Analyzing..." : "Run Comparison"}
        </Button>
      </div>

      {result && (
        <div className="space-y-4" data-testid="lab-result">
          {/* Winner banner */}
          <div className="flex items-center gap-3 p-4 rounded-xl border bg-emerald-500/10 border-emerald-200 dark:border-emerald-800">
            <Trophy className="h-6 w-6 text-emerald-500 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Autonomous system wins by <span className="text-lg">+{result.lift}% lift</span></p>
              <p className="text-xs text-muted-foreground">Confidence: {result.confidence}% · Metric: {metrics.find(m => m.value === result.metric)?.label ?? result.metric}</p>
            </div>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { data: result.manual,     winner: false, label: "Version A — Manual" },
              { data: result.autonomous, winner: true,  label: "Version B — Autonomous" },
            ].map(side => (
              <div key={side.label} className={`p-4 rounded-xl border ${side.winner ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10" : "bg-card"}`} data-testid={`lab-version-${side.winner ? "b" : "a"}`}>
                <div className="flex items-center gap-2 mb-3">
                  {side.winner && <Trophy className="h-3.5 w-3.5 text-emerald-500" />}
                  <span className="text-xs font-semibold">{side.winner ? "Version B — Autonomous" : "Version A — Manual"}</span>
                  {side.winner && <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 h-4 px-1.5">Winner</Badge>}
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Weekly Revenue",    value: `$${side.data.revenue.toLocaleString()}` },
                    { label: "Hours Spent",       value: `${side.data.hoursSpent}h` },
                    { label: "Conversion Rate",   value: `${side.data.conversionRate}%` },
                    { label: "Response Time",     value: side.data.responseTime },
                  ].map(m => (
                    <div key={m.label} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className={`font-semibold ${side.winner ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground text-right">
            Simulated {result.generatedAt ? formatDistanceToNow(new Date(result.generatedAt), { addSuffix: true }) : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminTrustAttributionPage() {
  const [activeTab, setActiveTab] = useState<TabId>("oversight");

  const { data: oversight } = useQuery<Oversight>({ queryKey: ["/api/autonomy/oversight"], staleTime: 3 * 60_000 });

  const trustScore = oversight?.trustScore ?? 0;
  const safetyOk = oversight?.safetyStatus === "safe";
  const trustColor = trustScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : trustScore >= 75 ? "text-blue-600 dark:text-blue-400" : trustScore >= 55 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-trust-attribution">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/autonomous-management">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Autonomous Management
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Trust & Attribution
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Proving ROI, explaining decisions, and giving you complete executive control.
          </p>
        </div>

        {/* Live trust summary */}
        {oversight && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Trust Score</p>
              <p className={`text-2xl font-extrabold ${trustColor}`}>{trustScore}</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">30d ROI</p>
              <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{oversight.roi.roiPct}%</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Safety</p>
              <p className={`text-2xl font-extrabold ${safetyOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {safetyOk ? "✓" : "⚠"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Architecture breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup Wizard",         href: "/admin/ai-workforce" },
          { label: "Workforce Mgmt",        href: "/admin/ai-workforce/settings" },
          { label: "Operations",            href: "/admin/ai-operations" },
          { label: "Executive Intel",       href: "/admin/executive-intelligence" },
          { label: "Autonomous Mgmt",       href: "/admin/autonomous-management" },
          { label: "Trust & Attribution",   href: null, active: true },
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

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-trust">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasBadge = tab.id === "safety" && !safetyOk;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {hasBadge && <span className="h-2 w-2 rounded-full bg-amber-500 ml-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "oversight"     && <OversightTab />}
        {activeTab === "roi"           && <ROITab />}
        {activeTab === "attribution"   && <AttributionTab />}
        {activeTab === "audit"         && <AuditTab />}
        {activeTab === "safety"        && <SafetyTab />}
        {activeTab === "effectiveness" && <EffectivenessTab />}
        {activeTab === "lab"           && <LabTab />}
      </div>

      {/* Forward navigation → External Intelligence Network */}
      <Link href="/admin/market-intelligence">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5 hover:from-primary/10 hover:to-blue-500/10 transition-colors cursor-pointer group" data-testid="nav-market-intelligence">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">External Intelligence Network</p>
            <p className="text-xs text-muted-foreground mt-0.5">Monitor the market, track competitors, discover opportunities, and generate AI-powered growth intelligence.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
