import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Cpu, BarChart3, List, FileText, Calendar,
  Zap, GitBranch, CheckSquare, Rocket, TrendingUp, Search,
  MessageSquare, Send, ChevronRight, ArrowUpRight, RefreshCw,
  AlertTriangle, CheckCircle, Clock, Shield, Layers, Brain,
  Activity, Target, Star, X, Play,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type LoopStage = { stage: string; status: string; icon: string };
type OverviewData = { roadmapScore: number; engineeringVelocity: number; featuresProposed: number; featuresReleased: number; revenueImpact: number; platformConfidence: number; activeSprintItems: number; backlogHealth: string; lastCycleAt: string; loop: LoopStage[]; generatedAt: string };

type BacklogItem = { id: string; title: string; source: string; revenueImpact: number; retentionImpact: number; adoptionImpact: number; complexity: number; confidence: number; priorityScore: number; status: string; category: string };
type BacklogData = { items: BacklogItem[]; readyCount: number; inProgressCount: number; backlogCount: number; avgPriorityScore: number; generatedAt: string };

type Specification = { featureIdea: string; businessObjective: string; productRequirements: string[]; userStories: string[]; technicalRequirements: string[]; apiRequirements: string[]; databaseRequirements: string[]; securityRequirements: string[]; uiRequirements: string[]; acceptanceCriteria: string[]; qaChecklist: string[]; generatedAt: string };

type SprintItem = { id: string; title: string; points: number; status: string; assignee: string };
type Sprint = { name: string; goal: string; startDate: string; endDate: string; items: SprintItem[]; velocity: number; capacity: number; risk: string; expectedImpact: string };
type SprintsData = { current: Sprint; next: Sprint; future: Sprint; generatedAt: string };

type SimulationResult = { feature: string; adoptionImpact: number; revenueImpact: number; retentionImpact: number; supportImpact: number; engineeringCost: string; confidence: number; recommendation: string; rationale: string; risks: string[]; generatedAt: string };

type CodexItem = { id: string; title: string; stage: string; priority: string; specReady: boolean; confidence: number; estimatedDays: number; assignedTo: string; addedAt: string };
type CodexData = { queue: CodexItem[]; stageCounts: Record<string, number>; totalItems: number; criticalCount: number; generatedAt: string };

type QaCheck = { category: string; status: string; score: number; detail: string };
type QaData = { checks: QaCheck[]; releaseConfidence: number; warnings: number; failures: number; pass: number; recommendation: string; generatedAt: string };

type Release = { id: string; name: string; status: string; featureReadiness: number; rolloutRisk: string; rollbackPlan: string; userImpact: string; monitoringPlan: string; releasedAt: string | null; items: string[] };
type ReleaseData = { releases: Release[]; released: number; ready: number; testing: number; draft: number; generatedAt: string };

type ImprovementBefore = { retention6m: number; adoptionScore: number; supportTickets: number };
type Improvement = { id: string; name: string; category: string; status: string; releasedAt: string; before: ImprovementBefore; after: ImprovementBefore; revenueGenerated: number; churnPrevented: number; adoptionLift: number; supportReduction: number };
type ImprovementTotals = { revenueGenerated: number; churnPrevented: number; avgAdoptionLift: number; avgSupportReduction: number };
type ImprovementData = { improvements: Improvement[]; totals: ImprovementTotals; generatedAt: string };

type Discovery = { id: string; type: string; title: string; source: string; signal: string; priority: string; confidence: number; estimatedRevenueLift: number; orgsRequesting: number };
type DiscoveryData = { discoveries: Discovery[]; typeBreakdown: Record<string, number>; totalDiscoveries: number; highPriority: number; totalOrgsRequesting: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ScoreBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[9px] font-bold text-muted-foreground w-5 text-right">{value}</span>
    </div>
  );
}

function PriorityBadge({ p }: { p: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[p] ?? "bg-muted text-muted-foreground"}`}>{p}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", backlog: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", released: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", testing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", draft: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", qa: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", specification: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", pending: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", complete: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", in_review: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s.replace("_", " ")}</Badge>;
}

function RiskBadge({ r }: { r: string }) {
  const cfg: Record<string, string> = { none: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[r] ?? "bg-muted text-muted-foreground"}`}>{r} risk</Badge>;
}

