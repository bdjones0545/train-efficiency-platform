import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Zap, Target, DollarSign, Users, BarChart3,
  ChevronRight, CheckCircle, AlertTriangle, Clock, Play, Pause,
  XCircle, TrendingUp, Bot, Rocket, RefreshCw, Send, Handshake,
  Activity, Star, ArrowUpRight, GitBranch, Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Recommendation = { id: string; source: string; title: string; expectedImpact: string; revenuePotential: number; confidenceScore: number; priority: string; assignedAgents: string[]; requiredApprovals: number; status: string; category: string };
type RecsData = { recommendations: Recommendation[]; totalPending: number; totalRunning: number; totalRevenuePotential: number; generatedAt: string };
type CampaignPlan = { campaignName: string; revenueGoal: number; timelineWeeks: number; landingPagePlan: string; emailSequence: { subject: string; purpose: string }[]; followUpSequence: { day: number; action: string }[]; outreachTargets: string[]; kpis: { metric: string; target: string }[]; agentAssignments: { agent: string; responsibility: string }[]; confidenceScore: number };
type RecoveryOpportunity = { id: string; type: string; count: number; estimatedValue: number; recoveryStrategy: string; confidence: number; urgency: string };
type RecoveryData = { opportunities: RecoveryOpportunity[]; totalEstimatedRecovery: number; recoveredThisMonth: number; activeRecoveryPlans: number; recoveryROI: number; generatedAt: string };
type Partnership = { id: string; name: string; type: string; status: string; estimatedLeads: number; estimatedRevenue: number; outreachContacts: number; stage: string };
type PartnershipsData = { partnerships: Partnership[]; activePartnerships: number; totalPipelineValue: number; generatedAt: string };
type Objective = { id: string; goal: string; status: string; progressPct: number; currentValue: number; targetValue: number; expectedRevenue: number; agents: string[]; timelineWeeks: number; weekElapsed: number; projectedCompletion: string };
type ObjectivesData = { objectives: Objective[]; activeObjectives: number; completedObjectives: number; totalProjectedRevenue: number; generatedAt: string };
type COOAnswer = { analysis: string; immediateActions: string[]; agentCoordination: string[]; blockers: string[]; forecastUpdate: string; confidence: number };
type GrowthComponent = { metric: string; score: number; trend: string; weight: string };
type GrowthData = { velocity: number; velocityLabel: string; trend: string; components: GrowthComponent[]; forecastVelocity: number; forecastLabel: string; weeklyChange: number; generatedAt: string };
type Workflow = { id: string; name: string; status: string; owner: string | null; agents: string[]; tasks: number; completedTasks: number; startedAt?: string; completedAt?: string; scheduledAt?: string; estimatedCompletionAt?: string; expectedRevenue: number; successScore: number | null };
type WorkflowsData = { workflows: Workflow[]; statusSummary: Record<string, number>; totalActiveRevenue: number; generatedAt: string };
type Outcome = { id: string; deployment: string; expectedOutcome: string; actualOutcome: string; expectedRevenue: number; actualRevenue: number; timeSavedHours: number; successScore: number; status: string; completedAt: string };
type OutcomesData = { outcomes: Outcome[]; totalRevenueDelivered: number; avgSuccessScore: number; exceededCount: number; partialCount: number; missedCount: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PriorityBadge({ p }: { p: string }) {
  const cfg: Record<string, string> = { high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[p] ?? "bg-muted text-muted-foreground"}`}>{p}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { running: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", scheduled: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", failed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", opportunity: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", exceeded: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", missed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s.replace("_", " ")}</Badge>;
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? "bg-emerald-500" : value >= 65 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div>
      <span className="text-[9px] font-bold text-muted-foreground w-6">{value}%</span>
    </div>
  );
}

function ScoreCircle({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color = score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score >= 60 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  const sz = size === "lg" ? "text-5xl" : size === "md" ? "text-2xl" : "text-lg";
  return <span className={`${sz} font-extrabold ${color}`}>{score}</span>;
}

// ─── Tabs definition ──────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview",          icon: Activity },
  { id: "recs",        label: "Recommendations",   icon: Target },
  { id: "campaign",    label: "Campaign Builder",  icon: Rocket },
  { id: "recovery",    label: "Revenue Recovery",  icon: DollarSign },
  { id: "partnerships",label: "Partnerships",      icon: Handshake },
  { id: "objectives",  label: "Objectives",        icon: Star },
  { id: "coo",         label: "AI COO",            icon: Bot },
  { id: "velocity",    label: "Growth Velocity",   icon: TrendingUp },
  { id: "deployments", label: "Deployments",       icon: GitBranch },
  { id: "outcomes",    label: "Outcomes",          icon: CheckCircle },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data: recs }      = useQuery<RecsData>({ queryKey: ["/api/execution/recommendations"], staleTime: 60_000 });
  const { data: recovery }  = useQuery<RecoveryData>({ queryKey: ["/api/execution/revenue-recovery"], staleTime: 60_000 });
  const { data: workflows } = useQuery<WorkflowsData>({ queryKey: ["/api/execution/workflows"], staleTime: 60_000 });
  const { data: velocity }  = useQuery<GrowthData>({ queryKey: ["/api/execution/growth-velocity"], staleTime: 60_000 });
  const { data: outcomes }  = useQuery<OutcomesData>({ queryKey: ["/api/execution/outcomes"], staleTime: 60_000 });

  const kpis = [
    { label: "Active Deployments",    value: workflows?.statusSummary?.running ?? "—",       color: "text-primary",                                    tab: "deployments" as TabId },
    { label: "Revenue Impact",        value: `$${((workflows?.totalActiveRevenue ?? 0) / 1000).toFixed(1)}k`, color: "text-emerald-600 dark:text-emerald-400", tab: "outcomes" as TabId },
    { label: "Growth Velocity",       value: `${velocity?.velocity ?? "—"}`,                  color: velocity?.velocity && velocity.velocity >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400", tab: "velocity" as TabId },
    { label: "Recovery Potential",    value: `$${((recovery?.totalEstimatedRecovery ?? 0) / 1000).toFixed(1)}k`, color: "text-violet-600 dark:text-violet-400", tab: "recovery" as TabId },
    { label: "Pending Recs",          value: recs?.totalPending ?? "—",                        color: "text-amber-600 dark:text-amber-400",               tab: "recs" as TabId },
    { label: "Deployment Success",    value: outcomes ? `${outcomes.avgSuccessScore}%` : "—",  color: "text-emerald-600 dark:text-emerald-400",           tab: "outcomes" as TabId },
  ];

  return (
    <div className="space-y-4" data-testid="tab-execution-overview">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpis.map(k => (
          <button key={k.label} onClick={() => setTab(k.tab)} className="p-4 rounded-xl border bg-card text-left hover:bg-muted/30 transition-colors group" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{k.label}</p>
            <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
          </button>
        ))}
      </div>

      {/* Top pending recommendations */}
      <div className="rounded-xl border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold flex-1">Top Pending Recommendations</h3>
          <button onClick={() => setTab("recs")} className="text-[10px] text-primary hover:underline">View all</button>
        </div>
        <div className="divide-y">
          {(recs?.recommendations ?? []).filter(r => r.status === "pending").slice(0, 3).map(rec => (
            <div key={rec.id} className="flex items-center gap-3 px-4 py-3" data-testid={`overview-rec-${rec.id}`}>
              <PriorityBadge p={rec.priority} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{rec.title}</p>
                <p className="text-[9px] text-muted-foreground">{rec.source} · {rec.expectedImpact}</p>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">${rec.revenuePotential.toLocaleString()}</span>
            </div>
          ))}
          {!recs && <div className="px-4 py-3"><Skeleton className="h-8" /></div>}
        </div>
      </div>

      {/* Active workflows */}
      <div className="rounded-xl border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold flex-1">Active Deployments</h3>
          <button onClick={() => setTab("deployments")} className="text-[10px] text-primary hover:underline">View all</button>
        </div>
        <div className="divide-y">
          {(workflows?.workflows ?? []).filter(w => w.status === "running").slice(0, 3).map(wf => (
            <div key={wf.id} className="flex items-center gap-3 px-4 py-3" data-testid={`overview-workflow-${wf.id}`}>
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{wf.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((wf.completedTasks / Math.max(1, wf.tasks)) * 100)}%` }} /></div>
                  <span className="text-[9px] text-muted-foreground">{wf.completedTasks}/{wf.tasks} tasks</span>
                </div>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">${wf.expectedRevenue.toLocaleString()}</span>
            </div>
          ))}
          {!workflows && <div className="px-4 py-3"><Skeleton className="h-8" /></div>}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Recommendations ─────────────────────────────────────────────────────

