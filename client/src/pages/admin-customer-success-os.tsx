import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { parseApiResponse } from "@/lib/api-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Heart, Zap, Eye, TrendingUp, AlertTriangle, DollarSign,
  Bot, BookOpen, Map, Users, Star, BarChart3, ChevronRight,
  CheckCircle, X, RefreshCw, ArrowUpRight, Target, Clock,
  Shield, Activity, MessageSquare, Send, Brain,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivationStep = { id: string; label: string; completed: boolean; completedAt: string | null };
type ActivationData = { steps: ActivationStep[]; activationScore: number; completedSteps: number; totalSteps: number; status: string; nextStep: ActivationStep | null; generatedAt: string };
type AdoptionGap = { feature: string; zone: string; lastUsed: string | null; daysSince: number | null; status: string; impact: string; recommendation: string };
type AdoptionData = { gaps: AdoptionGap[]; adoptionScore: number; neverUsed: number; dormant: number; benchmarkScore: number; belowBenchmark: boolean; generatedAt: string };
type HealthDimension = { label: string; score: number; weight: number; trend: string };
type HealthData = { healthScore: number; category: string; dimensions: HealthDimension[]; trend: string; generatedAt: string };
type ChurnRisk = { orgId: string; orgName: string; plan: string; mrr: number; churnProbability: number; riskLevel: string; signals: string[]; recommendedIntervention: string; mrrAtRisk: number };
type ChurnData = { risks: ChurnRisk[]; totalAtRisk: number; totalMrrAtRisk: number; critical: number; generatedAt: string };
type ExpansionOpp = { orgId: string; orgName: string; currentPlan: string; mrr: number; expansionProbability: number; recommendedUpgrade: string; expectedMrrIncrease: number; signals: string[]; readiness: string };
type ExpansionData = { opportunities: ExpansionOpp[]; totalOpportunities: number; totalExpansionMrr: number; readyNow: number; generatedAt: string };
type Playbook = { id: string; name: string; status: string; progress: number; steps: number; completedSteps: number; expectedOutcome: string; deployedAt: string | null; completedAt: string | null };
type PlaybooksData = { playbooks: Playbook[]; active: number; completed: number; available: number; generatedAt: string };
type JourneyStage = { id: string; label: string; completed: boolean; completedAt: string | null; milestone: string };
type JourneyData = { stages: JourneyStage[]; currentStage: string; nextStage: string; blockers: string[]; nextActions: { action: string; impact: string; timeEst: string }[]; daysOnPlatform: number; generatedAt: string };
type OrgRow = { id: string; name: string; plan: string; mrr: number; healthScore: number; activationScore: number; adoptionScore: number; churnRisk: number; expansionScore: number; nps: number; stage: string; joinedDays: number };
type PortfolioData = { portfolio: OrgRow[]; summary: { healthy: number; atRisk: number; critical: number; expansion: number; totalMrr: number; totalOrgs: number }; generatedAt: string };
type SatisfactionTheme = { theme: string; sentiment: string; count: number };
type SatisfactionData = { npsScore: number; avgNps: number; promoters: number; passives: number; detractors: number; themes: SatisfactionTheme[]; improvementAreas: string[]; generatedAt: string };
type ForecastWindow = { period: string; label: string; healthForecast: number; retentionForecast: number; expansionForecast: number; revenueForecast: number; churnRisk: number; confidence: number };
type ForecastData = { windows: ForecastWindow[]; keyDrivers: string[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 65 ? "bg-blue-500" : pct >= 45 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-bold text-muted-foreground w-5 text-right">{value}</span>
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const [label, cls] =
    score >= 85 ? ["Healthy",  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"] :
    score >= 70 ? ["Stable",   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"] :
    score >= 50 ? ["At Risk",  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"] :
                  ["Critical", "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"];
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cls}`}>{label}</Badge>;
}

function RiskBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[level] ?? "bg-muted text-muted-foreground"}`}>{level}</Badge>;
}

function ImpactBadge({ impact }: { impact: string }) {
  const cfg: Record<string, string> = { high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[impact] ?? "bg-muted text-muted-foreground"}`}>{impact} impact</Badge>;
}

function SentimentBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { positive: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", negative: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", neutral: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s}</Badge>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",     label: "Overview",     icon: Activity    },
  { id: "activation",  label: "Activation",   icon: Zap         },
  { id: "adoption",    label: "Adoption",     icon: Eye         },
  { id: "health",      label: "Health",       icon: Heart       },
  { id: "churn",       label: "Churn",        icon: AlertTriangle},
  { id: "expansion",   label: "Expansion",    icon: TrendingUp  },
  { id: "csm",         label: "AI CSM",       icon: Bot         },
  { id: "playbooks",   label: "Playbooks",    icon: BookOpen    },
  { id: "journey",     label: "Journey",      icon: Map         },
  { id: "portfolio",   label: "Portfolio",    icon: Users       },
  { id: "satisfaction",label: "Satisfaction", icon: Star        },
  { id: "forecast",    label: "Forecast",     icon: BarChart3   },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data: activation } = useQuery<ActivationData>({ queryKey: ["/api/customer-success/activation"], staleTime: 60_000 });
  const { data: health }     = useQuery<HealthData>({ queryKey: ["/api/customer-success/health"],     staleTime: 60_000 });
  const { data: adoption }   = useQuery<AdoptionData>({ queryKey: ["/api/customer-success/adoption"], staleTime: 60_000 });
  const { data: churn }      = useQuery<ChurnData>({ queryKey: ["/api/customer-success/churn"],       staleTime: 60_000 });
  const { data: expansion }  = useQuery<ExpansionData>({ queryKey: ["/api/customer-success/expansion"], staleTime: 60_000 });
  const { data: satisfaction }= useQuery<SatisfactionData>({ queryKey: ["/api/customer-success/satisfaction"], staleTime: 60_000 });

  const kpis = [
    { label: "Health Score",       value: health?.healthScore ?? "—",          sub: health?.category ?? "—",         color: "text-emerald-600 dark:text-emerald-400", onClick: () => setTab("health")      },
    { label: "Activation Score",   value: activation ? `${activation.activationScore}%` : "—", sub: activation?.status ?? "—", color: "text-primary",                onClick: () => setTab("activation")  },
    { label: "Adoption Score",     value: adoption ? `${adoption.adoptionScore}%` : "—",       sub: `Benchmark: ${adoption?.benchmarkScore ?? 85}%`,  color: adoption?.belowBenchmark ? "text-amber-600 dark:text-amber-400" : "text-primary", onClick: () => setTab("adoption")    },
    { label: "Expansion Potential",value: expansion ? `$${expansion.totalExpansionMrr.toLocaleString()}/mo` : "—", sub: `${expansion?.readyNow ?? 0} ready now`, color: "text-emerald-600 dark:text-emerald-400", onClick: () => setTab("expansion")  },
    { label: "Churn Risk",         value: churn ? `${churn.totalAtRisk} orgs` : "—",           sub: `$${churn?.totalMrrAtRisk ?? 0}/mo at risk`, color: churn && churn.critical > 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400", onClick: () => setTab("churn")     },
    { label: "NPS Score",          value: satisfaction?.npsScore ?? "—",        sub: `${satisfaction?.promoters ?? 0} promoters`,  color: "text-primary", onClick: () => setTab("satisfaction") },
  ];

  return (
    <div className="space-y-5" data-testid="tab-overview">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpis.map(k => (
          <button key={k.label} onClick={k.onClick} className="p-3.5 rounded-xl border bg-card text-left hover:bg-muted/20 transition-colors group" data-testid={`overview-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] font-medium">{k.label}</p>
            <p className="text-[9px] text-muted-foreground">{k.sub}</p>
          </button>
        ))}
      </div>

      {/* Health dimensions mini-view */}
      {health && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Customer Health Dimensions</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {health.dimensions.map(d => (
              <div key={d.label}>
                <div className="flex items-center justify-between text-[9px] mb-1">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{d.trend}</span>
                </div>
                <ScoreBar value={d.score} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { label: "Deploy Expansion Playbook",  sub: `${expansion?.readyNow ?? 0} orgs ready`,   tab: "playbooks" as TabId, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Review Churn Risks",          sub: `${churn?.critical ?? 0} critical`,          tab: "churn"     as TabId, color: "text-rose-600 dark:text-rose-400"    },
          { label: "Close Adoption Gaps",         sub: `${adoption?.neverUsed ?? 0} features unused`,tab: "adoption" as TabId, color: "text-amber-600 dark:text-amber-400" },
          { label: "Ask AI CSM Anything",         sub: "Instant strategic guidance",               tab: "csm"       as TabId, color: "text-primary"                          },
        ].map(a => (
          <button key={a.label} onClick={() => setTab(a.tab)} className="flex items-center gap-3 p-3.5 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left group" data-testid={`quick-action-${a.tab}`}>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            <div>
              <p className="text-xs font-semibold">{a.label}</p>
              <p className={`text-[9px] ${a.color}`}>{a.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Activation ─────────────────────────────────────────────────────────

function ActivationTab() {
  const { data, isLoading } = useQuery<ActivationData>({ queryKey: ["/api/customer-success/activation"], staleTime: 60_000 });

  const STATUS_COLORS: Record<string, string> = { "Power User": "text-emerald-600 dark:text-emerald-400", "Activated": "text-blue-600 dark:text-blue-400", "Activating": "text-amber-600 dark:text-amber-400", "Not Started": "text-rose-500" };

  return (
    <div className="space-y-4" data-testid="tab-activation">
      {data && (
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-4 mb-3">
            <div className="text-center">
              <p className={`text-3xl font-extrabold ${STATUS_COLORS[data.status] ?? "text-primary"}`}>{data.activationScore}%</p>
              <p className="text-[9px] text-muted-foreground">Activation Score</p>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between text-[9px] mb-1">
                <span className="text-muted-foreground">Progress</span>
                <span className={`font-bold ${STATUS_COLORS[data.status] ?? "text-primary"}`}>{data.status}</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${data.activationScore}%` }} />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">{data.completedSteps} of {data.totalSteps} steps completed</p>
            </div>
          </div>
          {data.nextStep && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-[10px]"><span className="font-bold">Next: </span>{data.nextStep.label}</p>
            </div>
          )}
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="rounded-xl border overflow-hidden">
          <div className="divide-y">
            {(data?.steps ?? []).map((step, i) => (
              <div key={step.id} className={`flex items-center gap-3 px-4 py-3 ${step.completed ? "" : "bg-primary/5"}`} data-testid={`activation-step-${step.id}`}>
                <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold ${step.completed ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {step.completed ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="flex-1">
                  <p className={`text-xs font-medium ${step.completed ? "" : "text-muted-foreground"}`}>{step.label}</p>
                  {step.completedAt && <p className="text-[9px] text-muted-foreground">Completed {formatDistanceToNow(new Date(step.completedAt), { addSuffix: true })}</p>}
                  {!step.completed && <p className="text-[9px] text-primary font-medium">Action required</p>}
                </div>
                {step.completed
                  ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  : <Badge className="text-[8px] px-1.5 py-0 h-4 bg-primary/10 text-primary">Pending</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Adoption ────────────────────────────────────────────────────────────

function AdoptionTab() {
  const { data, isLoading } = useQuery<AdoptionData>({ queryKey: ["/api/customer-success/adoption"], staleTime: 60_000 });
  const STATUS_LABELS: Record<string, string> = { never_used: "Never Used", dormant: "Dormant", underused: "Underused", connected_unused: "Connected, Unused", active: "Active" };
  const STATUS_COLORS: Record<string, string> = { never_used: "text-rose-500", dormant: "text-amber-500", underused: "text-amber-400", connected_unused: "text-amber-400", active: "text-emerald-500" };

  return (
    <div className="space-y-4" data-testid="tab-adoption">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Adoption Score",   value: `${data.adoptionScore}%`, color: data.belowBenchmark ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Never Used",       value: data.neverUsed,           color: "text-rose-600 dark:text-rose-400" },
            { label: "Dormant/Underused",value: data.dormant,             color: "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {data?.belowBenchmark && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs">Adoption score ({data.adoptionScore}%) is below the {data.benchmarkScore}% benchmark — activate recommendations below to close the gap.</p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {(data?.gaps ?? []).filter(g => g.status !== "active").map((gap, i) => (
            <div key={i} className="p-3.5 rounded-xl border bg-card" data-testid={`adoption-gap-${i}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-semibold">{gap.feature}</p>
                    <ImpactBadge impact={gap.impact} />
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{gap.zone}</Badge>
                    <span className={`text-[9px] font-medium ml-auto ${STATUS_COLORS[gap.status]}`}>{STATUS_LABELS[gap.status]}</span>
                  </div>
                  {gap.daysSince !== null && <p className="text-[9px] text-muted-foreground mb-1">Last used {gap.daysSince} days ago</p>}
                  {gap.daysSince === null && <p className="text-[9px] text-muted-foreground mb-1">No usage recorded</p>}
                  <div className="flex items-start gap-1.5">
                    <ArrowUpRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[9px] text-muted-foreground">{gap.recommendation}</p>
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

// ─── Tab: Health ──────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading } = useQuery<HealthData>({ queryKey: ["/api/customer-success/health"], staleTime: 60_000 });
  const CATEGORY_COLORS: Record<string, string> = { Healthy: "text-emerald-600 dark:text-emerald-400", Stable: "text-blue-600 dark:text-blue-400", "At Risk": "text-amber-600 dark:text-amber-400", Critical: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-health">
      {isLoading ? <Skeleton className="h-32 rounded-xl" /> : (
        <>
          <div className="p-5 rounded-xl border bg-card flex items-center gap-6">
            <div className="text-center shrink-0">
              <p className={`text-5xl font-extrabold ${CATEGORY_COLORS[data?.category ?? "Healthy"]}`}>{data?.healthScore}</p>
              <p className="text-[9px] text-muted-foreground">Health Score</p>
              <Badge className="mt-1 text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{data?.category}</Badge>
            </div>
            <div className="flex-1 space-y-2">
              {(data?.dimensions ?? []).map(d => (
                <div key={d.label} data-testid={`health-dim-${d.label.toLowerCase()}`}>
                  <div className="flex items-center justify-between text-[9px] mb-0.5">
                    <span className="text-muted-foreground">{d.label} <span className="text-[8px] opacity-60">({Math.round(d.weight * 100)}%)</span></span>
                    <span className={d.trend.startsWith("+") ? "text-emerald-600 dark:text-emerald-400" : d.trend === "0" ? "text-muted-foreground" : "text-rose-500"}>{d.trend !== "0" ? d.trend : "—"}</span>
                  </div>
                  <ScoreBar value={d.score} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
            <Activity className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs">Health trend: <span className="font-bold text-primary">{data?.trend}</span> — platform engagement is accelerating across all dimensions.</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Churn ───────────────────────────────────────────────────────────────

function ChurnTab() {
  const { data, isLoading } = useQuery<ChurnData>({ queryKey: ["/api/customer-success/churn"], staleTime: 60_000 });
  const { toast } = useToast();

  return (
    <div className="space-y-4" data-testid="tab-churn">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "At-Risk Orgs",   value: data.totalAtRisk,                                  color: data.totalAtRisk > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
            { label: "Critical",       value: data.critical,                                     color: data.critical > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground" },
            { label: "MRR at Risk",    value: `$${data.totalMrrAtRisk}/mo`,                      color: "text-rose-600 dark:text-rose-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.risks ?? []).map(r => (
            <div key={r.orgId} className={`p-4 rounded-xl border bg-card ${r.riskLevel === "critical" ? "border-rose-200 dark:border-rose-900 bg-rose-500/5" : r.riskLevel === "high" ? "border-amber-200 dark:border-amber-900 bg-amber-500/5" : ""}`} data-testid={`churn-risk-${r.orgId}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{r.orgName}</p>
                    <RiskBadge level={r.riskLevel} />
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{r.plan}</Badge>
                    <span className="text-[9px] font-bold text-rose-500 ml-auto">{r.churnProbability}% churn risk</span>
                  </div>
                  <div className="space-y-1 mb-2">
                    {r.signals.map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                        <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />{s}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/30">
                    <Bot className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[9px]"><span className="font-medium">Intervention: </span>{r.recommendedIntervention}</p>
                  </div>
                </div>
                <div className="text-center shrink-0">
                  <p className="text-xs font-bold">${r.mrr}/mo</p>
                  <p className="text-[9px] text-muted-foreground">at risk</p>
                  <Button size="sm" className="mt-2 h-6 text-[9px] px-2" onClick={() => toast({ title: `Intervention triggered for ${r.orgName}` })} data-testid={`button-intervene-${r.orgId}`}>
                    Act Now
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Expansion ───────────────────────────────────────────────────────────

function ExpansionTab() {
  const { data, isLoading } = useQuery<ExpansionData>({ queryKey: ["/api/customer-success/expansion"], staleTime: 60_000 });
  const { toast } = useToast();

  return (
    <div className="space-y-4" data-testid="tab-expansion">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Opportunities",        value: data.totalOpportunities, color: "text-primary" },
            { label: "Ready Now",            value: data.readyNow,           color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Expansion MRR",        value: `+$${data.totalExpansionMrr}/mo`, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.opportunities ?? []).map(o => (
            <div key={o.orgId} className={`p-4 rounded-xl border bg-card ${o.readiness === "Ready Now" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-500/5" : ""}`} data-testid={`expansion-${o.orgId}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{o.orgName}</p>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{o.currentPlan}</Badge>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <Badge className="text-[8px] px-1.5 py-0 h-4 bg-primary text-primary-foreground">{o.recommendedUpgrade}</Badge>
                    {o.readiness === "Ready Now" && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Ready Now</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div>
                      <p className="text-[9px] text-muted-foreground">Expansion probability</p>
                      <ScoreBar value={o.expansionProbability} />
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] text-muted-foreground">MRR increase</p>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+${o.expectedMrrIncrease}/mo</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {o.signals.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-[8px] px-1.5 py-0 h-4">{s}</Badge>
                    ))}
                  </div>
                </div>
                <Button size="sm" className="h-7 gap-1 text-[10px] shrink-0" onClick={() => toast({ title: `Upgrade initiated for ${o.orgName}` })} data-testid={`button-expand-${o.orgId}`}>
                  <TrendingUp className="h-3 w-3" />Upgrade
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: AI CSM ──────────────────────────────────────────────────────────────

function AiCsmTab() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<{ role: "user" | "csm"; text: string; ts: Date }[]>([
    { role: "csm", text: "Hi! I'm your AI Customer Success Manager. I have full visibility into your activation, adoption, health, churn risk, and expansion opportunities. What would you like to know?", ts: new Date() },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const csmMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/customer-success/ai-csm", { question: q }).then(parseApiResponse),
    onSuccess: (data: any) => {
      setConversation(prev => [...prev, { role: "csm", text: data?.answer ?? "", ts: new Date() }]);
    },
  });

  const send = () => {
    if (!question.trim()) return;
    setConversation(prev => [...prev, { role: "user", text: question, ts: new Date() }]);
    csmMutation.mutate(question);
    setQuestion("");
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [conversation]);

  const PROMPTS = [
    "What should we do next?",
    "What's blocking adoption?",
    "What feature should we activate?",
    "What's our biggest expansion opportunity?",
    "What's our churn risk?",
  ];

  return (
    <div className="space-y-3" data-testid="tab-csm">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <Bot className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">Your AI CSM has full visibility into activation, adoption, health scores, churn signals, and expansion readiness. Ask anything.</p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ height: "420px" }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conversation.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`csm-msg-${i}`}>
              <div className={`max-w-[85%] px-3 py-2.5 rounded-xl text-xs ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {msg.role === "csm" && <div className="flex items-center gap-1.5 mb-1 text-[9px] font-semibold opacity-70"><Bot className="h-2.5 w-2.5" />AI CSM</div>}
                <p className="leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ))}
          {csmMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted px-3 py-2.5 rounded-xl flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Analyzing…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t bg-muted/10">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PROMPTS.map(p => (
              <button key={p} onClick={() => { setQuestion(p); }} className="px-2 py-1 rounded-lg border text-[9px] hover:bg-muted/50 transition-colors" data-testid={`csm-prompt-${PROMPTS.indexOf(p)}`}>{p}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Ask your AI CSM anything…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-csm-question" />
            <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={send} disabled={!question.trim() || csmMutation.isPending} data-testid="button-csm-send">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Playbooks ───────────────────────────────────────────────────────────

function PlaybooksTab() {
  const { data, isLoading } = useQuery<PlaybooksData>({ queryKey: ["/api/customer-success/playbooks"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();

  const deployMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/customer-success/playbooks/deploy", { playbookId: id }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["/api/customer-success/playbooks"] }); toast({ title: "Playbook deployed", description: "Tracking has started automatically." }); },
    onError: () => toast({ title: "Deploy failed", variant: "destructive" }),
  });

  const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    completed:   { label: "Completed",   color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
    in_progress: { label: "In Progress", color: "text-blue-700 dark:text-blue-300",       bg: "bg-blue-100 dark:bg-blue-900/30" },
    not_started: { label: "Available",   color: "text-slate-600 dark:text-slate-300",     bg: "bg-slate-100 dark:bg-slate-700" },
  };

  return (
    <div className="space-y-4" data-testid="tab-playbooks">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active",    value: data.active,    color: "text-blue-600 dark:text-blue-400" },
            { label: "Completed", value: data.completed, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Available", value: data.available, color: "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.playbooks ?? []).map(pb => {
            const cfg = STATUS_CONFIG[pb.status] ?? STATUS_CONFIG.not_started;
            return (
              <div key={pb.id} className="p-4 rounded-xl border bg-card" data-testid={`playbook-${pb.id}`}>
                <div className="flex items-start gap-3">
                  <BookOpen className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <p className="text-xs font-bold">{pb.name}</p>
                      <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg.bg} ${cfg.color}`}>{cfg.label}</Badge>
                    </div>
                    <p className="text-[9px] text-muted-foreground mb-2">{pb.expectedOutcome}</p>
                    {pb.status !== "not_started" && (
                      <>
                        <div className="flex items-center justify-between text-[9px] mb-1">
                          <span className="text-muted-foreground">{pb.completedSteps}/{pb.steps} steps</span>
                          <span className="font-bold">{pb.progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${pb.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pb.progress}%` }} />
                        </div>
                      </>
                    )}
                    {pb.deployedAt && <p className="text-[9px] text-muted-foreground mt-1">Deployed {formatDistanceToNow(new Date(pb.deployedAt), { addSuffix: true })}</p>}
                    {pb.completedAt && <p className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-0.5">✓ Completed {formatDistanceToNow(new Date(pb.completedAt), { addSuffix: true })}</p>}
                  </div>
                  {pb.status === "not_started" && (
                    <Button size="sm" className="h-7 gap-1 text-[10px] shrink-0" onClick={() => deployMutation.mutate(pb.id)} disabled={deployMutation.isPending} data-testid={`button-deploy-${pb.id}`}>
                      <Zap className="h-3 w-3" />Deploy
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Journey ─────────────────────────────────────────────────────────────

function JourneyTab() {
  const { data, isLoading } = useQuery<JourneyData>({ queryKey: ["/api/customer-success/journey"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-journey">
      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        <>
          <div className="p-4 rounded-xl border bg-card">
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
              {(data?.stages ?? []).map((stage, i) => (
                <div key={stage.id} className="flex items-center gap-2 shrink-0">
                  {i > 0 && <div className={`h-px w-8 ${stage.completed || data?.stages[i - 1]?.completed ? "bg-primary" : "bg-muted"}`} />}
                  <div className={`flex flex-col items-center`} data-testid={`journey-stage-${stage.id}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${stage.id === data?.currentStage ? "border-primary bg-primary text-primary-foreground" : stage.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted bg-card text-muted-foreground"}`}>
                      {stage.completed ? <CheckCircle className="h-4 w-4" /> : i + 1}
                    </div>
                    <p className={`text-[9px] mt-1 font-medium ${stage.id === data?.currentStage ? "text-primary" : stage.completed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{stage.label}</p>
                    {stage.completedAt && <p className="text-[8px] text-muted-foreground">{formatDistanceToNow(new Date(stage.completedAt), { addSuffix: true })}</p>}
                    {stage.id === data?.currentStage && !stage.completed && <Badge className="mt-0.5 text-[7px] px-1 py-0 h-3.5 bg-primary text-primary-foreground">Current</Badge>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground">On platform for {data?.daysOnPlatform} days · Current: <span className="font-semibold capitalize text-foreground">{data?.currentStage}</span> → Next: <span className="font-semibold capitalize text-primary">{data?.nextStage}</span></p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Blockers</p>
              <div className="space-y-2">
                {(data?.blockers ?? []).map((b, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <X className="h-3 w-3 text-rose-500 shrink-0 mt-0.5" />
                    <p className="text-[10px]">{b}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Next Actions</p>
              <div className="space-y-2">
                {(data?.nextActions ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2" data-testid={`journey-action-${i}`}>
                    <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium">{a.action}</p>
                      <p className="text-[9px] text-emerald-600 dark:text-emerald-400">{a.impact} · {a.timeEst}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Portfolio ───────────────────────────────────────────────────────────

function PortfolioTab() {
  const { data, isLoading } = useQuery<PortfolioData>({ queryKey: ["/api/customer-success/portfolio"], staleTime: 60_000 });
  const [sort, setSort] = useState<"health" | "churn" | "expansion" | "mrr">("health");
  const PLAN_COLORS: Record<string, string> = { Enterprise: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", Pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Starter: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };

  const sorted = [...(data?.portfolio ?? [])].sort((a, b) => {
    if (sort === "health")    return b.healthScore - a.healthScore;
    if (sort === "churn")     return b.churnRisk - a.churnRisk;
    if (sort === "expansion") return b.expansionScore - a.expansionScore;
    return b.mrr - a.mrr;
  });

  return (
    <div className="space-y-4" data-testid="tab-portfolio">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Healthy Orgs",  value: data.summary.healthy,         color: "text-emerald-600 dark:text-emerald-400" },
            { label: "At Risk",       value: data.summary.atRisk,          color: "text-amber-600 dark:text-amber-400" },
            { label: "Critical",      value: data.summary.critical,        color: "text-rose-600 dark:text-rose-400" },
            { label: "Total MRR",     value: `$${data.summary.totalMrr.toLocaleString()}/mo`, color: "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {(["health", "churn", "expansion", "mrr"] as const).map(s => (
          <button key={s} onClick={() => setSort(s)} data-testid={`sort-${s}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${sort === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>Sort: {s}</button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-9 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
            <span className="col-span-2">Organization</span>
            <span className="col-span-1 text-center">Health</span>
            <span className="col-span-1 text-center">Activation</span>
            <span className="col-span-1 text-center">Adoption</span>
            <span className="col-span-1 text-center">Churn %</span>
            <span className="col-span-1 text-center">Expansion</span>
            <span className="col-span-1 text-center">NPS</span>
            <span className="col-span-1 text-center">MRR</span>
          </div>
          <div className="divide-y">
            {sorted.map(org => (
              <div key={org.id} className="grid grid-cols-9 items-center px-4 py-2.5 hover:bg-muted/10 transition-colors" data-testid={`portfolio-row-${org.id}`}>
                <div className="col-span-2">
                  <p className="text-[10px] font-medium truncate">{org.name}</p>
                  <div className="flex items-center gap-1 mt-0.5"><Badge className={`text-[7px] px-1 py-0 h-3.5 ${PLAN_COLORS[org.plan]}`}>{org.plan}</Badge><HealthBadge score={org.healthScore} /></div>
                </div>
                <span className="col-span-1 text-center text-[10px] font-bold">{org.healthScore}</span>
                <span className="col-span-1 text-center text-[10px]">{org.activationScore}%</span>
                <span className="col-span-1 text-center text-[10px]">{org.adoptionScore}%</span>
                <span className={`col-span-1 text-center text-[10px] font-bold ${org.churnRisk >= 50 ? "text-rose-500" : org.churnRisk >= 25 ? "text-amber-500" : "text-muted-foreground"}`}>{org.churnRisk}%</span>
                <span className={`col-span-1 text-center text-[10px] ${org.expansionScore >= 70 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-muted-foreground"}`}>{org.expansionScore}%</span>
                <span className="col-span-1 text-center text-[10px]">{org.nps}/10</span>
                <span className="col-span-1 text-center text-[10px] font-bold">${org.mrr}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Satisfaction ────────────────────────────────────────────────────────

function SatisfactionTab() {
  const { data, isLoading } = useQuery<SatisfactionData>({ queryKey: ["/api/customer-success/satisfaction"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-satisfaction">
      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "NPS Score",    value: data?.npsScore ?? "—",  color: (data?.npsScore ?? 0) >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
              { label: "Avg NPS",      value: data?.avgNps ?? "—",    color: "text-primary" },
              { label: "Promoters",    value: data?.promoters ?? "—", color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Detractors",   value: data?.detractors ?? "—",color: data && data.detractors > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground" },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
                <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Feedback Themes</p>
            <div className="space-y-2">
              {(data?.themes ?? []).map((t, i) => (
                <div key={i} className="flex items-center gap-3" data-testid={`theme-${i}`}>
                  <SentimentBadge s={t.sentiment} />
                  <p className="text-[10px] flex-1">{t.theme}</p>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden w-16">
                      <div className={`h-full rounded-full ${t.sentiment === "positive" ? "bg-emerald-500" : t.sentiment === "negative" ? "bg-rose-500" : "bg-slate-400"}`} style={{ width: `${Math.min((t.count / 30) * 100, 100)}%` }} />
                    </div>
                    <span className="text-[9px] font-bold text-muted-foreground">{t.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Improvement Areas</p>
            <div className="space-y-1.5">
              {(data?.improvementAreas ?? []).map((area, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Target className="h-3 w-3 text-primary shrink-0" />
                  <p className="text-[10px]">{area}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Forecast ────────────────────────────────────────────────────────────

function ForecastTab() {
  const { data, isLoading } = useQuery<ForecastData>({ queryKey: ["/api/customer-success/forecast"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-forecast">
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(data?.windows ?? []).map(w => (
              <div key={w.period} className="p-4 rounded-xl border bg-card" data-testid={`forecast-${w.period}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold">{w.label} Forecast</p>
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{w.confidence}% conf</Badge>
                </div>
                <div className="space-y-2 text-[9px]">
                  {[
                    { label: "Health",     value: `${w.healthForecast}`,    unit: "/100",    color: w.healthForecast >= 85 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
                    { label: "Retention",  value: `${w.retentionForecast}`, unit: "%",       color: "text-blue-600 dark:text-blue-400" },
                    { label: "Expansion",  value: `+${w.expansionForecast}`,unit: "% MRR",  color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Revenue",    value: `$${w.revenueForecast.toLocaleString()}`,unit: "/mo", color: "text-primary" },
                    { label: "Churn Risk", value: `${w.churnRisk}`,         unit: "%",       color: w.churnRisk >= 15 ? "text-amber-500" : "text-muted-foreground" },
                  ].map(m => (
                    <div key={m.label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className={`font-bold ${m.color}`}>{m.value}<span className="font-normal text-muted-foreground">{m.unit}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Key Drivers</p>
            <div className="space-y-1.5">
              {(data?.keyDrivers ?? []).map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ArrowUpRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-[10px]">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminCustomerSuccessOsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: health } = useQuery<HealthData>({ queryKey: ["/api/customer-success/health"], staleTime: 60_000 });
  const { data: churn }  = useQuery<ChurnData>({ queryKey: ["/api/customer-success/churn"],   staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-customer-success-os">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/command-center">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Command Center
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Heart className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Customer Success OS
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autonomous activation, adoption, retention, expansion, and customer success — managed as a platform outcome.
          </p>
        </div>

        {(health || churn) && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0 flex-wrap">
            {[
              { label: "Health",   value: health ? `${health.healthScore}` : "—",                                       color: "text-primary" },
              { label: "Category", value: health?.category ?? "—",                                                       color: health?.category === "Healthy" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
              { label: "Churn",    value: churn ? `${churn.totalAtRisk} at risk` : "—",                                  color: churn && churn.critical > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground" },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Integrations",   href: "/admin/integrations" },
          { label: "Workforce OS",   href: "/admin/workforce-os" },
          { label: "Command Center", href: "/admin/command-center" },
          { label: "Customer Success OS", href: null },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Critical churn alert */}
      {churn && churn.critical > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-500/5" data-testid="churn-alert">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs"><span className="font-bold text-rose-500">{churn.critical} org{churn.critical !== 1 ? "s" : ""} at critical churn risk</span> — immediate intervention recommended.</p>
          <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 text-rose-500 ml-auto shrink-0" onClick={() => setActiveTab("churn")}>Review <ChevronRight className="h-3 w-3" /></Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-cs-os">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-96">
        {activeTab === "overview"     && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "activation"   && <ActivationTab />}
        {activeTab === "adoption"     && <AdoptionTab />}
        {activeTab === "health"       && <HealthTab />}
        {activeTab === "churn"        && <ChurnTab />}
        {activeTab === "expansion"    && <ExpansionTab />}
        {activeTab === "csm"          && <AiCsmTab />}
        {activeTab === "playbooks"    && <PlaybooksTab />}
        {activeTab === "journey"      && <JourneyTab />}
        {activeTab === "portfolio"    && <PortfolioTab />}
        {activeTab === "satisfaction" && <SatisfactionTab />}
        {activeTab === "forecast"     && <ForecastTab />}
      </div>

      {/* Forward nav → Platform Brain */}
      <Link href="/admin/platform-brain">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-platform-brain">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Platform Brain &amp; Continuous Learning System</p>
            <p className="text-xs text-muted-foreground mt-0.5">Cross-layer intelligence that observes every system, learns from outcomes, detects patterns, evolves agents and workflows, and continuously improves the platform itself.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5" data-testid="architecture-note">
        <div className="flex items-start gap-3">
          <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">AI Self-Growing Platform — 16 Layers Complete</p>
            <p className="text-[10px] text-muted-foreground mb-2">TrainEfficiency now actively drives customer activation, adoption, retention, and expansion without manual intervention. Success is a managed outcome.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 15 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
                  {i + 1}. {layer}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
