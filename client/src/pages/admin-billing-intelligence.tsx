import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, CreditCard, TrendingUp, Zap, Users, BarChart3, Target,
  ChevronRight, Building2, CheckCircle, Lock, Unlock, Star, Award,
  DollarSign, Activity, Lightbulb, ArrowUp, Shield, Globe, Package,
  RefreshCw, Layers, BarChart2, Sparkles,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductOverview = { currentPlan: string; tier: { id: string; name: string; price: number | null; features: string[] }; allTiers: any[]; activationScore: number; activationLevel: string; mrr: number; seats: number; featuresActive: number; featuresAvailable: number; upgradeOpportunities: number; summary: string; generatedAt: string };
type EntitlementsData = { entitlements: { feature: string; requiredPlan: string; hasAccess: boolean; upgradeRequired: string | null }[]; currentPlan: string; planOrder: string[]; generatedAt: string };
type ActivationData = { steps: { id: string; label: string; complete: boolean; impact: number; category: string }[]; score: number; level: string; nextStep: { id: string; label: string; impact: number; category: string } | undefined; generatedAt: string };
type ExpansionData = { opportunities: { id: string; title: string; trigger: string; expectedROI: string; timeSaved: string; targetPlan: string; confidence: number; urgency: string }[]; totalPotentialROI: number; generatedAt: string };
type SubHealthData = { plan: string; tier: any; mrr: number; seats: number; featuresUsed: number; featuresUnused: number; healthScore: number; healthLevel: string; expansionScore: number; expansionLevel: string; retentionRisk: string; usageHighlights: { label: string; value: number; max: number; good: boolean }[]; generatedAt: string };
type UsageData = { featureUsage: { feature: string; usageScore: number; trend: string; category: string; valueTier: string }[]; powerFeatures: any[]; underutilized: any[]; totalLogins: number; agentExecutions: number; revenueGenerated: number; timeSavedHours: number; generatedAt: string };
type PlanComparisonData = { plans: any[]; comparisonRows: { category: string; feature: string; starter: boolean; professional: boolean; growth: boolean; enterprise: boolean }[]; currentPlan: string; nextPlan: string; currentIdx: number; generatedAt: string };
type EnterpriseData = { readinessItems: { item: string; ready: boolean; readinessScore: number; category: string }[]; overallReadiness: number; readinessLevel: string; enterpriseFeatures: { feature: string; description: string; available: boolean }[]; generatedAt: string };
type RevenueOpsData = { platformMetrics: { totalMRR: number; expansionMRR: number; churnMRR: number; netNewMRR: number; netRevRetention: number; totalOrgs: number; avgPlanPrice: number; planDistribution: { plan: string; count: number; pct: number; mrr: number }[] }; activationRates: { milestone: string; rate: number; trend: string }[]; featureAdoption: { feature: string; adoption: number; tier: string }[]; upgradePipeline: { fromPlan: string; toPlan: string; orgsEligible: number; avgTimeToUpgrade: string }[]; generatedAt: string };
type AdvisorResult = { answer: string; insights: { insight: string; confidence: number; category: string }[]; recommendedActions: { action: string; priority: string; expectedImpact: string }[]; dataNote: string; question: string; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ProgressBar({ value, color = "bg-primary", height = "h-2" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  starter:      "text-slate-500 dark:text-slate-400",
  professional: "text-blue-600 dark:text-blue-400",
  growth:       "text-violet-600 dark:text-violet-400",
  enterprise:   "text-amber-600 dark:text-amber-400",
};

const PLAN_BG: Record<string, string> = {
  starter:      "bg-slate-100 dark:bg-slate-800/40",
  professional: "bg-blue-100 dark:bg-blue-900/30",
  growth:       "bg-violet-100 dark:bg-violet-900/30",
  enterprise:   "bg-amber-100 dark:bg-amber-900/30",
};

const URGENCY_COLORS: Record<string, string> = {
  high:   "text-rose-600 dark:text-rose-400",
  medium: "text-amber-600 dark:text-amber-400",
  low:    "text-muted-foreground",
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview",         icon: BarChart3 },
  { id: "entitlements",label: "Entitlements",     icon: Lock },
  { id: "activation",  label: "Activation",       icon: Zap },
  { id: "expansion",   label: "Expansion",        icon: TrendingUp },
  { id: "health",      label: "Sub Health",       icon: Activity },
  { id: "usage",       label: "Usage",            icon: BarChart2 },
  { id: "plans",       label: "Plan Comparison",  icon: Package },
  { id: "enterprise",  label: "Enterprise",       icon: Building2 },
  { id: "revops",      label: "Revenue Ops",      icon: DollarSign },
  { id: "advisor",     label: "AI Advisor",       icon: Sparkles },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<ProductOverview>({ queryKey: ["/api/productization/overview"], staleTime: 5 * 60_000 });

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;

  const planColor = PLAN_COLORS[data?.currentPlan ?? "starter"];
  const planBg = PLAN_BG[data?.currentPlan ?? "starter"];

  return (
    <div className="space-y-4" data-testid="tab-product-overview">
      {/* Plan card */}
      <div className={`flex items-start gap-4 p-5 rounded-xl border ${planBg}`}>
        <div className="shrink-0 text-center p-3 rounded-xl bg-card border min-w-28">
          <p className={`text-xl font-extrabold ${planColor} capitalize`}>{data?.tier?.name}</p>
          <p className={`text-2xl font-extrabold mt-0.5 ${planColor}`}>{data?.tier?.price ? `$${data.tier.price}` : "Custom"}</p>
          <p className="text-[9px] text-muted-foreground">/month</p>
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-3">{data?.summary}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Activation",     value: `${data?.activationScore ?? 0}/100`, sub: data?.activationLevel,     color: (data?.activationScore ?? 0) >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-primary" },
              { label: "MRR",            value: `$${data?.mrr ?? 0}/mo`,            sub: "current plan",            color: planColor },
              { label: "Seats",          value: `${data?.seats ?? 0}`,              sub: "coaches + admin",         color: "text-muted-foreground" },
              { label: "Upgrade Opps",   value: `${data?.upgradeOpportunities ?? 0}`, sub: "identified",            color: (data?.upgradeOpportunities ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
            ].map(m => (
              <div key={m.label} className="p-2.5 rounded-lg bg-background border">
                <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
                {m.sub && <p className={`text-[9px] font-medium mt-0.5 ${m.color}`}>{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-overview">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Plan tier overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(data?.allTiers ?? []).map((t: any) => {
          const isCurrent = t.id === data?.currentPlan;
          const tColor = PLAN_COLORS[t.id];
          const tBg = PLAN_BG[t.id];
          return (
            <div key={t.id} className={`p-3.5 rounded-xl border ${isCurrent ? `${tBg} ring-2 ring-offset-1 ring-current ${tColor}` : ""}`} data-testid={`plan-card-${t.id}`}>
              <div className="flex items-center justify-between mb-1">
                <p className={`text-xs font-bold capitalize ${tColor}`}>{t.name}</p>
                {isCurrent && <Badge className="text-[8px] px-1 py-0 h-3.5 bg-primary text-primary-foreground">Current</Badge>}
              </div>
              <p className={`text-lg font-extrabold ${tColor}`}>{t.price ? `$${t.price}` : "Custom"}</p>
              <p className="text-[9px] text-muted-foreground">{t.features.length} features</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Entitlements ────────────────────────────────────────────────────────

function EntitlementsTab() {
  const { data, isLoading } = useQuery<EntitlementsData>({ queryKey: ["/api/productization/entitlements"], staleTime: 5 * 60_000 });
  const [showLocked, setShowLocked] = useState(true);
  const filtered = (data?.entitlements ?? []).filter(e => showLocked || e.hasAccess);
  const grouped = filtered.reduce((acc: Record<string, typeof filtered>, e) => {
    acc[e.requiredPlan] = [...(acc[e.requiredPlan] ?? []), e];
    return acc;
  }, {});

  return (
    <div className="space-y-4" data-testid="tab-entitlements">
      <div className="flex items-center gap-2">
        <button onClick={() => setShowLocked(!showLocked)} data-testid="toggle-locked-features"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showLocked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          {showLocked ? "Showing All Features" : "Showing Available Only"}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-4">
          {(data?.planOrder ?? []).filter(p => grouped[p]?.length > 0).map(plan => (
            <div key={plan} className="rounded-xl border overflow-hidden" data-testid={`entitlement-group-${plan}`}>
              <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${PLAN_BG[plan]}`}>
                <p className={`text-xs font-bold capitalize ${PLAN_COLORS[plan]}`}>{plan} Plan</p>
                {plan === data?.currentPlan && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-primary text-primary-foreground">Your Plan</Badge>}
                {plan !== data?.currentPlan && data?.planOrder && data.planOrder.indexOf(plan) > data.planOrder.indexOf(data.currentPlan) && (
                  <Badge variant="outline" className={`text-[8px] px-1.5 py-0 h-4 ${PLAN_COLORS[plan]}`}>Upgrade Required</Badge>
                )}
              </div>
              <div className="divide-y">
                {(grouped[plan] ?? []).map(e => (
                  <div key={e.feature} className="flex items-center gap-3 px-4 py-2.5" data-testid={`feature-${e.feature}`}>
                    {e.hasAccess ? (
                      <Unlock className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className={`text-xs flex-1 capitalize ${!e.hasAccess ? "text-muted-foreground" : ""}`}>
                      {e.feature.replace(/_/g, " ")}
                    </span>
                    {e.hasAccess ? (
                      <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>
                    ) : (
                      <Badge variant="outline" className={`text-[8px] px-1.5 py-0 h-4 ${PLAN_COLORS[e.requiredPlan]} capitalize`}>
                        {e.upgradeRequired} required
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Activation ──────────────────────────────────────────────────────────

function ActivationTab() {
  const { data, isLoading } = useQuery<ActivationData>({ queryKey: ["/api/productization/activation"], staleTime: 3 * 60_000 });
  const scoreColor = (data?.score ?? 0) >= 80 ? "text-emerald-600 dark:text-emerald-400" : (data?.score ?? 0) >= 50 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-activation">
      {/* Score card */}
      <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5">
        <div className="text-center shrink-0">
          <p className={`text-5xl font-extrabold ${scoreColor}`}>{data?.score ?? 0}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Activation Score</p>
          <p className={`text-[10px] font-semibold mt-0.5 ${scoreColor}`}>{data?.level}</p>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Progress to 100</span>
            <span className="text-xs font-bold">{data?.score ?? 0}/100</span>
          </div>
          <ProgressBar value={data?.score ?? 0} color={(data?.score ?? 0) >= 80 ? "bg-emerald-500" : (data?.score ?? 0) >= 50 ? "bg-primary" : "bg-amber-500"} height="h-3" />
          {data?.nextStep && (
            <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
              <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-[10px]"><span className="font-semibold text-primary">Next: </span>{data.nextStep.label} (+{data.nextStep.impact} pts)</p>
            </div>
          )}
        </div>
      </div>

      {/* Steps */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {(data?.steps ?? []).map(step => (
            <div key={step.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${step.complete ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-900" : "bg-card"}`} data-testid={`activation-step-${step.id}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${step.complete ? "bg-emerald-500" : "bg-muted"}`}>
                {step.complete ? <CheckCircle className="h-3.5 w-3.5 text-white" /> : <div className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40" />}
              </div>
              <div className="flex-1">
                <p className={`text-xs font-medium ${step.complete ? "" : "text-muted-foreground"}`}>{step.label}</p>
                <p className="text-[9px] text-muted-foreground capitalize">{step.category}</p>
              </div>
              <Badge variant={step.complete ? "default" : "outline"} className={`text-[9px] px-1.5 py-0 h-4 ${step.complete ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : ""}`}>+{step.impact} pts</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Expansion ────────────────────────────────────────────────────────────

function ExpansionTab() {
  const { data, isLoading } = useQuery<ExpansionData>({ queryKey: ["/api/productization/expansion"], staleTime: 5 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-expansion">
      {data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900">
          <DollarSign className="h-4 w-4 text-emerald-500 shrink-0" />
          <div>
            <p className="text-xs font-semibold">Total Expansion Potential</p>
            <p className="text-[10px] text-muted-foreground">{data.opportunities.length} upgrade opportunities identified</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.opportunities ?? []).map(opp => {
            const planColor = PLAN_COLORS[opp.targetPlan] ?? "text-muted-foreground";
            const planBg = PLAN_BG[opp.targetPlan] ?? "";
            return (
              <div key={opp.id} className="p-4 rounded-xl border bg-card" data-testid={`expansion-opp-${opp.id}`}>
                <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold">{opp.title}</p>
                      <span className={`text-[9px] font-semibold uppercase tracking-wide ${URGENCY_COLORS[opp.urgency]}`}>{opp.urgency} priority</span>
                    </div>
                    <Badge className={`text-[9px] px-1.5 py-0 h-4 capitalize ${planBg} ${planColor}`}>{opp.targetPlan === "current" ? "Current Plan" : `${opp.targetPlan} plan`}</Badge>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{opp.expectedROI}</p>
                    <p className="text-[9px] text-muted-foreground">expected ROI</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{opp.trigger}</p>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">Time saved: <span className="font-medium text-foreground">{opp.timeSaved}</span></span>
                  <span className="text-muted-foreground">Confidence: <span className="font-medium text-blue-600 dark:text-blue-400">{opp.confidence}%</span></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Subscription Health ─────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading } = useQuery<SubHealthData>({ queryKey: ["/api/productization/subscription-health"], staleTime: 5 * 60_000 });
  const healthColor = (data?.healthScore ?? 0) >= 75 ? "text-emerald-600 dark:text-emerald-400" : (data?.healthScore ?? 0) >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const riskColor: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-health">
      {/* Score row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Health Score",     value: data?.healthScore ?? 0,     suffix: "/100",  level: data?.healthLevel,    color: healthColor },
          { label: "Expansion Score",  value: data?.expansionScore ?? 0,  suffix: "/100",  level: data?.expansionLevel, color: "text-blue-600 dark:text-blue-400" },
          { label: "Retention Risk",   value: data?.retentionRisk ?? "--", suffix: "",      level: data?.retentionRisk,  color: riskColor[data?.retentionRisk ?? "low"] },
        ].map(m => (
          <div key={m.label} className="p-3.5 rounded-xl border bg-card text-center" data-testid={`health-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold capitalize ${m.color}`}>{typeof m.value === "number" ? `${m.value}${m.suffix}` : m.value}</p>
            <p className="text-[9px] text-muted-foreground">{m.label}</p>
            <p className={`text-[9px] font-semibold mt-0.5 capitalize ${m.color}`}>{m.level}</p>
          </div>
        ))}
      </div>

      {/* Usage highlights */}
      {!isLoading && data && (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b">
            <h3 className="text-xs font-semibold">Feature Usage Breakdown</h3>
          </div>
          <div className="divide-y">
            {[
              { label: "Features Used", value: data.featuresUsed, max: data.featuresUsed + data.featuresUnused, good: true },
              ...data.usageHighlights,
            ].map(h => (
              <div key={h.label} className="flex items-center gap-3 px-4 py-3" data-testid={`usage-highlight-${h.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className={`h-2 w-2 rounded-full shrink-0 ${h.good ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="text-xs flex-1">{h.label}</span>
                <div className="flex items-center gap-2 w-28">
                  <ProgressBar value={(h.value / h.max) * 100} color={h.good ? "bg-emerald-500" : "bg-amber-500"} />
                  <span className="text-xs font-bold shrink-0">{h.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Usage Intelligence ──────────────────────────────────────────────────

function UsageTab() {
  const { data, isLoading } = useQuery<UsageData>({ queryKey: ["/api/productization/usage"], staleTime: 5 * 60_000 });
  const TREND_CFG: Record<string, { color: string; label: string }> = {
    up:     { color: "text-emerald-600 dark:text-emerald-400", label: "↑ Up" },
    stable: { color: "text-muted-foreground",                  label: "→ Stable" },
    none:   { color: "text-rose-600 dark:text-rose-400",       label: "Not Used" },
  };

  return (
    <div className="space-y-4" data-testid="tab-usage">
      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Logins (est.)",     value: data.totalLogins,                         color: "text-primary" },
            { label: "AI Executions",     value: data.agentExecutions,                     color: "text-violet-600 dark:text-violet-400" },
            { label: "Revenue Influenced",value: `$${Math.round(data.revenueGenerated).toLocaleString()}`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Hours Saved",       value: `${Math.round(data.timeSavedHours)}h`,    color: "text-blue-600 dark:text-blue-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`usage-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-2">
          {(data?.featureUsage ?? []).map(f => {
            const tCfg = TREND_CFG[f.trend] ?? TREND_CFG.stable;
            const scoreColor = f.usageScore >= 60 ? "bg-emerald-500" : f.usageScore >= 30 ? "bg-primary" : "bg-amber-500";
            return (
              <div key={f.feature} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`feature-usage-${f.feature.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className={`p-1.5 rounded-lg ${f.usageScore >= 60 ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-muted"}`}>
                  <Activity className={`h-3.5 w-3.5 ${f.usageScore >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs font-medium">{f.feature}</p>
                    <span className={`text-[9px] ${tCfg.color}`}>{tCfg.label}</span>
                    <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 capitalize ml-auto">{f.category}</Badge>
                  </div>
                  <ProgressBar value={f.usageScore} color={scoreColor} />
                </div>
                <span className="text-xs font-bold shrink-0 w-6 text-right">{f.usageScore}</span>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && data && data.underutilized.length > 0 && (
        <div className="p-3.5 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <p className="text-xs font-semibold">{data.underutilized.length} Underutilized Features</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.underutilized.map(f => <Badge key={f.feature} variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 dark:text-amber-400">{f.feature}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Plan Comparison ─────────────────────────────────────────────────────

function PlanComparisonTab() {
  const { data, isLoading } = useQuery<PlanComparisonData>({ queryKey: ["/api/productization/plan-comparison"], staleTime: 10 * 60_000 });
  const categories = [...new Set((data?.comparisonRows ?? []).map(r => r.category))];

  return (
    <div className="space-y-4" data-testid="tab-plans">
      {isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-5 border-b bg-muted/30">
            <div className="p-3 text-xs font-semibold col-span-1 border-r">Feature</div>
            {(data?.plans ?? []).map(plan => (
              <div key={plan.id} className={`p-3 text-center border-r last:border-r-0 ${plan.id === data?.currentPlan ? "bg-primary/10" : ""}`} data-testid={`comparison-header-${plan.id}`}>
                <p className={`text-[10px] font-bold capitalize ${PLAN_COLORS[plan.id]}`}>{plan.name}</p>
                <p className={`text-sm font-extrabold ${PLAN_COLORS[plan.id]}`}>{plan.price ? `$${plan.price}` : "Custom"}</p>
                {plan.id === data?.currentPlan && <Badge className="text-[8px] px-1 py-0 h-3.5 bg-primary text-primary-foreground mt-0.5">Current</Badge>}
              </div>
            ))}
          </div>

          {/* Rows grouped by category */}
          {categories.map(cat => {
            const rows = (data?.comparisonRows ?? []).filter(r => r.category === cat);
            return (
              <div key={cat}>
                <div className="px-3 py-1.5 bg-muted/20 border-y">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</p>
                </div>
                {rows.map(row => (
                  <div key={row.feature} className="grid grid-cols-5 border-b last:border-b-0 hover:bg-muted/10 transition-colors" data-testid={`comparison-row-${row.feature.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="p-2.5 text-xs border-r col-span-1">{row.feature}</div>
                    {["starter", "professional", "growth", "enterprise"].map(plan => (
                      <div key={plan} className={`p-2.5 flex items-center justify-center border-r last:border-r-0 ${plan === data?.currentPlan ? "bg-primary/5" : ""}`}>
                        {(row as any)[plan] ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <div className="h-2.5 w-0.5 rounded-full bg-muted-foreground/30" />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Upgrade CTA */}
          {data && data.currentPlan !== "enterprise" && (
            <div className={`p-4 flex items-center gap-3 ${PLAN_BG[data.nextPlan]}`}>
              <ArrowUp className={`h-4 w-4 shrink-0 ${PLAN_COLORS[data.nextPlan]}`} />
              <p className="text-xs flex-1"><span className={`font-bold ${PLAN_COLORS[data.nextPlan]} capitalize`}>{data.nextPlan}</span> unlocks {(data.plans.find(p => p.id === data.nextPlan)?.features?.length ?? 0)} additional features</p>
              <Button size="sm" className="h-7 text-xs shrink-0" data-testid="button-upgrade-cta">Upgrade to {data.nextPlan.charAt(0).toUpperCase() + data.nextPlan.slice(1)}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Enterprise ──────────────────────────────────────────────────────────

function EnterpriseTab() {
  const { data, isLoading } = useQuery<EnterpriseData>({ queryKey: ["/api/productization/enterprise"], staleTime: 10 * 60_000 });
  const readinessColor = (data?.overallReadiness ?? 0) >= 75 ? "text-emerald-600 dark:text-emerald-400" : (data?.overallReadiness ?? 0) >= 50 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-enterprise">
      {/* Readiness score */}
      <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-amber-500/5 to-primary/5">
        <div className="text-center shrink-0">
          <p className={`text-5xl font-extrabold ${readinessColor}`}>{data?.overallReadiness ?? 0}%</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Enterprise Ready</p>
          <p className={`text-[10px] font-semibold mt-0.5 ${readinessColor}`}>{data?.readinessLevel}</p>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Readiness Progress</span>
            <span className="text-xs font-bold">{data?.overallReadiness ?? 0}%</span>
          </div>
          <ProgressBar value={data?.overallReadiness ?? 0} color={(data?.overallReadiness ?? 0) >= 75 ? "bg-emerald-500" : "bg-amber-500"} height="h-3" />
        </div>
      </div>

      {/* Readiness checklist */}
      {!isLoading && (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Readiness Checklist</h3></div>
          <div className="divide-y">
            {(data?.readinessItems ?? []).map(item => (
              <div key={item.item} className="flex items-center gap-3 px-4 py-3" data-testid={`readiness-${item.id}`}>
                {item.ready ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
                <div className="flex-1">
                  <p className={`text-xs ${item.ready ? "font-medium" : "text-muted-foreground"}`}>{item.item}</p>
                </div>
                <div className="w-20">
                  <ProgressBar value={item.readinessScore} color={item.readinessScore >= 70 ? "bg-emerald-500" : "bg-amber-500"} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enterprise features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(data?.enterpriseFeatures ?? []).map(f => (
          <div key={f.feature} className="flex items-start gap-3 p-3.5 rounded-xl border bg-card opacity-70" data-testid={`enterprise-feature-${f.feature.toLowerCase().replace(/\s+/g, "-")}`}>
            <Lock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold">{f.feature}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{f.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900">
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">Ready for Enterprise?</p>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Custom pricing, dedicated support, and full platform unlock. Contact us to discuss your organization's needs.</p>
        <Button size="sm" className="h-7 text-xs gap-1.5" data-testid="button-contact-enterprise">
          <Building2 className="h-3.5 w-3.5" />Contact Sales
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Revenue Operations ──────────────────────────────────────────────────

function RevOpsTab() {
  const { data, isLoading } = useQuery<RevenueOpsData>({ queryKey: ["/api/productization/revenue-ops"], staleTime: 10 * 60_000 });
  const pm = data?.platformMetrics;

  return (
    <div className="space-y-4" data-testid="tab-revops">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <Shield className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">Platform-level revenue intelligence — how TrainEfficiency performs as a SaaS business across all 847 organizations.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <>
          {/* MRR breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total MRR",       value: `$${(pm?.totalMRR ?? 0).toLocaleString()}`,  color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Expansion MRR",   value: `$${(pm?.expansionMRR ?? 0).toLocaleString()}`,color: "text-blue-600 dark:text-blue-400" },
              { label: "Net New MRR",     value: `$${(pm?.netNewMRR ?? 0).toLocaleString()}`,  color: "text-primary" },
              { label: "Net Rev Retention", value: `${pm?.netRevRetention ?? 0}%`,            color: pm && pm.netRevRetention >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`revops-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className={`text-base font-extrabold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Plan distribution */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Plan Distribution ({pm?.totalOrgs} orgs)</h3></div>
            <div className="divide-y">
              {(pm?.planDistribution ?? []).map(plan => (
                <div key={plan.plan} className="flex items-center gap-3 px-4 py-3" data-testid={`plan-dist-${plan.plan.toLowerCase()}`}>
                  <div className="w-20 shrink-0">
                    <p className={`text-xs font-semibold capitalize ${PLAN_COLORS[plan.plan.toLowerCase()]}`}>{plan.plan}</p>
                    <p className="text-[9px] text-muted-foreground">{plan.count} orgs</p>
                  </div>
                  <ProgressBar value={plan.pct} color={Object.values({ starter: "bg-slate-400", professional: "bg-blue-500", growth: "bg-violet-500", enterprise: "bg-amber-500" })[["starter","professional","growth","enterprise"].indexOf(plan.plan.toLowerCase())] ?? "bg-primary"} />
                  <div className="w-20 text-right shrink-0">
                    <p className="text-xs font-bold">${(plan.mrr / 1000).toFixed(1)}K</p>
                    <p className="text-[9px] text-muted-foreground">{plan.pct}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upgrade pipeline */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Upgrade Pipeline</h3></div>
            <div className="divide-y">
              {(data?.upgradePipeline ?? []).map(up => (
                <div key={up.fromPlan} className="flex items-center gap-3 px-4 py-3" data-testid={`upgrade-pipeline-${up.fromPlan.toLowerCase()}`}>
                  <div className="flex items-center gap-1.5 flex-1">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 capitalize ${PLAN_COLORS[up.fromPlan.toLowerCase()]}`}>{up.fromPlan}</Badge>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 capitalize ${PLAN_COLORS[up.toPlan.toLowerCase()]}`}>{up.toPlan}</Badge>
                  </div>
                  <p className="text-xs font-bold text-primary">{up.orgsEligible} eligible</p>
                  <p className="text-[9px] text-muted-foreground">{up.avgTimeToUpgrade}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Feature adoption */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Feature Adoption Rates</h3></div>
            <div className="divide-y">
              {(data?.featureAdoption ?? []).map(f => (
                <div key={f.feature} className="flex items-center gap-3 px-4 py-3" data-testid={`feature-adoption-${f.feature.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-xs flex-1">{f.feature}</span>
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 h-3.5 capitalize shrink-0 ${PLAN_COLORS[f.tier]}`}>{f.tier}</Badge>
                  <div className="w-24 flex items-center gap-1.5">
                    <ProgressBar value={f.adoption} color={f.adoption >= 60 ? "bg-emerald-500" : "bg-primary"} />
                    <span className="text-xs font-bold shrink-0 w-7 text-right">{f.adoption}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: AI Advisor ──────────────────────────────────────────────────────────

const PRESET_QUESTIONS = [
  "What features should we focus on next?",
  "What drives upgrades in our network?",
  "What drives retention on our platform?",
  "Which modules are most underutilized?",
  "How do we reduce churn risk?",
];

function AIAdvisorTab() {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AdvisorResult | null>(null);

  const advisorMutation = useMutation({
    mutationFn: async (q: string) => (await apiRequest("POST", "/api/productization/ai-advisor", { question: q })).json(),
    onSuccess: (data: AdvisorResult) => setResult(data),
    onError: () => toast({ title: "AI Advisor error", variant: "destructive" }),
  });

  const PRIORITY_COLORS: Record<string, string> = { high: "text-rose-600 dark:text-rose-400", medium: "text-amber-600 dark:text-amber-400", low: "text-muted-foreground" };
  const CAT_COLORS: Record<string, string> = { product: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", growth: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", retention: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", churn: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };

  return (
    <div className="space-y-4" data-testid="tab-advisor">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">AI Product Advisor</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Ask any product strategy question. The advisor uses your usage data, network intelligence, and platform benchmarks to answer.</p>
        </div>
      </div>

      {/* Preset questions */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_QUESTIONS.map(q => (
          <button key={q} onClick={() => { setQuestion(q); advisorMutation.mutate(q); }}
            disabled={advisorMutation.isPending}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            data-testid={`preset-question-${q.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}>
            {q}
          </button>
        ))}
      </div>

      {/* Custom input */}
      <div className="space-y-2">
        <Textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask a product strategy question..." className="text-sm resize-none" rows={2} data-testid="input-advisor-question" />
        <Button onClick={() => question.trim() && advisorMutation.mutate(question)} disabled={advisorMutation.isPending || !question.trim()} className="h-8 gap-1.5" data-testid="button-ask-advisor">
          <Sparkles className="h-3.5 w-3.5" />{advisorMutation.isPending ? "Thinking..." : "Ask Advisor"}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-3" data-testid="advisor-result">
          <div className="p-4 rounded-xl border bg-primary/5 border-primary/20">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Q: {result.question}</p>
            <p className="text-sm leading-relaxed">{result.answer}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="text-xs font-semibold">Key Insights</h3>
              </div>
              <div className="space-y-2">
                {(result.insights ?? []).map((ins, i) => (
                  <div key={i} className="text-xs" data-testid={`advisor-insight-${i}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge className={`text-[8px] px-1 py-0 h-3.5 capitalize ${CAT_COLORS[ins.category] ?? "bg-muted text-muted-foreground"}`}>{ins.category}</Badge>
                      <span className="text-[9px] text-muted-foreground">{ins.confidence}% confidence</span>
                    </div>
                    <p>{ins.insight}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-primary" />
                <h3 className="text-xs font-semibold">Recommended Actions</h3>
              </div>
              <div className="space-y-2">
                {(result.recommendedActions ?? []).map((action, i) => (
                  <div key={i} data-testid={`advisor-action-${i}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-semibold uppercase ${PRIORITY_COLORS[action.priority]}`}>{action.priority}</span>
                    </div>
                    <p className="text-xs">{action.action}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{action.expectedImpact}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {result.dataNote && <p className="text-[9px] text-muted-foreground text-right">{result.dataNote}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminBillingIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<ProductOverview>({ queryKey: ["/api/productization/overview"], staleTime: 5 * 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-billing-intelligence">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/network-intelligence">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Network Intelligence
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Productization &amp; Revenue Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan architecture, feature entitlements, activation tracking, expansion opportunities, and SaaS revenue operations.
          </p>
        </div>

        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Plan",        value: overview.tier?.name ?? "—",         color: PLAN_COLORS[overview.currentPlan] },
              { label: "Activation",  value: `${overview.activationScore}`,       color: overview.activationScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-primary" },
              { label: "Opportunities", value: `${overview.upgradeOpportunities}`, color: overview.upgradeOpportunities > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
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
          { label: "Network Intel",         href: "/admin/network-intelligence" },
          { label: "Revenue Engine",        href: null, active: true },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-billing">
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
        {activeTab === "entitlements" && <EntitlementsTab />}
        {activeTab === "activation"   && <ActivationTab />}
        {activeTab === "expansion"    && <ExpansionTab />}
        {activeTab === "health"       && <HealthTab />}
        {activeTab === "usage"        && <UsageTab />}
        {activeTab === "plans"        && <PlanComparisonTab />}
        {activeTab === "enterprise"   && <EnterpriseTab />}
        {activeTab === "revops"       && <RevOpsTab />}
        {activeTab === "advisor"      && <AIAdvisorTab />}
      </div>
    </div>
  );
}
