import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Brain, Zap, Database, Search, Bot, GitBranch,
  Users, Lightbulb, Target, MessageSquare, Send, ChevronRight,
  TrendingUp, AlertTriangle, CheckCircle, ArrowUpRight, RefreshCw,
  Activity, Shield, BarChart3, Star, Clock, Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Insight = { type: string; text: string; confidence: number };
type OverviewData = { learningScore: number; platformConfidence: number; improvementOpportunities: number; activePatterns: number; recommendationsGenerated: number; lastLearningCycle: string; crossLayerCoverage: number; systemStatus: string; weeklyInsights: Insight[]; generatedAt: string };

type Learning = { id: string; layer: string; initiative: string; orgsImplemented: number; avgRevenueLift: number; confidence: number; adoptionRate: number; outcome: string; impact: string };
type LearningData = { learnings: Learning[]; positive: number; negative: number; mixed: number; avgConfidence: number; totalOrgsImpacted: number; generatedAt: string };

type Memory = { id: string; category: string; type: string; title: string; detail: string; confidence: number; usedBy: number; createdAt: string };
type MemoryData = { memories: Memory[]; categories: Record<string, number>; totalMemories: number; avgConfidence: number; generatedAt: string };

type Pattern = { id: string; domain: string; title: string; description: string; strength: number; occurrences: number; actionable: boolean; recommendation: string };
type PatternData = { patterns: Pattern[]; domains: string[]; totalPatterns: number; avgStrength: number; actionable: number; generatedAt: string };

type AgentEvolution = { id: string; name: string; successRate: number; failureRate: number; bottleneck: string; recommendation: string; expectedLift: number; priority: string };
type AgentEvolutionData = { agents: AgentEvolution[]; critical: number; avgSuccessRate: number; totalExpectedLift: number; generatedAt: string };

type WorkflowEvolution = { id: string; name: string; completionRate: number; avgDays: number; bottleneck: string; recommendation: string; changeType: string; impact: string; confidence: number };
type WorkflowData = { workflows: WorkflowEvolution[]; topPerformer: string; avgCompletionRate: number; highImpact: number; generatedAt: string };

type Driver = { driver: string; correlation: number; insight: string };
type SuccessModel = { segment: string; avgActivationDays: number; avgRetention12m: number; avgNps: number; topChurnRisk: string };
type CustomerLearningData = { activationDrivers: Driver[]; retentionDrivers: Driver[]; expansionDrivers: Driver[]; successModels: SuccessModel[]; generatedAt: string };

type Recommendation = { id: string; category: string; title: string; description: string; impact: string; effort: string; confidence: number; rank: number; status: string };
type RecommendationData = { recommendations: Recommendation[]; highImpactLowEffort: number; pending: number; underReview: number; generatedAt: string };

type Opportunity = { id: string; dimension: string; metric: string; current: string; target: string; expectedImpact: string; effort: string; priority: string };
type OptimizationData = { opportunities: Opportunity[]; critical: number; totalExpectedRevenueLift: number; quickWins: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const color = value >= 85 ? "bg-emerald-500" : value >= 70 ? "bg-blue-500" : value >= 55 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[9px] font-bold text-muted-foreground w-5 text-right">{value}%</span>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const cfg: Record<string, string> = { high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[impact] ?? "bg-muted text-muted-foreground"}`}>{impact}</Badge>;
}