function TypeBadge({ t }: { t: string }) {
  const cfg: Record<string, string> = { feature: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", integration: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", ux: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", automation: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[t] ?? "bg-muted text-muted-foreground"}`}>{t}</Badge>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview",        icon: Activity       },
  { id: "backlog",   label: "Backlog",         icon: List           },
  { id: "specs",     label: "Specifications",  icon: FileText       },
  { id: "sprints",   label: "Sprint Planning", icon: Calendar       },
  { id: "simulate",  label: "Impact Simulator",icon: Zap            },
  { id: "codex",     label: "Codex Queue",     icon: GitBranch      },
  { id: "qa",        label: "QA Intelligence", icon: CheckSquare    },
  { id: "releases",  label: "Release Readiness",icon: Rocket        },
  { id: "tracker",   label: "Improvement Tracker", icon: TrendingUp },
  { id: "discovery", label: "Discovery",       icon: Search         },
  { id: "advisor",   label: "Exec Advisor",    icon: MessageSquare  },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<OverviewData>({ queryKey: ["/api/platform-engineering/overview"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-overview-eng">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Roadmap Score",       value: data?.roadmapScore ?? "—",                                  color: "text-primary",                                          tab: "backlog"   as TabId },
          { label: "Engineering Velocity",value: data ? `${data.engineeringVelocity}%` : "—",               color: "text-blue-600 dark:text-blue-400",                       tab: "sprints"   as TabId },
          { label: "Features Proposed",   value: data?.featuresProposed ?? "—",                              color: "text-amber-600 dark:text-amber-400",                     tab: "backlog"   as TabId },
          { label: "Features Released",   value: data?.featuresReleased ?? "—",                              color: "text-emerald-600 dark:text-emerald-400",                 tab: "releases"  as TabId },
          { label: "Revenue Impact",      value: data ? `$${(data.revenueImpact / 1000).toFixed(0)}K` : "—", color: "text-emerald-600 dark:text-emerald-400",                tab: "tracker"   as TabId },
          { label: "Platform Confidence", value: data ? `${data.platformConfidence}%` : "—",                color: "text-primary",                                           tab: "qa"        as TabId },
        ].map(k => (
          <button key={k.label} onClick={() => setTab(k.tab)} className="p-3.5 rounded-xl border bg-card text-left hover:bg-muted/20 transition-colors group" data-testid={`eng-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </button>
        ))}
      </div>

      {/* Status bar */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl border bg-card flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <div>
              <p className="text-xs font-semibold">Autonomous Loop Active</p>
              <p className="text-[9px] text-muted-foreground">Last cycle {formatDistanceToNow(new Date(data.lastCycleAt), { addSuffix: true })}</p>
            </div>
          </div>
          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground mb-1">Backlog Health</p>
            <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{data.backlogHealth}</p>
          </div>
          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground mb-1">Active Sprint Items</p>
            <p className="text-sm font-extrabold text-primary">{data.activeSprintItems} items in flight</p>
          </div>
        </div>
      )}

      {/* Autonomous product loop */}
      {isLoading ? <Skeleton className="h-32 rounded-xl" /> : data && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Autonomous Product Loop — All Stages Active</p>
          <div className="flex flex-wrap gap-2">
            {data.loop.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground opacity-40" />}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-900" data-testid={`loop-stage-${i}`}>
                  <span className="text-sm leading-none">{stage.icon}</span>
                  <span className="text-[9px] font-medium">{stage.stage}</span>
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: "View Backlog",          sub: "12 items ranked", tab: "backlog"   as TabId, icon: List        },
          { label: "Generate Spec",         sub: "Any feature idea",tab: "specs"     as TabId, icon: FileText    },
          { label: "Sprint Plan",           sub: "3 sprints mapped",tab: "sprints"   as TabId, icon: Calendar    },
          { label: "Simulate Impact",       sub: "Predict outcomes",tab: "simulate"  as TabId, icon: Zap         },
          { label: "QA Intelligence",       sub: "93% confidence",  tab: "qa"        as TabId, icon: CheckSquare },
          { label: "Ask Exec Advisor",      sub: "AI product strategist", tab: "advisor" as TabId, icon: MessageSquare },
        ].map(a => {
          const Icon = a.icon;
          return (
            <button key={a.label} onClick={() => setTab(a.tab)} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left group" data-testid={`eng-quick-${a.tab}`}>
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

// ─── Tab: Backlog ─────────────────────────────────────────────────────────────

function BacklogTab() {
  const { data, isLoading } = useQuery<BacklogData>({ queryKey: ["/api/platform-engineering/backlog"], staleTime: 60_000 });
  const [filter, setFilter] = useState("all");
  const { toast } = useToast();

  const filtered = filter === "all" ? (data?.items ?? []) : (data?.items ?? []).filter(i => i.status === filter || i.category.toLowerCase() === filter);

  const CATEGORY_COLORS: Record<string, string> = { Retention: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", Expansion: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", UX: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", Integration: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", Adoption: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", Onboarding: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", Operations: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", Intelligence: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" };

  return (
    <div className="space-y-4" data-testid="tab-backlog">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Ready",      value: data.readyCount,      color: "text-emerald-600 dark:text-emerald-400" },
            { label: "In Progress",value: data.inProgressCount, color: "text-blue-600 dark:text-blue-400" },
            { label: "Queued",     value: data.backlogCount,    color: "text-muted-foreground" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "ready", "in_progress", "backlog"].map(f => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`bl-filter-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {filtered.map((item, i) => (
            <div key={item.id} className={`p-4 rounded-xl border bg-card ${item.status === "in_progress" ? "border-blue-200 dark:border-blue-900" : item.status === "ready" ? "border-emerald-200 dark:border-emerald-900" : ""}`} data-testid={`backlog-${item.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">#{i + 1}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{item.title}</p>
                    <StatusBadge s={item.status} />
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${CATEGORY_COLORS[item.category] ?? "bg-muted text-muted-foreground"}`}>{item.category}</Badge>
                    <span className="text-[9px] font-bold text-primary ml-auto">Score: {item.priorityScore}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-[9px] bg-muted/20 rounded-lg p-2 mb-2">
                    <div><p className={`font-bold ${item.revenueImpact >= 80 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{item.revenueImpact}</p><p className="text-muted-foreground">revenue</p></div>
                    <div><p className={`font-bold ${item.retentionImpact >= 80 ? "text-blue-600 dark:text-blue-400" : ""}`}>{item.retentionImpact}</p><p className="text-muted-foreground">retention</p></div>
                    <div><p className="font-bold">{item.adoptionImpact}</p><p className="text-muted-foreground">adoption</p></div>
                    <div><p className={`font-bold ${item.complexity <= 2 ? "text-emerald-600 dark:text-emerald-400" : item.complexity >= 5 ? "text-rose-500" : ""}`}>{item.complexity}/10</p><p className="text-muted-foreground">complexity</p></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className="text-muted-foreground">from</span>
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{item.source}</Badge>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{item.confidence}% confidence</span>
                    </div>
                    <Button size="sm" className="h-6 text-[9px] px-2 gap-1" onClick={() => toast({ title: `"${item.title}" added to sprint queue` })} data-testid={`button-queue-${item.id}`}>
                      <Play className="h-2.5 w-2.5" />Queue
                    </Button>
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

// ─── Tab: Specifications ──────────────────────────────────────────────────────

function SpecsTab() {
  const [idea, setIdea] = useState("");
  const [spec, setSpec] = useState<Specification | null>(null);
  const { toast } = useToast();

  const specMutation = useMutation({
    mutationFn: (featureIdea: string) => apiRequest("POST", "/api/platform-engineering/specification", { featureIdea }).then(r => r.json()),
    onSuccess: (data: any) => setSpec(data),
    onError: () => toast({ title: "Failed to generate specification", variant: "destructive" }),
  });

  const QUICK_IDEAS = ["PAIL 30-day activation nudge", "Group training session management", "AI-generated progress reports", "Mobile app PWA", "Calendly integration"];

  return (
    <div className="space-y-4" data-testid="tab-specs">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">Enter any feature idea and the Platform Engineering AI will generate a complete product specification — business objective, user stories, technical requirements, API spec, acceptance criteria, and QA checklist.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_IDEAS.map(qi => (
          <button key={qi} onClick={() => setIdea(qi)} className="px-2 py-1 rounded-lg border text-[9px] hover:bg-muted/50 transition-colors" data-testid={`quick-idea-${QUICK_IDEAS.indexOf(qi)}`}>{qi}</button>
        ))}
      </div>

      <div className="flex gap-2">
        <input value={idea} onChange={e => setIdea(e.target.value)} placeholder="Enter feature idea (e.g. 'PAIL 30-day activation nudge')…" className="flex-1 h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-feature-idea" />
        <Button className="h-9 gap-1.5 shrink-0 text-xs" onClick={() => { if (idea.trim()) specMutation.mutate(idea.trim()); }} disabled={!idea.trim() || specMutation.isPending} data-testid="button-generate-spec">
          {specMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          {specMutation.isPending ? "Generating…" : "Generate Spec"}
        </Button>
      </div>

      {spec && (
        <div className="space-y-3" data-testid="spec-output">
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-xs font-extrabold text-primary mb-1">{spec.featureIdea}</p>
            <p className="text-[10px] text-muted-foreground">{spec.businessObjective}</p>
          </div>

          {([
            { label: "Product Requirements",   items: spec.productRequirements  },
            { label: "User Stories",           items: spec.userStories          },
            { label: "Technical Requirements", items: spec.technicalRequirements},
            { label: "API Requirements",       items: spec.apiRequirements      },
            { label: "Security Requirements",  items: spec.securityRequirements },
            { label: "Acceptance Criteria",    items: spec.acceptanceCriteria   },
            { label: "QA Checklist",           items: spec.qaChecklist          },
          ] as { label: string; items: string[] }[]).map(section => (
            <div key={section.label} className="p-3.5 rounded-xl border bg-card" data-testid={`spec-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">{section.label}</p>
              <div className="space-y-1.5">
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px]">{item}</p>
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

// ─── Tab: Sprint Planning ─────────────────────────────────────────────────────

function SprintsTab() {
  const { data, isLoading } = useQuery<SprintsData>({ queryKey: ["/api/platform-engineering/sprints"], staleTime: 60_000 });
  const { toast } = useToast();

  const SPRINT_COLORS = { current: "border-primary bg-primary/5", next: "border-blue-200 dark:border-blue-900 bg-blue-500/5", future: "border-muted" };
  const RISK_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-500" };
  const ITEM_STATUS_COLORS: Record<string, string> = { complete: "text-emerald-600 dark:text-emerald-400", in_progress: "text-blue-600 dark:text-blue-400", in_review: "text-amber-600 dark:text-amber-400", ready: "text-muted-foreground", backlog: "text-muted-foreground" };
  const ITEM_STATUS_ICONS: Record<string, string> = { complete: "✓", in_progress: "▶", in_review: "⟳", ready: "○", backlog: "○" };

  function SprintCard({ sprint, label, colorClass }: { sprint: Sprint; label: string; colorClass: string }) {
    return (
      <div className={`p-4 rounded-xl border ${colorClass}`} data-testid={`sprint-${label.toLowerCase()}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-bold">{sprint.name}</p>
            <p className="text-[9px] text-muted-foreground">{format(new Date(sprint.startDate), "MMM d")} – {format(new Date(sprint.endDate), "MMM d")}</p>
          </div>
          <Badge variant={label === "Current" ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">{label}</Badge>
        </div>
        <div className="flex items-start gap-1.5 mb-3 p-2 rounded-lg bg-muted/20">
          <Target className="h-3 w-3 text-primary shrink-0 mt-0.5" />
          <p className="text-[9px]">{sprint.goal}</p>
        </div>
        <div className="space-y-1.5 mb-3">
          {sprint.items.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-[9px]">
              <span className={`font-bold shrink-0 ${ITEM_STATUS_COLORS[item.status]}`}>{ITEM_STATUS_ICONS[item.status]}</span>
              <p className="flex-1 truncate">{item.title}</p>
              <span className="text-muted-foreground shrink-0">{item.points}pt</span>
              <StatusBadge s={item.status} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[9px] border-t pt-2.5">
          <div><p className="font-bold">{sprint.velocity}/{sprint.capacity}</p><p className="text-muted-foreground">velocity</p></div>
          <div><p className={`font-bold ${RISK_COLORS[sprint.risk]}`}>{sprint.risk} risk</p><p className="text-muted-foreground">risk level</p></div>
          <div><p className="font-bold text-emerald-600 dark:text-emerald-400 truncate text-[8px]">{sprint.expectedImpact.split(",")[0]}</p><p className="text-muted-foreground">impact</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="tab-sprints">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">3 sprints auto-generated from backlog intelligence — all items prioritized by revenue × retention × adoption score.</p>
        <Button size="sm" className="h-7 gap-1 text-[10px]" onClick={() => toast({ title: "Sprint plan regenerated", description: "Sprint 18-A updated with latest backlog priorities." })} data-testid="button-regenerate-sprints">
          <RefreshCw className="h-3 w-3" />Regenerate
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {data && <>
            <SprintCard sprint={data.current} label="Current" colorClass={SPRINT_COLORS.current} />
            <SprintCard sprint={data.next}    label="Next"    colorClass={SPRINT_COLORS.next}    />
            <SprintCard sprint={data.future}  label="Future"  colorClass={SPRINT_COLORS.future}  />
          </>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Impact Simulator ────────────────────────────────────────────────────

function SimulateTab() {
  const [feature, setFeature] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const { toast } = useToast();

  const simMutation = useMutation({
    mutationFn: (f: string) => apiRequest("POST", "/api/platform-engineering/simulate", { feature: f }).then(r => r.json()),
    onSuccess: (data: any) => setResult(data),
    onError: () => toast({ title: "Simulation failed", variant: "destructive" }),
  });

  const QUICK_FEATURES = ["PAIL activation nudge", "Churn intervention sequence", "Sidebar redesign", "Enterprise upgrade trigger", "Revenue Agent pairing"];
  const REC_COLORS: Record<string, string> = { Deploy: "text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30", Review: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30", Reject: "text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30" };

  return (
    <div className="space-y-4" data-testid="tab-simulate">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <Zap className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">Predict adoption, revenue, retention, and support outcomes before committing engineering resources. The simulator uses cross-layer platform memory and pattern data.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_FEATURES.map((qf, i) => (
          <button key={qf} onClick={() => setFeature(qf)} className="px-2 py-1 rounded-lg border text-[9px] hover:bg-muted/50 transition-colors" data-testid={`quick-feature-${i}`}>{qf}</button>
        ))}
      </div>

      <div className="flex gap-2">
        <input value={feature} onChange={e => setFeature(e.target.value)} placeholder="Enter a feature or change to simulate (e.g. 'PAIL activation nudge')…" className="flex-1 h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-simulate-feature" />
        <Button className="h-9 gap-1.5 shrink-0 text-xs" onClick={() => { if (feature.trim()) simMutation.mutate(feature.trim()); }} disabled={!feature.trim() || simMutation.isPending} data-testid="button-simulate">
          {simMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {simMutation.isPending ? "Simulating…" : "Simulate"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3" data-testid="simulation-result">
          <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-card">
            <div className={`px-3 py-1.5 rounded-lg text-sm font-extrabold ${REC_COLORS[result.recommendation] ?? "bg-muted text-muted-foreground"}`}>
              {result.recommendation}
            </div>
            <div>
              <p className="text-xs font-bold">"{result.feature}"</p>
              <p className="text-[9px] text-muted-foreground">{result.confidence}% confidence · Engineering cost: {result.engineeringCost}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Adoption Impact",   value: result.adoptionImpact,                          color: "text-blue-600 dark:text-blue-400", prefix: "+" },
              { label: "Revenue Impact",    value: result.revenueImpact,                            color: "text-emerald-600 dark:text-emerald-400", prefix: "+" },
              { label: "Retention Impact",  value: result.retentionImpact,                          color: "text-primary", prefix: "+" },
              { label: "Support Impact",    value: Math.abs(result.supportImpact),                  color: result.supportImpact < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500", prefix: result.supportImpact < 0 ? "−" : "+" },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
                <p className={`text-2xl font-extrabold ${m.color}`}>{m.prefix}{m.value}%</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Rationale</p>
            <p className="text-[10px]">{result.rationale}</p>
          </div>

          <div className="p-3.5 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Risks</p>
            <div className="space-y-1.5">
              {result.risks.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px]">{r}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Codex Queue ─────────────────────────────────────────────────────────

function CodexTab() {
  const { data, isLoading } = useQuery<CodexData>({ queryKey: ["/api/platform-engineering/codex-queue"], staleTime: 60_000 });
  const { toast } = useToast();

  const STAGES = ["pending", "specification", "in_progress", "qa", "approved"];
  const STAGE_LABELS: Record<string, string> = { pending: "Pending", specification: "Spec", in_progress: "In Progress", qa: "QA", approved: "Approved" };

  return (
    <div className="space-y-4" data-testid="tab-codex">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <GitBranch className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">The Codex Queue bridges Platform Brain intelligence and implementation — items flow from Pending → Specification → In Progress → QA → Approved → Released automatically.</p>
      </div>

      {/* Pipeline visualization */}
      {data && (
        <div className="p-3.5 rounded-xl border bg-card">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {STAGES.map((stage, i) => (
              <div key={stage} className="flex items-center gap-2 shrink-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground opacity-40 shrink-0" />}
                <div className="text-center">
                  <div className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold ${data.stageCounts[stage] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {STAGE_LABELS[stage]}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{data.stageCounts[stage] ?? 0} items</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {(data?.queue ?? []).map(item => (
            <div key={item.id} className={`p-4 rounded-xl border bg-card ${item.priority === "critical" ? "border-rose-200 dark:border-rose-900" : ""}`} data-testid={`codex-${item.id}`}>
              <div className="flex items-start gap-3">
                <GitBranch className={`h-4 w-4 shrink-0 mt-0.5 ${item.priority === "critical" ? "text-rose-500" : "text-primary"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{item.title}</p>
                    <StatusBadge s={item.stage} />
                    <PriorityBadge p={item.priority} />
                    {item.specReady && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Spec Ready</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-[9px]">
                    <span className="text-muted-foreground">{item.confidence}% confidence</span>
                    <span className="text-muted-foreground">~{item.estimatedDays}d</span>
                    <span className="text-muted-foreground">Added {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true })}</span>
                    <Button size="sm" className="h-5 text-[8px] px-1.5 gap-0.5 ml-auto" variant="outline" onClick={() => toast({ title: `${item.title} advanced to next stage` })} data-testid={`button-advance-${item.id}`}>
                      Advance <ChevronRight className="h-2.5 w-2.5" />
                    </Button>
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

// ─── Tab: QA Intelligence ─────────────────────────────────────────────────────

function QaTab() {
  const { data, isLoading } = useQuery<QaData>({ queryKey: ["/api/platform-engineering/qa"], staleTime: 60_000 });
  const STATUS_COLORS: Record<string, string> = { pass: "text-emerald-600 dark:text-emerald-400", warning: "text-amber-600 dark:text-amber-400", fail: "text-rose-500" };
  const STATUS_ICONS: Record<string, ReactNode> = { pass: <CheckCircle className="h-4 w-4 text-emerald-500" />, warning: <AlertTriangle className="h-4 w-4 text-amber-500" />, fail: <X className="h-4 w-4 text-rose-500" /> };
  const REC_COLORS: Record<string, string> = { "Approved for Release": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", "Review Before Release": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", "Block Release": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };

  return (
    <div className="space-y-4" data-testid="tab-qa">
      {data && (
        <>
          <div className="flex items-center gap-4 p-4 rounded-xl border bg-card">
            <div className="text-center shrink-0">
              <p className="text-4xl font-extrabold text-primary">{data.releaseConfidence}</p>
              <p className="text-[9px] text-muted-foreground">Release Confidence</p>
            </div>
            <div className="flex-1">
              <Badge className={`text-xs px-3 py-1 ${REC_COLORS[data.recommendation] ?? "bg-muted text-muted-foreground"}`}>{data.recommendation}</Badge>
              <div className="flex items-center gap-4 mt-2 text-[9px]">
                <span className="text-emerald-600 dark:text-emerald-400">{data.pass} passing</span>
                {data.warnings > 0 && <span className="text-amber-600 dark:text-amber-400">{data.warnings} warnings</span>}
                {data.failures > 0 && <span className="text-rose-500">{data.failures} failures</span>}
              </div>
            </div>
          </div>

          {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
            <div className="rounded-xl border overflow-hidden">
              <div className="divide-y">
                {data.checks.map(check => (
                  <div key={check.category} className="flex items-center gap-3 px-4 py-3" data-testid={`qa-check-${check.category.toLowerCase()}`}>
                    <span className="shrink-0">{STATUS_ICONS[check.status]}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-[10px] font-semibold">{check.category}</p>
                        <span className={`text-[9px] font-bold ${STATUS_COLORS[check.status]}`}>{check.score}/100</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground">{check.detail}</p>
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

// ─── Tab: Release Readiness ───────────────────────────────────────────────────

function ReleasesTab() {
  const { data, isLoading } = useQuery<ReleaseData>({ queryKey: ["/api/platform-engineering/releases"], staleTime: 60_000 });
  const { toast } = useToast();

  const STATUS_BORDER: Record<string, string> = { released: "border-emerald-200 dark:border-emerald-900 bg-emerald-500/5", ready: "border-primary/30 bg-primary/5", testing: "border-amber-200 dark:border-amber-900 bg-amber-500/5", draft: "" };
  const READINESS_COLOR = (n: number) => n >= 90 ? "text-emerald-600 dark:text-emerald-400" : n >= 70 ? "text-primary" : n >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";
  const IMPACT_COLORS: Record<string, string> = { positive: "text-emerald-600 dark:text-emerald-400", neutral: "text-muted-foreground", negative: "text-rose-500" };

  return (
    <div className="space-y-4" data-testid="tab-releases">
      {data && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Released", value: data.released, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Ready",    value: data.ready,    color: "text-primary" },
            { label: "Testing",  value: data.testing,  color: "text-amber-600 dark:text-amber-400" },
            { label: "Draft",    value: data.draft,    color: "text-muted-foreground" },
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
          {(data?.releases ?? []).map(rel => (
            <div key={rel.id} className={`p-4 rounded-xl border bg-card ${STATUS_BORDER[rel.status] ?? ""}`} data-testid={`release-${rel.id}`}>
              <div className="flex items-start gap-3">
                <Rocket className={`h-4 w-4 shrink-0 mt-0.5 ${rel.status === "released" ? "text-emerald-500" : rel.status === "ready" ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{rel.name}</p>
                    <StatusBadge s={rel.status} />
                    <RiskBadge r={rel.rolloutRisk} />
                    <span className={`text-[9px] font-medium ${IMPACT_COLORS[rel.userImpact]}`}>User impact: {rel.userImpact}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[9px] mb-2">
                    <span className="text-muted-foreground">Readiness:</span>
                    <div className="flex items-center gap-1.5 flex-1">
                      <div className="h-1.5 flex-1 max-w-32 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${rel.featureReadiness >= 90 ? "bg-emerald-500" : rel.featureReadiness >= 70 ? "bg-primary" : "bg-amber-500"}`} style={{ width: `${rel.featureReadiness}%` }} />
                      </div>
                      <span className={`font-bold ${READINESS_COLOR(rel.featureReadiness)}`}>{rel.featureReadiness}%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[9px]">
                    <div className="flex items-start gap-1.5"><Shield className="h-2.5 w-2.5 text-muted-foreground shrink-0 mt-0.5" /><p className="text-muted-foreground">{rel.rollbackPlan}</p></div>
                    <div className="flex items-start gap-1.5"><Activity className="h-2.5 w-2.5 text-muted-foreground shrink-0 mt-0.5" /><p className="text-muted-foreground">{rel.monitoringPlan}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rel.items.map((item, i) => <Badge key={i} variant="secondary" className="text-[8px] px-1.5 py-0 h-4">{item}</Badge>)}
                  </div>
                  {rel.releasedAt && <p className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-1.5">✓ Released {formatDistanceToNow(new Date(rel.releasedAt), { addSuffix: true })}</p>}
                  {rel.status === "ready" && (
                    <Button size="sm" className="mt-2 h-6 gap-1 text-[9px]" onClick={() => toast({ title: `${rel.name} release initiated` })} data-testid={`button-release-${rel.id}`}>
                      <Rocket className="h-2.5 w-2.5" />Deploy
                    </Button>
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

// ─── Tab: Improvement Tracker ─────────────────────────────────────────────────

function TrackerTab() {
  const { data, isLoading } = useQuery<ImprovementData>({ queryKey: ["/api/platform-engineering/improvements"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-tracker">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Revenue Generated",   value: `$${(data.totals.revenueGenerated / 1000).toFixed(0)}K`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Churn Prevented",     value: `${data.totals.churnPrevented} orgs`,                   color: "text-primary" },
            { label: "Avg Adoption Lift",   value: `+${data.totals.avgAdoptionLift}%`,                     color: "text-blue-600 dark:text-blue-400" },
            { label: "Avg Support −",       value: `−${data.totals.avgSupportReduction} tickets`,          color: "text-amber-600 dark:text-amber-400" },
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
          {(data?.improvements ?? []).map(imp => (
            <div key={imp.id} className="p-4 rounded-xl border bg-card" data-testid={`improvement-${imp.id}`}>
              <div className="flex items-start gap-3">
                <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-xs font-bold">{imp.name}</p>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{imp.category}</Badge>
                    <StatusBadge s={imp.status} />
                    <p className="text-[9px] text-muted-foreground ml-auto">Released {formatDistanceToNow(new Date(imp.releasedAt), { addSuffix: true })}</p>
                  </div>
                  {/* Before / After */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {(["retention6m", "adoptionScore", "supportTickets"] as const).map(metric => {
                      const labels: Record<string, string> = { retention6m: "Retention 6m", adoptionScore: "Adoption Score", supportTickets: "Support Tickets" };
                      const before = imp.before[metric];
                      const after  = imp.after[metric];
                      const improved = metric === "supportTickets" ? after < before : after > before;
                      return (
                        <div key={metric} className="p-2 rounded-lg bg-muted/20 text-center text-[9px]">
                          <p className="text-muted-foreground mb-1">{labels[metric]}</p>
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-muted-foreground line-through">{before}{metric !== "supportTickets" ? "%" : ""}</span>
                            <ArrowUpRight className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                            <span className={`font-bold ${improved ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>{after}{metric !== "supportTickets" ? "%" : ""}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4 text-[9px]">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">+${imp.revenueGenerated.toLocaleString()} revenue</span>
                    <span className="text-primary font-bold">{imp.churnPrevented} churn prevented</span>
                    <span className="text-blue-600 dark:text-blue-400">+{imp.adoptionLift}% adoption</span>
                    <span className="text-amber-600 dark:text-amber-400">−{imp.supportReduction} tickets</span>
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

// ─── Tab: Discovery ───────────────────────────────────────────────────────────

function DiscoveryTab() {
  const { data, isLoading } = useQuery<DiscoveryData>({ queryKey: ["/api/platform-engineering/discovery"], staleTime: 60_000 });
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = typeFilter === "all" ? (data?.discoveries ?? []) : (data?.discoveries ?? []).filter(d => d.type === typeFilter);

  return (
    <div className="space-y-4" data-testid="tab-discovery">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Discoveries",      value: data.totalDiscoveries,   color: "text-primary" },
            { label: "High Priority",    value: data.highPriority,       color: "text-amber-600 dark:text-amber-400" },
            { label: "Orgs Requesting",  value: data.totalOrgsRequesting,color: "text-blue-600 dark:text-blue-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "feature", "integration", "ux", "automation"].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} data-testid={`type-filter-${t}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.sort((a, b) => (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0)).map(d => (
            <div key={d.id} className="p-4 rounded-xl border bg-card" data-testid={`discovery-${d.id}`}>
              <div className="flex items-start gap-3">
                <Search className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{d.title}</p>
                    <TypeBadge t={d.type} />
                    {d.priority === "high" && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">High Priority</Badge>}
                  </div>
                  <div className="flex items-start gap-1.5 mb-2">
                    <Star className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-muted-foreground italic">"{d.signal}"</p>
                  </div>
                  <div className="flex items-center gap-4 text-[9px]">
                    <span className="text-muted-foreground">Source: <span className="font-medium text-foreground">{d.source}</span></span>
                    {d.orgsRequesting > 0 && <span className="text-muted-foreground">{d.orgsRequesting} orgs requesting</span>}
                    {d.estimatedRevenueLift > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-bold">+{d.estimatedRevenueLift}% revenue lift</span>}
                    <span className="text-muted-foreground ml-auto">{d.confidence}% confidence</span>
                    <Button size="sm" className="h-5 text-[8px] px-1.5 gap-0.5" variant="outline" onClick={() => toast({ title: `"${d.title}" added to backlog` })} data-testid={`button-add-discovery-${d.id}`}>
                      + Backlog
                    </Button>
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
  const [convo, setConvo] = useState<{ role: "user" | "advisor"; text: string }[]>([
    { role: "advisor", text: "I'm your Executive Product Advisor with cross-layer intelligence across all 18 platform layers — backlog intelligence, sprint planning, product discovery, improvement tracking, and platform memory. What would you like to know?" },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const advisorMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/platform-engineering/advisor", { question: q }).then(r => r.json()),
    onSuccess: (data: any) => setConvo(prev => [...prev, { role: "advisor", text: data.answer }]),
  });

  const send = () => {
    if (!question.trim()) return;
    setConvo(prev => [...prev, { role: "user", text: question }]);
    advisorMutation.mutate(question);
    setQuestion("");
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [convo]);

  const PROMPTS = ["What should we build next?", "What feature has highest ROI?", "What causes onboarding failure?", "What's causing churn?", "What drives expansion?", "What should be in the next sprint?"];

  return (
    <div className="space-y-3" data-testid="tab-advisor-eng">
      <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5">
        <Brain className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">The Executive Product Advisor uses all 18 layers of platform memory — backlog scores, sprint velocity, improvement data, pattern memory, and product discovery signals.</p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ height: "440px" }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {convo.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`eng-advisor-msg-${i}`}>
              <div className={`max-w-[88%] px-3 py-2.5 rounded-xl text-xs ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {msg.role === "advisor" && <div className="flex items-center gap-1.5 mb-1 text-[9px] font-semibold opacity-70"><Cpu className="h-2.5 w-2.5" />Exec Product Advisor</div>}
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          ))}
          {advisorMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted px-3 py-2.5 rounded-xl flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Analyzing 18 layers…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="p-3 border-t bg-muted/10">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PROMPTS.map((p, idx) => (
              <button key={p} onClick={() => setQuestion(p)} className="px-2 py-1 rounded-lg border text-[9px] hover:bg-muted/50 transition-colors" data-testid={`eng-prompt-${idx}`}>{p}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Ask the Platform Engineering AI anything…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-eng-advisor" />
            <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={send} disabled={!question.trim() || advisorMutation.isPending} data-testid="button-eng-advisor-send">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPlatformEngineeringPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<OverviewData>({ queryKey: ["/api/platform-engineering/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-platform-engineering">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/platform-brain">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Platform Brain
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Platform Engineering Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The autonomous product team — generating roadmaps, specs, sprint plans, impact simulations, QA strategies, and release recommendations continuously.
          </p>
        </div>

        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0 flex-wrap">
            {[
              { label: "Roadmap Score",  value: overview.roadmapScore,    color: "text-primary" },
              { label: "Velocity",       value: `${overview.engineeringVelocity}%`, color: "text-blue-600 dark:text-blue-400" },
              { label: "Revenue Impact", value: `$${(overview.revenueImpact / 1000).toFixed(0)}K`, color: "text-emerald-600 dark:text-emerald-400" },
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
          { label: "Command Center",    href: "/admin/command-center" },
          { label: "Customer Success",  href: "/admin/customer-success-os" },
          { label: "Platform Brain",    href: "/admin/platform-brain" },
          { label: "Platform Engineering", href: null },
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
      <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5" data-testid="engineering-status">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
        <p className="text-xs">
          <span className="font-bold">Autonomous Product Loop Active</span> — {overview?.featuresProposed ?? 31} features proposed, {overview?.featuresReleased ?? 14} released, ${((overview?.revenueImpact ?? 284000) / 1000).toFixed(0)}K cumulative revenue impact measured.
          {overview && ` Last cycle ${formatDistanceToNow(new Date(overview.lastCycleAt), { addSuffix: true })}.`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-eng">
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
        {activeTab === "overview"  && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "backlog"   && <BacklogTab />}
        {activeTab === "specs"     && <SpecsTab />}
        {activeTab === "sprints"   && <SprintsTab />}
        {activeTab === "simulate"  && <SimulateTab />}
        {activeTab === "codex"     && <CodexTab />}
        {activeTab === "qa"        && <QaTab />}
        {activeTab === "releases"  && <ReleasesTab />}
        {activeTab === "tracker"   && <TrackerTab />}
        {activeTab === "discovery" && <DiscoveryTab />}
        {activeTab === "advisor"   && <AdvisorTab />}
      </div>

      {/* Forward nav → Agent Communications Hub */}
      <Link href="/admin/agent-communications">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-teal-500/5 hover:from-primary/10 hover:to-teal-500/10 transition-colors cursor-pointer group" data-testid="nav-agent-communications">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Agent Communications Hub</p>
            <p className="text-xs text-muted-foreground mt-0.5">Agents coordinate as a real workforce — messaging, task handoffs, escalations, announcements, and cross-department collaboration with full audit trail.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-orange-500/5" data-testid="architecture-complete-18">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Closed-Loop AI Engineering System — All 18 Layers Complete</p>
            <p className="text-[10px] text-muted-foreground mb-2">Layers 1–16 run customer businesses. Layer 17 improves the platform. Layer 18 improves the platform's ability to improve itself — a fully autonomous product engineering cycle.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 17 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