function RecommendationsTab() {
  const { data, isLoading } = useQuery<RecsData>({ queryKey: ["/api/execution/recommendations"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");

  const deployMutation = useMutation({
    mutationFn: (rec: Recommendation) => apiRequest("POST", "/api/execution/deploy", { recommendationId: rec.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/execution/recommendations"] }); qc.invalidateQueries({ queryKey: ["/api/execution/workflows"] }); toast({ title: "Deployment initiated", description: "Agents assigned and workflow started." }); },
    onError: () => toast({ title: "Deploy failed", variant: "destructive" }),
  });

  const filtered = (data?.recommendations ?? []).filter(r => filter === "all" || r.category === filter || r.status === filter);
  const categories = [...new Set((data?.recommendations ?? []).map(r => r.category))];

  return (
    <div className="space-y-4" data-testid="tab-recommendations">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Pending", value: data.totalPending, color: "text-amber-600 dark:text-amber-400" },
            { label: "Running", value: data.totalRunning, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Total Potential", value: `$${(data.totalRevenuePotential / 1000).toFixed(1)}k`, color: "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "pending", "running", ...categories].map(f => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`filter-rec-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(rec => (
            <div key={rec.id} className={`p-4 rounded-xl border bg-card ${rec.status === "running" ? "border-emerald-200 dark:border-emerald-900 bg-emerald-500/5" : ""}`} data-testid={`rec-${rec.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <PriorityBadge p={rec.priority} />
                    <StatusBadge s={rec.status} />
                    <span className="text-[9px] text-muted-foreground">{rec.source}</span>
                  </div>
                  <p className="text-sm font-semibold mb-1">{rec.title}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                    <div><p className="text-[9px] text-muted-foreground">Impact</p><p className="text-xs font-medium">{rec.expectedImpact}</p></div>
                    <div><p className="text-[9px] text-muted-foreground">Revenue Potential</p><p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${rec.revenuePotential.toLocaleString()}</p></div>
                    <div><p className="text-[9px] text-muted-foreground">Confidence</p><ConfidenceBar value={rec.confidenceScore} /></div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[9px] text-muted-foreground">
                    <span>Agents: {rec.assignedAgents.join(", ")}</span>
                    {rec.requiredApprovals > 0 && <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Shield className="h-3 w-3" />{rec.requiredApprovals} approval{rec.requiredApprovals > 1 ? "s" : ""} required</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {rec.status === "pending" && (
                    <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => deployMutation.mutate(rec)} disabled={deployMutation.isPending} data-testid={`button-deploy-${rec.id}`}>
                      <Zap className="h-3 w-3" />Execute
                    </Button>
                  )}
                  {rec.status === "running" && (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[9px] h-6 px-2">
                      <Activity className="h-2.5 w-2.5 mr-1" />Running
                    </Badge>
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

// ─── Tab: Campaign Builder ────────────────────────────────────────────────────

function CampaignBuilderTab() {
  const [goal, setGoal] = useState("");
  const [campaign, setCampaign] = useState<CampaignPlan | null>(null);
  const { toast } = useToast();

  const buildMutation = useMutation({
    mutationFn: (g: string) => apiRequest("POST", "/api/execution/campaign-builder", { goal: g }),
    onSuccess: (data: any) => setCampaign(data.campaign),
    onError: () => toast({ title: "Campaign generation failed", variant: "destructive" }),
  });

  const PRESETS = ["Increase football team enrollment", "Grow corporate wellness contracts", "Recruit 2 new coaches", "Launch summer athlete bootcamp", "Increase referrals by 40%"];

  return (
    <div className="space-y-4" data-testid="tab-campaign-builder">
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <p className="text-xs font-semibold mb-3 flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5 text-primary" />Enter a business goal — AI generates a complete, deployable campaign</p>
        <div className="flex gap-2">
          <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. Add 20 athletes this quarter" className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-campaign-goal" onKeyDown={e => e.key === "Enter" && goal.trim() && buildMutation.mutate(goal.trim())} />
          <Button size="sm" className="h-9 gap-1.5" disabled={!goal.trim() || buildMutation.isPending} onClick={() => buildMutation.mutate(goal.trim())} data-testid="button-build-campaign">
            {buildMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Build Campaign
          </Button>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {PRESETS.map(p => (
            <button key={p} onClick={() => { setGoal(p); buildMutation.mutate(p); }} className="px-2 py-1 rounded-lg bg-background border text-[10px] hover:bg-primary hover:text-primary-foreground transition-colors" data-testid={`preset-${p.substring(0, 12).replace(/\s+/g, "-").toLowerCase()}`}>{p}</button>
          ))}
        </div>
      </div>

      {buildMutation.isPending && (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      )}

      {campaign && !buildMutation.isPending && (
        <div className="space-y-4" data-testid="campaign-result">
          <div className="flex items-start justify-between gap-3 p-4 rounded-xl border bg-gradient-to-r from-emerald-500/5 to-primary/5 border-emerald-200 dark:border-emerald-900">
            <div>
              <p className="text-base font-bold">{campaign.campaignName}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">${campaign.revenueGoal.toLocaleString()} revenue goal</span>
                <span>{campaign.timelineWeeks} weeks</span>
                <span>Confidence: {campaign.confidenceScore}%</span>
              </div>
            </div>
            <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-deploy-campaign"><Rocket className="h-3.5 w-3.5" />Deploy</Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b text-xs font-semibold">Email Sequence ({campaign.emailSequence?.length ?? 0} emails)</div>
              <div className="divide-y">
                {(campaign.emailSequence ?? []).map((e, i) => (
                  <div key={i} className="px-3 py-2.5">
                    <p className="text-xs font-medium">{e.subject}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{e.purpose}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b text-xs font-semibold">Follow-Up Timeline</div>
              <div className="divide-y">
                {(campaign.followUpSequence ?? []).map((f, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <Badge variant="outline" className="text-[9px] w-12 justify-center shrink-0">Day {f.day}</Badge>
                    <p className="text-xs">{f.action}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b text-xs font-semibold">KPI Targets</div>
              <div className="divide-y">
                {(campaign.kpis ?? []).map((k, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs">{k.metric}</span>
                    <span className="text-xs font-bold text-primary">{k.target}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b text-xs font-semibold">Agent Assignments</div>
              <div className="divide-y">
                {(campaign.agentAssignments ?? []).map((a, i) => (
                  <div key={i} className="px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-primary">{a.agent}</p>
                    <p className="text-[10px] text-muted-foreground">{a.responsibility}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {campaign.outreachTargets?.length > 0 && (
            <div className="p-3.5 rounded-xl border bg-primary/5">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-primary" />Outreach Targets</p>
              <div className="flex flex-wrap gap-2">
                {campaign.outreachTargets.map((t, i) => <Badge key={i} variant="outline" className="text-[10px]">{t}</Badge>)}
              </div>
            </div>
          )}

          {campaign.landingPagePlan && (
            <div className="p-3.5 rounded-xl border bg-muted/30">
              <p className="text-xs font-semibold mb-1">Landing Page Plan</p>
              <p className="text-xs text-muted-foreground">{campaign.landingPagePlan}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Revenue Recovery ────────────────────────────────────────────────────

function RevenueRecoveryTab() {
  const { data, isLoading } = useQuery<RecoveryData>({ queryKey: ["/api/execution/revenue-recovery"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();

  const launchMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/execution/revenue-recovery/launch", { opportunityId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/execution/revenue-recovery"] }); toast({ title: "Recovery plan launched", description: "Agents dispatched to re-engage contacts." }); },
    onError: () => toast({ title: "Launch failed", variant: "destructive" }),
  });

  const URGENCY_COLORS: Record<string, string> = { high: "border-rose-200 dark:border-rose-900 bg-rose-500/5", medium: "border-amber-200 dark:border-amber-900 bg-amber-500/5", low: "" };

  return (
    <div className="space-y-4" data-testid="tab-revenue-recovery">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Potential",    value: `$${(data.totalEstimatedRecovery / 1000).toFixed(1)}k`, color: "text-primary" },
            { label: "Recovered This Mo.", value: `$${(data.recoveredThisMonth / 1000).toFixed(1)}k`,     color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Active Plans",       value: data.activeRecoveryPlans,                                color: "text-blue-600 dark:text-blue-400" },
            { label: "Recovery ROI",       value: `${data.recoveryROI}×`,                                  color: "text-violet-600 dark:text-violet-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`recovery-stat-${m.label.toLowerCase().replace(/[\s.]+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.opportunities ?? []).map(opp => (
            <div key={opp.id} className={`p-4 rounded-xl border ${URGENCY_COLORS[opp.urgency] ?? ""}`} data-testid={`recovery-opp-${opp.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-sm font-semibold">{opp.type}</p>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${opp.urgency === "high" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>{opp.urgency} urgency</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div><p className="text-[9px] text-muted-foreground">Count</p><p className="text-xs font-bold">{opp.count}</p></div>
                    <div><p className="text-[9px] text-muted-foreground">Est. Value</p><p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${opp.estimatedValue.toLocaleString()}</p></div>
                    <div><p className="text-[9px] text-muted-foreground">Confidence</p><ConfidenceBar value={opp.confidence} /></div>
                  </div>
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-background">
                    <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px]"><span className="font-medium">Strategy: </span>{opp.recoveryStrategy}</p>
                  </div>
                </div>
                <Button size="sm" className="h-8 text-[10px] gap-1 shrink-0" onClick={() => launchMutation.mutate(opp.id)} disabled={launchMutation.isPending} data-testid={`button-launch-recovery-${opp.id}`}>
                  <Rocket className="h-3 w-3" />Launch
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Partnerships ────────────────────────────────────────────────────────

function PartnershipsTab() {
  const { data, isLoading } = useQuery<PartnershipsData>({ queryKey: ["/api/execution/partnerships"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();

  const launchMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/execution/partnership-launch", { partnershipId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/execution/partnerships"] }); toast({ title: "Partnership outreach launched", description: "Contact list built and sequences activated." }); },
    onError: () => toast({ title: "Launch failed", variant: "destructive" }),
  });

  const STAGE_LABELS: Record<string, string> = { identified: "Identified", proposal_sent: "Proposal Sent", active: "Active", negotiating: "Negotiating" };

  return (
    <div className="space-y-4" data-testid="tab-partnerships">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active Partners",    value: data.activePartnerships,                              color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Pipeline Value",     value: `$${(data.totalPipelineValue / 1000).toFixed(1)}k`,  color: "text-primary" },
            { label: "Opportunities",      value: (data.partnerships ?? []).length,                     color: "text-violet-600 dark:text-violet-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.partnerships ?? []).map(p => (
            <div key={p.id} className="p-4 rounded-xl border bg-card" data-testid={`partnership-${p.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <StatusBadge s={p.status} />
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1.5">
                    <span>{p.type}</span>
                    <span>·</span>
                    <span className="capitalize">{STAGE_LABELS[p.stage] ?? p.stage}</span>
                    <span>·</span>
                    <span>{p.outreachContacts} contacts</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-[9px] text-muted-foreground">Est. Leads/mo</p><p className="text-xs font-bold">{p.estimatedLeads}</p></div>
                    <div><p className="text-[9px] text-muted-foreground">Est. Revenue</p><p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${p.estimatedRevenue.toLocaleString()}</p></div>
                  </div>
                </div>
                {p.status !== "active" && (
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0" onClick={() => launchMutation.mutate(p.id)} disabled={launchMutation.isPending} data-testid={`button-launch-partner-${p.id}`}>
                    <Send className="h-3 w-3" />Outreach
                  </Button>
                )}
                {p.status === "active" && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[9px] h-6 px-2 shrink-0">Active</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Objectives ──────────────────────────────────────────────────────────

function ObjectivesTab() {
  const { data, isLoading } = useQuery<ObjectivesData>({ queryKey: ["/api/execution/objectives"], staleTime: 60_000 });
  const [newGoal, setNewGoal] = useState("");
  const [deployResult, setDeployResult] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const deployMutation = useMutation({
    mutationFn: (g: string) => apiRequest("POST", "/api/execution/objective-deploy", { goal: g }),
    onSuccess: (res: any) => { setDeployResult(res); setNewGoal(""); qc.invalidateQueries({ queryKey: ["/api/execution/objectives"] }); toast({ title: "Objective deployed!", description: "Agent team assembled." }); },
    onError: () => toast({ title: "Deploy failed", variant: "destructive" }),
  });

  const PROJ_COLORS: Record<string, string> = { on_track: "text-emerald-600 dark:text-emerald-400", at_risk: "text-amber-600 dark:text-amber-400", not_started: "text-muted-foreground", behind: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-objectives">
      <div className="p-4 rounded-xl border bg-primary/5">
        <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-primary" />Deploy a new objective — AI assembles an agent team and execution plan</p>
        <div className="flex gap-2">
          <input value={newGoal} onChange={e => setNewGoal(e.target.value)} placeholder="e.g. Add 25 athletes this summer" className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-objective-goal" onKeyDown={e => e.key === "Enter" && newGoal.trim() && deployMutation.mutate(newGoal.trim())} />
          <Button size="sm" className="h-9 gap-1.5" disabled={!newGoal.trim() || deployMutation.isPending} onClick={() => deployMutation.mutate(newGoal.trim())} data-testid="button-deploy-objective">
            {deployMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Deploy
          </Button>
        </div>
      </div>

      {deployResult && (
        <div className="p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900" data-testid="deploy-result">
          <div className="flex items-center gap-2 mb-2"><CheckCircle className="h-4 w-4 text-emerald-500" /><p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Objective deployed — {deployResult.assignedAgents?.length} agents assigned</p></div>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div><span className="text-muted-foreground">Timeline: </span>{deployResult.projectedTimelineWeeks}w</div>
            <div><span className="text-muted-foreground">Expected revenue: </span><span className="font-bold text-emerald-600 dark:text-emerald-400">${deployResult.expectedRevenue?.toLocaleString()}</span></div>
          </div>
          <div className="space-y-1">
            {Object.entries(deployResult.executionPlan ?? {}).map(([phase, desc]: [string, any]) => (
              <div key={phase} className="flex items-start gap-2 text-[10px]">
                <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.objectives ?? []).map(obj => (
            <div key={obj.id} className="p-4 rounded-xl border bg-card" data-testid={`objective-${obj.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-sm font-semibold flex-1">{obj.goal}</p>
                    <StatusBadge s={obj.status} />
                    <span className={`text-[10px] font-medium capitalize ${PROJ_COLORS[obj.projectedCompletion]}`}>{obj.projectedCompletion.replace("_", " ")}</span>
                  </div>
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1">
                      <span>Progress: {obj.currentValue}/{obj.targetValue}</span>
                      <span>{obj.progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${obj.progressPct >= 70 ? "bg-emerald-500" : obj.progressPct >= 40 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${obj.progressPct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[9px] text-muted-foreground flex-wrap">
                    <span>Week {obj.weekElapsed}/{obj.timelineWeeks}</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">${obj.expectedRevenue.toLocaleString()} projected</span>
                    {obj.agents.length > 0 && <span>Agents: {obj.agents.join(", ")}</span>}
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

// ─── Tab: AI COO ──────────────────────────────────────────────────────────────

function AiCooTab() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<COOAnswer | null>(null);
  const { toast } = useToast();

  const cooMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/execution/coo", { question: q }),
    onSuccess: (data: any) => setAnswer(data.answer),
    onError: () => toast({ title: "AI COO unavailable", variant: "destructive" }),
  });

  const PROMPTS = ["What should I prioritize this week?", "Which initiatives are at risk of failing?", "How do I accelerate growth velocity?", "Where is execution getting stuck?", "What should agents focus on today?"];

  return (
    <div className="space-y-4" data-testid="tab-ai-coo">
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold">AI COO — Executive Operational Intelligence</p>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">Monitors all active objectives, coordinates agents, flags blockers, and provides executive operational guidance.</p>
        <div className="flex gap-2 mb-2">
          <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask your COO anything about business execution..." className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-coo-question" onKeyDown={e => e.key === "Enter" && question.trim() && cooMutation.mutate(question.trim())} />
          <Button size="sm" className="h-9 gap-1.5" disabled={!question.trim() || cooMutation.isPending} onClick={() => cooMutation.mutate(question.trim())} data-testid="button-ask-coo">
            {cooMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Ask
          </Button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {PROMPTS.map(p => (
            <button key={p} onClick={() => { setQuestion(p); cooMutation.mutate(p); }} className="px-2 py-1 rounded-lg bg-background border text-[9px] hover:bg-primary hover:text-primary-foreground transition-colors" data-testid={`coo-prompt-${p.substring(0, 8).replace(/\s+/g, "-").toLowerCase()}`}>{p}</button>
          ))}
        </div>
      </div>

      {cooMutation.isPending && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>}

      {answer && !cooMutation.isPending && (
        <div className="space-y-3" data-testid="coo-response">
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Analysis</p>
            <p className="text-xs leading-relaxed">{answer.analysis}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${answer.confidence}%` }} /></div>
              <span className="text-[9px] text-muted-foreground">{answer.confidence}% confidence</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-rose-500/5 border-b flex items-center gap-1.5"><Zap className="h-3 w-3 text-primary" /><span className="text-xs font-semibold">Immediate Actions</span></div>
              <div className="divide-y">
                {(answer.immediateActions ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5">
                    <span className="text-[9px] font-bold text-primary w-3 shrink-0">{i + 1}.</span>
                    <p className="text-xs">{a}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 bg-blue-500/5 border-b flex items-center gap-1.5"><Bot className="h-3 w-3 text-blue-600 dark:text-blue-400" /><span className="text-xs font-semibold">Agent Coordination</span></div>
              <div className="divide-y">
                {(answer.agentCoordination ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5">
                    <ChevronRight className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs">{a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(answer.blockers ?? []).length > 0 && (
            <div className="p-3.5 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />Blockers</p>
              {answer.blockers.map((b, i) => <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{b}</p>)}
            </div>
          )}

          <div className="p-3.5 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900">
            <p className="text-xs font-semibold mb-1 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-emerald-500" />Forecast Update</p>
            <p className="text-xs text-muted-foreground">{answer.forecastUpdate}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Growth Velocity ─────────────────────────────────────────────────────

function GrowthVelocityTab() {
  const { data, isLoading } = useQuery<GrowthData>({ queryKey: ["/api/execution/growth-velocity"], staleTime: 60_000 });
  const velColor = (data?.velocity ?? 0) >= 80 ? "text-emerald-600 dark:text-emerald-400" : (data?.velocity ?? 0) >= 60 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-growth-velocity">
      {!isLoading && data && (
        <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
          <div className="text-center shrink-0">
            <p className={`text-5xl font-extrabold ${velColor}`}>{data.velocity}<span className="text-lg">/100</span></p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Growth Velocity</p>
            <p className={`text-[10px] font-bold mt-0.5 ${velColor}`}>{data.velocityLabel}</p>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: "Trend",       value: data.trend === "up" ? "↑ Increasing" : data.trend === "down" ? "↓ Declining" : "→ Stable", color: data.trend === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground" },
              { label: "Forecast (30d)", value: `${data.forecastVelocity}/100`,                   color: "text-primary" },
              { label: "Weekly Δ",    value: `+${data.weeklyChange}%`,                            color: "text-emerald-600 dark:text-emerald-400" },
            ].map(m => (
              <div key={m.label} className="p-2.5 rounded-lg bg-background border text-center">
                <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Velocity Components</h3></div>
          <div className="divide-y">
            {(data?.components ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`velocity-comp-${i}`}>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{c.metric}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">{c.weight} weight</span>
                      <span className={`text-[10px] font-bold ${c.score >= 70 ? "text-emerald-600 dark:text-emerald-400" : c.score >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{c.score}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${c.score >= 70 ? "bg-emerald-500" : c.score >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${c.score}%` }} />
                  </div>
                </div>
                <span className={`text-[9px] font-medium shrink-0 ${c.trend === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{c.trend === "up" ? "↑" : "→"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Deployments ─────────────────────────────────────────────────────────

function DeploymentsTab() {
  const { data, isLoading } = useQuery<WorkflowsData>({ queryKey: ["/api/execution/workflows"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "start" | "pause" | "cancel" }) =>
      apiRequest("POST", `/api/execution/workflows/${id}/${action}`, {}),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/execution/workflows"] });
      toast({ title: `Workflow ${vars.action}ed` });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = (data?.workflows ?? []).filter(w => statusFilter === "all" || w.status === statusFilter);

  return (
    <div className="space-y-4" data-testid="tab-deployments">
      {data && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(data.statusSummary).map(([s, c]) => (
            <div key={s} className="p-2.5 rounded-xl border bg-card text-center cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setStatusFilter(s === statusFilter ? "all" : s)} data-testid={`deployment-stat-${s}`}>
              <p className="text-lg font-extrabold">{c}</p>
              <p className="text-[9px] text-muted-foreground capitalize">{s}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "running", "scheduled", "completed", "draft"].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)} data-testid={`filter-wf-${f}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${statusFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{f}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(wf => (
            <div key={wf.id} className="p-4 rounded-xl border bg-card" data-testid={`workflow-card-${wf.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-sm font-semibold flex-1">{wf.name}</p>
                    <StatusBadge s={wf.status} />
                  </div>
                  {wf.status === "running" && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1">
                        <span>{wf.completedTasks}/{wf.tasks} tasks</span>
                        <span>{Math.round((wf.completedTasks / Math.max(1, wf.tasks)) * 100)}% complete</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((wf.completedTasks / Math.max(1, wf.tasks)) * 100)}%` }} /></div>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-[9px] text-muted-foreground flex-wrap">
                    {wf.owner && <span>Owner: {wf.owner}</span>}
                    {wf.agents.length > 0 && <span>Agents: {wf.agents.join(", ")}</span>}
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">${wf.expectedRevenue.toLocaleString()}</span>
                    {wf.startedAt && <span>Started {formatDistanceToNow(new Date(wf.startedAt), { addSuffix: true })}</span>}
                    {wf.scheduledAt && <span>Scheduled {formatDistanceToNow(new Date(wf.scheduledAt), { addSuffix: true })}</span>}
                    {wf.successScore !== null && <span className="font-bold text-emerald-600 dark:text-emerald-400">Success: {wf.successScore}%</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {wf.status === "draft" && <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => actionMutation.mutate({ id: wf.id, action: "start" })} data-testid={`button-start-${wf.id}`}><Play className="h-3 w-3" /></Button>}
                  {wf.status === "running" && <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => actionMutation.mutate({ id: wf.id, action: "pause" })} data-testid={`button-pause-${wf.id}`}><Pause className="h-3 w-3" /></Button>}
                  {(wf.status === "running" || wf.status === "scheduled") && <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500" onClick={() => actionMutation.mutate({ id: wf.id, action: "cancel" })} data-testid={`button-cancel-${wf.id}`}><XCircle className="h-3 w-3" /></Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Outcomes ────────────────────────────────────────────────────────────

function OutcomesTab() {
  const { data, isLoading } = useQuery<OutcomesData>({ queryKey: ["/api/execution/outcomes"], staleTime: 60_000 });
  const STATUS_ICONS: Record<string, React.ReactNode> = { exceeded: <ArrowUpRight className="h-4 w-4 text-emerald-500" />, partial: <AlertTriangle className="h-4 w-4 text-amber-500" />, missed: <XCircle className="h-4 w-4 text-rose-500" /> };

  return (
    <div className="space-y-4" data-testid="tab-outcomes">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Revenue Delivered", value: `$${(data.totalRevenueDelivered / 1000).toFixed(1)}k`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Avg Success Score",  value: `${data.avgSuccessScore}%`,                            color: "text-primary" },
            { label: "Exceeded",           value: data.exceededCount,                                   color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Partial",            value: data.partialCount,                                    color: "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`outcome-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.outcomes ?? []).map(oc => (
            <div key={oc.id} className="p-4 rounded-xl border bg-card" data-testid={`outcome-${oc.id}`}>
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">{STATUS_ICONS[oc.status] ?? null}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-sm font-semibold flex-1">{oc.deployment}</p>
                    <StatusBadge s={oc.status} />
                    <span className="text-[9px] text-muted-foreground">{formatDistanceToNow(new Date(oc.completedAt), { addSuffix: true })}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    {[
                      { label: "Expected",       value: oc.expectedOutcome },
                      { label: "Actual",          value: oc.actualOutcome, bold: true },
                      { label: "Revenue",         value: `$${oc.actualRevenue.toLocaleString()}`, color: oc.actualRevenue >= oc.expectedRevenue ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
                      { label: "Time Saved",      value: `${oc.timeSavedHours}h`, color: "text-blue-600 dark:text-blue-400" },
                    ].map(m => (
                      <div key={m.label} className="p-2 rounded-lg bg-muted/30">
                        <p className="text-[8px] text-muted-foreground">{m.label}</p>
                        <p className={`text-xs ${(m as any).color ?? ""} ${(m as any).bold ? "font-bold" : ""}`}>{m.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground">Success Score:</span>
                    <ScoreCircle score={oc.successScore} size="sm" />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${oc.successScore >= 80 ? "bg-emerald-500" : oc.successScore >= 60 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${oc.successScore}%` }} /></div>
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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminExecutionCenterPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-execution-center">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/platform-health">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Platform Health
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Autonomous Business Execution Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Deploy strategies, build campaigns, recover revenue, and execute growth objectives — powered by your AI agent team.
          </p>
        </div>
        <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 text-xs px-3 py-1 shrink-0">Layer 11 — Execution</Badge>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup",          href: "/admin/ai-workforce" },
          { label: "Workforce",      href: "/admin/ai-workforce/settings" },
          { label: "Operations",     href: "/admin/ai-operations" },
          { label: "Exec Intel",     href: "/admin/executive-intelligence" },
          { label: "Autonomous",     href: "/admin/autonomous-management" },
          { label: "Trust",          href: "/admin/trust-attribution" },
          { label: "External",       href: "/admin/market-intelligence" },
          { label: "Network",        href: "/admin/network-intelligence" },
          { label: "Revenue",        href: "/admin/billing-intelligence" },
          { label: "Platform",       href: "/admin/platform-health" },
          { label: "Execution",      href: null, active: true },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-execution">
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
        {activeTab === "overview"     && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "recs"         && <RecommendationsTab />}
        {activeTab === "campaign"     && <CampaignBuilderTab />}
        {activeTab === "recovery"     && <RevenueRecoveryTab />}
        {activeTab === "partnerships" && <PartnershipsTab />}
        {activeTab === "objectives"   && <ObjectivesTab />}
        {activeTab === "coo"          && <AiCooTab />}
        {activeTab === "velocity"     && <GrowthVelocityTab />}
        {activeTab === "deployments"  && <DeploymentsTab />}
        {activeTab === "outcomes"     && <OutcomesTab />}
      </div>

      {/* Forward navigation → Ecosystem */}
      <Link href="/admin/ecosystem">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5 hover:from-primary/10 hover:to-blue-500/10 transition-colors cursor-pointer group" data-testid="nav-ecosystem">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Ecosystem, White-Label &amp; Multi-Org Orchestration</p>
            <p className="text-xs text-muted-foreground mt-0.5">Manage franchises, agencies, enterprise hierarchies, template marketplaces, cross-org benchmarking, and full white-label control across thousands of organizations.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