function EffortBadge({ effort }: { effort: string }) {
  const cfg: Record<string, string> = { low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[effort] ?? "bg-muted text-muted-foreground"}`}>{effort} effort</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[priority] ?? "bg-muted text-muted-foreground"}`}>{priority}</Badge>;
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg: Record<string, string> = { positive: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", negative: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", mixed: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[outcome] ?? "bg-muted text-muted-foreground"}`}>{outcome}</Badge>;
}

function CategoryBadge({ category }: { category: string }) {
  const cfg: Record<string, string> = { success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", churn: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", failure: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", best_practice: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", expansion: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[category] ?? "bg-muted text-muted-foreground"}`}>{category.replace("_", " ")}</Badge>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview",       icon: Activity      },
  { id: "learning",   label: "Learning Engine", icon: Zap           },
  { id: "memory",     label: "Memory",          icon: Database      },
  { id: "patterns",   label: "Patterns",        icon: Search        },
  { id: "agents",     label: "Agent Evolution", icon: Bot           },
  { id: "workflows",  label: "Workflow Evo",    icon: GitBranch     },
  { id: "customer",   label: "Customer Learning",icon: Users        },
  { id: "recs",       label: "Rec Lab",         icon: Lightbulb     },
  { id: "optimize",   label: "Optimization",    icon: Target        },
  { id: "advisor",    label: "Exec Advisor",    icon: MessageSquare },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<OverviewData>({ queryKey: ["/api/platform-brain/overview"], staleTime: 60_000 });

  const INSIGHT_ICONS: Record<string, string> = { pattern: "🔍", agent: "🤖", churn: "⚠️", expansion: "🚀" };

  return (
    <div className="space-y-5" data-testid="tab-overview-brain">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Learning Score",         value: data?.learningScore ?? "—",          color: "text-primary",                                           tab: "learning"  as TabId },
          { label: "Platform Confidence",    value: data ? `${data.platformConfidence}%` : "—", color: "text-emerald-600 dark:text-emerald-400",          tab: "patterns"  as TabId },
          { label: "Improvement Opps",       value: data?.improvementOpportunities ?? "—", color: "text-amber-600 dark:text-amber-400",                   tab: "recs"      as TabId },
          { label: "Active Patterns",        value: data?.activePatterns ?? "—",          color: "text-blue-600 dark:text-blue-400",                       tab: "patterns"  as TabId },
          { label: "Recommendations",        value: data?.recommendationsGenerated ?? "—",color: "text-violet-600 dark:text-violet-400",                  tab: "recs"      as TabId },
        ].map(k => (
          <button key={k.label} onClick={() => setTab(k.tab)} className="p-3.5 rounded-xl border bg-card text-left hover:bg-muted/20 transition-colors group" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </button>
        ))}
      </div>

      {/* System status */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl border bg-card flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <div>
              <p className="text-xs font-semibold">{data.systemStatus}</p>
              <p className="text-[9px] text-muted-foreground">Last cycle {formatDistanceToNow(new Date(data.lastLearningCycle), { addSuffix: true })}</p>
            </div>
          </div>
          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground mb-1">Cross-Layer Coverage</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-extrabold text-primary">{data.crossLayerCoverage}</p>
              <p className="text-[9px] text-muted-foreground">of 16 layers monitored</p>
            </div>
          </div>
          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground mb-1">Platform Confidence</p>
            <ConfBar value={data.platformConfidence} />
          </div>
        </div>
      )}

      {/* Weekly insights */}
      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">This Week's Cross-Layer Insights</p>
          <div className="space-y-2.5">
            {(data?.weeklyInsights ?? []).map((ins, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20" data-testid={`insight-${i}`}>
                <span className="text-base leading-none shrink-0 mt-0.5">{INSIGHT_ICONS[ins.type] ?? "💡"}</span>
                <div className="flex-1">
                  <p className="text-xs">{ins.text}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[9px] text-muted-foreground">Confidence</span>
                    <ConfBar value={ins.confidence} />
                  </div>
                </div>
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4 shrink-0">{ins.type}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: "View Learning Engine",   sub: "10 tracked initiatives",   tab: "learning"  as TabId, icon: Zap         },
          { label: "Browse Platform Memory", sub: "10 stored memories",       tab: "memory"    as TabId, icon: Database    },
          { label: "Explore Patterns",       sub: "17 active patterns",       tab: "patterns"  as TabId, icon: Search      },
          { label: "Agent Evolution",        sub: "2 critical agents",        tab: "agents"    as TabId, icon: Bot         },
          { label: "Recommendation Lab",     sub: "10 platform recs",         tab: "recs"      as TabId, icon: Lightbulb   },
          { label: "Ask Exec Advisor",       sub: "AI meta-intelligence",     tab: "advisor"   as TabId, icon: MessageSquare },
        ].map(a => {
          const Icon = a.icon;
          return (
            <button key={a.label} onClick={() => setTab(a.tab)} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left group" data-testid={`quick-nav-${a.tab}`}>
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-[10px] font-semibold">{a.label}</p>
                <p className="text-[9px] text-muted-foreground">{a.sub}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Learning Engine ─────────────────────────────────────────────────────

function LearningTab() {
  const { data, isLoading } = useQuery<LearningData>({ queryKey: ["/api/platform-brain/learning"], staleTime: 60_000 });
  const [filter, setFilter] = useState<"all" | "positive" | "negative" | "mixed">("all");

  const filtered = (data?.learnings ?? []).filter(l => filter === "all" || l.outcome === filter);

  return (
    <div className="space-y-4" data-testid="tab-learning">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Positive",      value: data.positive,          color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Mixed/Negative",value: data.mixed + data.negative, color: "text-amber-600 dark:text-amber-400" },
            { label: "Avg Confidence",value: `${data.avgConfidence}%`, color: "text-primary" },
            { label: "Orgs Impacted", value: data.totalOrgsImpacted, color: "text-blue-600 dark:text-blue-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        {(["all", "positive", "negative", "mixed"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {f}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.map(l => (
            <div key={l.id} className="p-4 rounded-xl border bg-card" data-testid={`learning-${l.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{l.initiative}</p>
                    <OutcomeBadge outcome={l.outcome} />
                    <ImpactBadge impact={l.impact} />
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{l.layer}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-[9px] bg-muted/20 rounded-lg p-2.5">
                    <div><p className="font-bold text-base">{l.orgsImplemented}</p><p className="text-muted-foreground">orgs</p></div>
                    <div><p className={`font-bold text-base ${l.avgRevenueLift > 0 ? "text-emerald-600 dark:text-emerald-400" : l.avgRevenueLift < 0 ? "text-rose-500" : "text-muted-foreground"}`}>{l.avgRevenueLift > 0 ? "+" : ""}{l.avgRevenueLift}%</p><p className="text-muted-foreground">revenue lift</p></div>
                    <div><p className="font-bold text-base">{l.adoptionRate}%</p><p className="text-muted-foreground">adoption</p></div>
                    <div>
                      <p className="font-bold text-base">{l.confidence}%</p>
                      <p className="text-muted-foreground">confidence</p>
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

// ─── Tab: Memory ──────────────────────────────────────────────────────────────

function MemoryTab() {
  const { data, isLoading } = useQuery<MemoryData>({ queryKey: ["/api/platform-brain/memory"], staleTime: 60_000 });
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? (data?.memories ?? []) : (data?.memories ?? []).filter(m => m.category === filter);

  return (
    <div className="space-y-4" data-testid="tab-memory">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Memories",   value: data.totalMemories,         color: "text-primary" },
            { label: "Avg Confidence",   value: `${data.avgConfidence}%`,   color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Success Patterns", value: data.categories.success ?? 0,color: "text-blue-600 dark:text-blue-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "success", "churn", "failure", "best_practice", "expansion"].map(f => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`mem-filter-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.map(m => (
            <div key={m.id} className="p-4 rounded-xl border bg-card" data-testid={`memory-${m.id}`}>
              <div className="flex items-start gap-3">
                <Database className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{m.title}</p>
                    <CategoryBadge category={m.category} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">{m.detail}</p>
                  <div className="flex items-center gap-4 text-[9px]">
                    <div className="flex items-center gap-1.5 w-32">
                      <span className="text-muted-foreground">Confidence</span>
                      <ConfBar value={m.confidence} />
                    </div>
                    <span className="text-muted-foreground">Used by <span className="font-bold text-foreground">{m.usedBy}</span> systems</span>
                    <span className="text-muted-foreground">Added {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}</span>
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

// ─── Tab: Patterns ────────────────────────────────────────────────────────────

function PatternsTab() {
  const { data, isLoading } = useQuery<PatternData>({ queryKey: ["/api/platform-brain/patterns"], staleTime: 60_000 });
  const [domain, setDomain] = useState("All");

  const filtered = domain === "All" ? (data?.patterns ?? []) : (data?.patterns ?? []).filter(p => p.domain === domain);
  const domains = ["All", ...(data?.domains ?? [])];

  return (
    <div className="space-y-4" data-testid="tab-patterns">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Patterns",  value: data.totalPatterns,  color: "text-primary" },
            { label: "Avg Strength",    value: `${data.avgStrength}%`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Actionable",      value: data.actionable,     color: "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {domains.map(d => (
          <button key={d} onClick={() => setDomain(d)} data-testid={`domain-${d}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${domain === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {d}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.map(p => (
            <div key={p.id} className="p-4 rounded-xl border bg-card" data-testid={`pattern-${p.id}`}>
              <div className="flex items-start gap-3">
                <Search className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{p.title}</p>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{p.domain}</Badge>
                    <span className="text-[9px] text-muted-foreground ml-auto">{p.occurrences} occurrences</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">{p.description}</p>
                  <div className="flex items-center gap-3 mb-2 text-[9px]">
                    <span className="text-muted-foreground">Pattern strength</span>
                    <div className="flex-1 max-w-32"><ConfBar value={p.strength} /></div>
                  </div>
                  {p.actionable && (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5">
                      <Lightbulb className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                      <p className="text-[9px]"><span className="font-medium">Action: </span>{p.recommendation}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Agent Evolution ─────────────────────────────────────────────────────

function AgentsTab() {
  const { data, isLoading } = useQuery<AgentEvolutionData>({ queryKey: ["/api/platform-brain/agent-evolution"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-agents">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Critical Agents",     value: data.critical,           color: data.critical > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground" },
            { label: "Avg Success Rate",    value: `${data.avgSuccessRate}%`,color: "text-primary" },
            { label: "Total Expected Lift", value: `+${data.totalExpectedLift}%`, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {(data?.agents ?? []).sort((a, b) => { const order = { critical: 0, high: 1, medium: 2, low: 3 }; return (order[a.priority as keyof typeof order] ?? 9) - (order[b.priority as keyof typeof order] ?? 9); }).map(a => (
            <div key={a.id} className={`p-4 rounded-xl border bg-card ${a.priority === "critical" ? "border-rose-200 dark:border-rose-900" : a.priority === "high" ? "border-amber-200 dark:border-amber-900" : ""}`} data-testid={`agent-${a.id}`}>
              <div className="flex items-start gap-3">
                <Bot className={`h-4 w-4 shrink-0 mt-0.5 ${a.priority === "critical" ? "text-rose-500" : a.priority === "high" ? "text-amber-500" : "text-primary"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{a.name}</p>
                    <PriorityBadge priority={a.priority} />
                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 ml-auto">+{a.expectedLift}% expected lift</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-2 text-[9px]">
                    <div>
                      <p className="text-muted-foreground mb-0.5">Success Rate</p>
                      <ConfBar value={a.successRate} />
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-0.5">Failure Rate</p>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${a.failureRate}%` }} />
                        </div>
                        <span className="text-[9px] font-bold text-muted-foreground w-5 text-right">{a.failureRate}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[9px]"><span className="font-medium">Bottleneck: </span><span className="text-muted-foreground">{a.bottleneck}</span></p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <ArrowUpRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                      <p className="text-[9px]"><span className="font-medium">Fix: </span><span className="text-muted-foreground">{a.recommendation}</span></p>
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

// ─── Tab: Workflow Evolution ──────────────────────────────────────────────────

function WorkflowsTab() {
  const { data, isLoading } = useQuery<WorkflowData>({ queryKey: ["/api/platform-brain/workflow-evolution"], staleTime: 60_000 });

  const CHANGE_TYPE_LABELS: Record<string, string> = { add_step: "Add Step", remove_step: "Remove Step", resequence: "Resequence", template: "Use as Template" };
  const CHANGE_TYPE_COLORS: Record<string, string> = { add_step: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", remove_step: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", resequence: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", template: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" };

  return (
    <div className="space-y-4" data-testid="tab-workflows">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Top Performer",     value: data.topPerformer.split(" ")[0] + "…", color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Avg Completion",    value: `${data.avgCompletionRate}%`,          color: "text-primary" },
            { label: "High-Impact Fixes", value: data.highImpact,                       color: "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-sm font-extrabold truncate ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {(data?.workflows ?? []).sort((a, b) => { const order = { high: 0, medium: 1, low: 2 }; return (order[a.impact as keyof typeof order] ?? 9) - (order[b.impact as keyof typeof order] ?? 9); }).map(w => (
            <div key={w.id} className="p-4 rounded-xl border bg-card" data-testid={`workflow-${w.id}`}>
              <div className="flex items-start gap-3">
                <GitBranch className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{w.name}</p>
                    <ImpactBadge impact={w.impact} />
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${CHANGE_TYPE_COLORS[w.changeType]}`}>{CHANGE_TYPE_LABELS[w.changeType]}</Badge>
                    <span className="text-[9px] text-muted-foreground ml-auto">{w.avgDays}d avg</span>
                  </div>
                  <div className="flex items-center gap-3 mb-2 text-[9px]">
                    <span className="text-muted-foreground">Completion</span>
                    <div className="flex-1 max-w-40"><ConfBar value={w.completionRate} /></div>
                    <span className="text-[9px]">conf: {w.confidence}%</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] text-muted-foreground">{w.bottleneck}</p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <ArrowUpRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                      <p className="text-[9px]">{w.recommendation}</p>
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

// ─── Tab: Customer Learning ───────────────────────────────────────────────────

function CustomerLearningTab() {
  const { data, isLoading } = useQuery<CustomerLearningData>({ queryKey: ["/api/platform-brain/customer-learning"], staleTime: 60_000 });
  const [section, setSection] = useState<"activation" | "retention" | "expansion" | "models">("activation");

  const SECTION_DATA: Record<string, Driver[]> = {
    activation: data?.activationDrivers ?? [],
    retention:  data?.retentionDrivers ?? [],
    expansion:  data?.expansionDrivers ?? [],
  };

  return (
    <div className="space-y-4" data-testid="tab-customer-learning">
      <div className="flex gap-1.5">
        {(["activation", "retention", "expansion", "models"] as const).map(s => (
          <button key={s} onClick={() => setSection(s)} data-testid={`section-${s}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${section === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          {section !== "models" && (
            <div className="space-y-2.5">
              {SECTION_DATA[section].map((d, i) => (
                <div key={i} className="p-4 rounded-xl border bg-card" data-testid={`driver-${section}-${i}`}>
                  <div className="flex items-start gap-3">
                    <Star className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-bold">{d.driver}</p>
                        <span className="text-xs font-extrabold text-primary">{Math.round(d.correlation * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${d.correlation * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{d.insight}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {section === "models" && (
            <div className="space-y-2.5">
              {(data?.successModels ?? []).map((m, i) => (
                <div key={i} className="p-4 rounded-xl border bg-card" data-testid={`model-${i}`}>
                  <p className="text-xs font-bold mb-3">{m.segment}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-[9px]">
                    <div className="p-2 rounded-lg bg-muted/20"><p className="font-bold text-sm text-primary">{m.avgActivationDays}d</p><p className="text-muted-foreground">avg activation</p></div>
                    <div className="p-2 rounded-lg bg-muted/20"><p className="font-bold text-sm text-emerald-600 dark:text-emerald-400">{m.avgRetention12m}%</p><p className="text-muted-foreground">12m retention</p></div>
                    <div className="p-2 rounded-lg bg-muted/20"><p className="font-bold text-sm text-blue-600 dark:text-blue-400">{m.avgNps}</p><p className="text-muted-foreground">avg NPS</p></div>
                    <div className="p-2 rounded-lg bg-muted/20"><p className="font-semibold text-xs text-amber-600 dark:text-amber-400 truncate">{m.topChurnRisk}</p><p className="text-muted-foreground">top churn risk</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Recommendation Lab ──────────────────────────────────────────────────

function RecsTab() {
  const { data, isLoading } = useQuery<RecommendationData>({ queryKey: ["/api/platform-brain/recommendations"], staleTime: 60_000 });
  const { toast } = useToast();
  const [impact, setImpact] = useState("all");

  const filtered = impact === "all" ? (data?.recommendations ?? []) : (data?.recommendations ?? []).filter(r => r.impact === impact);

  const STATUS_COLORS: Record<string, string> = { pending: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", under_review: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", implemented: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };

  return (
    <div className="space-y-4" data-testid="tab-recs">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Quick Wins",          value: data.highImpactLowEffort, color: "text-emerald-600 dark:text-emerald-400", sub: "high impact + low effort" },
            { label: "Pending",             value: data.pending,             color: "text-primary",                           sub: "awaiting implementation" },
            { label: "Under Review",        value: data.underReview,         color: "text-blue-600 dark:text-blue-400",       sub: "being evaluated" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
              <p className="text-[8px] text-muted-foreground/60">{m.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        {["all", "high", "medium"].map(f => (
          <button key={f} onClick={() => setImpact(f)} data-testid={`impact-filter-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${impact === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {f === "all" ? "All" : `${f} impact`}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.map((r, i) => (
            <div key={r.id} className="p-4 rounded-xl border bg-card" data-testid={`rec-${r.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">#{r.rank}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{r.title}</p>
                    <ImpactBadge impact={r.impact} />
                    <EffortBadge effort={r.effort} />
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{r.category}</Badge>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ml-auto ${STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground"}`}>{r.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">{r.description}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className="text-muted-foreground">Confidence</span>
                      <div className="w-20"><ConfBar value={r.confidence} /></div>
                    </div>
                    {r.status === "pending" && (
                      <Button size="sm" className="h-6 text-[9px] px-2 gap-1 ml-auto" onClick={() => toast({ title: "Recommendation queued for implementation", description: r.title })} data-testid={`button-implement-${r.id}`}>
                        <CheckCircle className="h-2.5 w-2.5" />Implement
                      </Button>
                    )}
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

// ─── Tab: Optimization ────────────────────────────────────────────────────────

function OptimizationTab() {
  const { data, isLoading } = useQuery<OptimizationData>({ queryKey: ["/api/platform-brain/optimization"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-optimization">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Critical Opps",      value: data.critical,                                         color: data.critical > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground" },
            { label: "Quick Wins",         value: data.quickWins,                                        color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Revenue Opportunity",value: `+$${(data.totalExpectedRevenueLift / 1000).toFixed(1)}K/mo`, color: "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {(data?.opportunities ?? []).sort((a, b) => { const order = { critical: 0, high: 1, medium: 2, low: 3 }; return (order[a.priority as keyof typeof order] ?? 9) - (order[b.priority as keyof typeof order] ?? 9); }).map(o => (
            <div key={o.id} className={`p-4 rounded-xl border bg-card ${o.priority === "critical" ? "border-rose-200 dark:border-rose-900 bg-rose-500/5" : ""}`} data-testid={`opp-${o.id}`}>
              <div className="flex items-start gap-3">
                <Target className={`h-4 w-4 shrink-0 mt-0.5 ${o.priority === "critical" ? "text-rose-500" : o.priority === "high" ? "text-amber-500" : "text-primary"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{o.dimension}</Badge>
                    <p className="text-xs font-bold">{o.metric}</p>
                    <PriorityBadge priority={o.priority} />
                    <EffortBadge effort={o.effort} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center text-[9px] bg-muted/20 rounded-lg p-2 mb-2">
                    <div><p className="font-bold text-foreground">{o.current}</p><p className="text-muted-foreground">current</p></div>
                    <div className="flex items-center justify-center"><ArrowUpRight className="h-3.5 w-3.5 text-primary" /></div>
                    <div><p className="font-bold text-emerald-600 dark:text-emerald-400">{o.target}</p><p className="text-muted-foreground">target</p></div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px]">
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    <p className="font-medium">{o.expectedImpact}</p>
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

// ─── Tab: Executive Advisor ───────────────────────────────────────────────────

function AdvisorTab() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<{ role: "user" | "advisor"; text: string; ts: Date }[]>([
    { role: "advisor", text: "I'm your Executive Platform Advisor. I have cross-layer intelligence across all 16 platform layers — learning engine, pattern memory, agent evolution, workflow analysis, and customer success data. Ask me anything about the platform.", ts: new Date() },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const advisorMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/platform-brain/advisor", { question: q }),
    onSuccess: (data: any) => {
      setConversation(prev => [...prev, { role: "advisor", text: data.answer, ts: new Date() }]);
    },
  });

  const send = () => {
    if (!question.trim()) return;
    setConversation(prev => [...prev, { role: "user", text: question, ts: new Date() }]);
    advisorMutation.mutate(question);
    setQuestion("");
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [conversation]);

  const PROMPTS = [
    "What should we build next?",
    "What is causing churn?",
    "What drives expansion?",
    "What workflow performs best?",
    "Which agent needs improvement?",
  ];

  return (
    <div className="space-y-3" data-testid="tab-advisor">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <Brain className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">The Executive Platform Advisor uses all 16 layers of platform memory, patterns, and learning data to give meta-level strategic guidance.</p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ height: "440px" }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conversation.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`advisor-msg-${i}`}>
              <div className={`max-w-[88%] px-3 py-2.5 rounded-xl text-xs ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {msg.role === "advisor" && <div className="flex items-center gap-1.5 mb-1 text-[9px] font-semibold opacity-70"><Brain className="h-2.5 w-2.5" />Executive Advisor</div>}
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          ))}
          {advisorMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted px-3 py-2.5 rounded-xl flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Analyzing all 16 layers…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t bg-muted/10">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PROMPTS.map((p, idx) => (
              <button key={p} onClick={() => setQuestion(p)} className="px-2 py-1 rounded-lg border text-[9px] hover:bg-muted/50 transition-colors" data-testid={`advisor-prompt-${idx}`}>{p}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Ask the Platform Brain anything…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-advisor-question" />
            <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={send} disabled={!question.trim() || advisorMutation.isPending} data-testid="button-advisor-send">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPlatformBrainPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<OverviewData>({ queryKey: ["/api/platform-brain/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-platform-brain">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/customer-success-os">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Customer Success OS
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Platform Brain
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The meta-intelligence layer above all 16 platform layers — observing, learning, and continuously improving the operating system itself.
          </p>
        </div>

        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0 flex-wrap">
            {[
              { label: "Learning Score",    value: overview.learningScore,          color: "text-primary" },
              { label: "Confidence",        value: `${overview.platformConfidence}%`, color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Status",            value: overview.systemStatus,           color: "text-blue-600 dark:text-blue-400" },
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
          { label: "Workforce OS",        href: "/admin/workforce-os" },
          { label: "Command Center",      href: "/admin/command-center" },
          { label: "Customer Success OS", href: "/admin/customer-success-os" },
          { label: "Platform Brain",      href: null },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Status banner */}
      {overview && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5" data-testid="brain-status-banner">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <p className="text-xs">
            <span className="font-bold">Platform Brain Active</span> — monitoring {overview.crossLayerCoverage} layers, {overview.activePatterns} patterns detected, {overview.recommendationsGenerated} recommendations generated.
            Last cycle: {formatDistanceToNow(new Date(overview.lastLearningCycle), { addSuffix: true })}.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-brain">
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
        {activeTab === "overview"   && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "learning"   && <LearningTab />}
        {activeTab === "memory"     && <MemoryTab />}
        {activeTab === "patterns"   && <PatternsTab />}
        {activeTab === "agents"     && <AgentsTab />}
        {activeTab === "workflows"  && <WorkflowsTab />}
        {activeTab === "customer"   && <CustomerLearningTab />}
        {activeTab === "recs"       && <RecsTab />}
        {activeTab === "optimize"   && <OptimizationTab />}
        {activeTab === "advisor"    && <AdvisorTab />}
      </div>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5" data-testid="architecture-complete-17">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">AI Self-Improving Platform — All 17 Layers Complete</p>
            <p className="text-[10px] text-muted-foreground mb-2">TrainEfficiency is now a continuously improving AI operating system. Layers 1–16 run customer businesses. Layer 17 improves the system itself.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS","Platform Brain",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 16 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
