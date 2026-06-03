import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Settings, ArrowLeft, Shield, Users, Plug, GitBranch,
  CheckCircle, Clock, Zap, Brain, ChevronRight, Edit2,
  AlertCircle, History, RefreshCw, RotateCcw, Calendar,
  Target, MessageSquare, Search, BarChart2, TrendingUp, TrendingDown,
  Cpu, Building2, Mail, Hash, Globe, Star, Save, X,
  Activity, Package, Lightbulb, ShoppingBag, Check, Minus,
  ArrowUp, ArrowDown, Repeat, AlertTriangle, Info, Award,
  ChevronDown, ChevronUp, ExternalLink, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

// ─── Static reference data ─────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: "communications", label: "Communications", icon: MessageSquare, desc: "Email outreach, reply classification, follow-up sequences", agents: ["Relay"] },
  { id: "scheduling",     label: "Scheduling",     icon: Calendar,        desc: "Session booking, reminders, calendar automation",           agents: ["Tempo"] },
  { id: "retention",      label: "Retention",      icon: TrendingUp,      desc: "Client engagement, churn recovery, win-back campaigns",     agents: ["Pulse"] },
  { id: "growth",         label: "Growth / Outreach", icon: Target,       desc: "Lead research, qualification, prospecting campaigns",       agents: ["Apex"] },
  { id: "research",       label: "Research",        icon: Search,          desc: "Decision-maker discovery, web intelligence",                agents: ["Vector"] },
  { id: "executive",      label: "Executive Intelligence", icon: BarChart2, desc: "Business summaries, KPI tracking, strategic insights",    agents: ["Atlas"] },
];

const AGENTS_META: Record<string, { name: string; role: string; dept: string; color: string; initials: string }> = {
  relay_agent:   { name: "Relay",  role: "Communication Specialist",    dept: "communications", color: "bg-blue-500",    initials: "RL" },
  pulse_agent:   { name: "Pulse",  role: "Retention Specialist",         dept: "retention",      color: "bg-emerald-500", initials: "PS" },
  tempo_agent:   { name: "Tempo",  role: "Scheduling Coordinator",       dept: "scheduling",     color: "bg-violet-500",  initials: "TM" },
  apex_agent:    { name: "Apex",   role: "Growth & Outreach Agent",      dept: "growth",         color: "bg-amber-500",   initials: "AX" },
  vector_agent:  { name: "Vector", role: "Research Intelligence Agent",  dept: "research",       color: "bg-pink-500",    initials: "VC" },
  atlas_agent:   { name: "Atlas",  role: "Business Intelligence Agent",  dept: "executive",      color: "bg-slate-600",   initials: "AT" },
};

const GOVERNANCE_LABELS: Record<string, { label: string; badge: string; desc: string }> = {
  supervised:    { label: "Conservative", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",    desc: "All external actions require approval" },
  collaborative: { label: "Balanced",     badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",        desc: "Low-risk runs automatically; high-risk needs approval" },
  autonomous:    { label: "Advanced",     badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", desc: "Agents operate autonomously within configured limits" },
};

const AUTONOMY_LABELS: Record<string, string> = {
  supervised: "Supervised", collaborative: "Collaborative",
  autonomous: "Autonomous", review: "Review Required", blocked: "Blocked",
};

const INTEGRATION_META: Record<string, { label: string; icon: typeof Mail }> = {
  gmail:           { label: "Gmail",                   icon: Mail },
  google_calendar: { label: "Google Calendar",         icon: Calendar },
  slack:           { label: "Slack",                   icon: Hash },
  openrouter:      { label: "AI Models (OpenRouter)",  icon: Brain },
};

const WORKFLOW_TEMPLATE_LABELS: Record<string, string> = {
  "tpl-onboarding":         "Client Onboarding",
  "tpl-retention":          "Retention Campaign",
  "tpl-lead-qualification": "Lead Qualification",
  "tpl-churn-recovery":     "Churn Recovery",
  "tpl-executive-summary":  "Daily Executive Summary",
};

const GOAL_LABELS: Record<string, string> = {
  leads: "Get more leads", retention: "Improve retention",
  scheduling: "Automate scheduling", admin: "Reduce admin work",
  communication: "Improve communication", onboarding: "Streamline athlete onboarding",
  research: "Research opportunities", reporting: "Executive reporting",
};

// ─── Helper components ─────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle, action }: {
  icon: typeof Shield; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <ArrowUp className="h-3 w-3 text-emerald-500" />;
  if (trend === "down") return <ArrowDown className="h-3 w-3 text-rose-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function AgentAvatar({ type, size = "md" }: { type: string; size?: "sm" | "md" }) {
  const meta = AGENTS_META[type];
  const sz = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <div className={`${sz} rounded-lg ${meta?.color ?? "bg-slate-500"} flex items-center justify-center shrink-0 text-white font-bold`}>
      {meta?.initials ?? (type.slice(0, 2).toUpperCase())}
    </div>
  );
}

// ─── Section 1: Workforce Health Score ────────────────────────────────────────

function WorkforceHealthCard({ health }: { health: any }) {
  const score = health?.healthScore ?? 0;
  const isGreen = score >= 90;
  const isYellow = score >= 70 && score < 90;
  const scoreColor = isGreen ? "text-emerald-600 dark:text-emerald-400" : isYellow ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const barColor = isGreen ? "bg-emerald-500" : isYellow ? "bg-amber-500" : "bg-rose-500";
  const statusLabel = isGreen ? "Healthy" : isYellow ? "Attention Needed" : "Critical";

  const metrics = [
    { label: "Agents Online", value: `${health?.activeAgents ?? 0}/${(health?.activeAgents ?? 0) + (health?.disabledAgents ?? 0)}` },
    { label: "Integrations Connected", value: `${health?.integrationsConnected ?? 0}` },
    { label: "Workflows Published", value: `${health?.workflowsPublished ?? 0}` },
    { label: "Actions Today", value: `${health?.actionsToday ?? 0}` },
    { label: "Approvals Pending", value: `${health?.approvalsPending ?? 0}` },
    { label: "Open Alerts", value: `${health?.openAlerts ?? 0}` },
  ];

  return (
    <Card data-testid="section-health-score" className="border-2">
      <CardContent className="pt-5 pb-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Score gauge */}
          <div className="flex flex-col items-center justify-center sm:w-40 shrink-0">
            <div className={`text-5xl font-extrabold leading-none ${scoreColor}`}>{score}</div>
            <div className="text-xs text-muted-foreground mt-1 font-medium">/ 100</div>
            <Badge
              className={`mt-2 text-[10px] font-semibold px-2 py-0.5 ${
                isGreen ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                isYellow ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              }`}
            >
              {statusLabel}
            </Badge>
            <div className="w-full mt-3">
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Workforce Health Score</p>
          </div>
          {/* Metrics grid */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {metrics.map(m => (
              <div key={m.label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-muted/40 border">
                <span className="text-[10px] text-muted-foreground leading-tight">{m.label}</span>
                <span className="text-xl font-bold">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section 2: AI Executive Summary ─────────────────────────────────────────

function ExecutiveSummaryCard({ summary }: { summary: any }) {
  const perf = summary?.workforcePerformance ?? {};
  const rev = summary?.revenueImpact ?? {};

  const kpis = [
    { label: "Actions Completed", value: perf.totalActions ?? 0 },
    { label: "Success Rate", value: `${perf.successRate ?? 0}%` },
    { label: "Active Agents", value: `${perf.activeAgents ?? 0}/${perf.totalAgents ?? 0}` },
    { label: "Revenue Influenced", value: rev.influenced > 0 ? `$${Number(rev.influenced).toLocaleString()}` : "—" },
    { label: "Labor Saved", value: rev.laborSaved > 0 ? `$${Number(rev.laborSaved).toLocaleString()}` : "—" },
    { label: "Hours Saved", value: rev.hoursSaved > 0 ? `${Number(rev.hoursSaved).toFixed(1)}h` : "—" },
  ];

  return (
    <Card data-testid="section-executive-summary">
      <CardHeader className="pb-3">
        <SectionHeader icon={Award} title="AI Executive Summary" subtitle="Last 7 days — workforce performance at a glance" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {kpis.map(k => (
            <div key={k.label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground">{k.label}</span>
              <span className="text-lg font-bold">{k.value}</span>
            </div>
          ))}
        </div>

        {/* Most valuable agent */}
        {summary?.mostValuableAgent && (
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-primary/5">
            <Star className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold">Top Agent: </span>
              <span className="text-xs">{summary.mostValuableAgent.name}</span>
              <span className="text-xs text-muted-foreground ml-1.5">— {summary.mostValuableAgent.highlight}</span>
            </div>
          </div>
        )}

        {/* Top opportunities */}
        {summary?.topOpportunities?.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Top Opportunities</p>
            <div className="space-y-1.5">
              {summary.topOpportunities.map((o: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className="h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <TrendingUp className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="flex-1 truncate">{o.title}</span>
                  {o.potentialValue > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">${Number(o.potentialValue).toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended actions */}
        {summary?.recommendedActions?.length > 0 && (
          <div className="p-3 rounded-lg border-l-4 border-primary bg-primary/5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Recommended Actions</p>
            <ul className="space-y-1">
              {summary.recommendedActions.map((a: string, i: number) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 3: Activity Dashboard ────────────────────────────────────────────

function ActivityDashboardCard({ metrics }: { metrics: any }) {
  const items: any[] = metrics?.metrics ?? [];
  return (
    <Card data-testid="section-activity-dashboard">
      <CardHeader className="pb-3">
        <SectionHeader icon={Activity} title="Workforce Activity Dashboard" subtitle="Last 24 hours — compared to previous 24 hours" />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {items.map((m: any) => (
              <div key={m.key} className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border" data-testid={`metric-${m.key}`}>
                <span className="text-[10px] text-muted-foreground leading-tight">{m.label}</span>
                <div className="flex items-end gap-1.5">
                  <span className="text-2xl font-bold">{m.value}</span>
                  <div className="flex items-center gap-0.5 mb-0.5">
                    <TrendIcon trend={m.trend} />
                    {m.prev !== m.value && (
                      <span className="text-[9px] text-muted-foreground">{m.prev}</span>
                    )}
                  </div>
                </div>
                <span className={`text-[9px] font-medium ${
                  m.trend === "up" ? "text-emerald-600 dark:text-emerald-400" :
                  m.trend === "down" ? "text-rose-600 dark:text-rose-400" :
                  "text-muted-foreground"
                }`}>
                  {m.trend === "up" ? "↑ Up from prev" : m.trend === "down" ? "↓ Down from prev" : "→ Stable"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 4: Agent Org Chart ───────────────────────────────────────────────

function AgentOrgChart({ agents }: { agents: any[] }) {
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const depts = DEPARTMENTS.map(d => ({
    ...d,
    agents: (agents ?? []).filter(a => {
      const meta = AGENTS_META[a.agentType];
      return meta?.dept === d.id;
    }),
  }));

  return (
    <Card data-testid="section-org-chart">
      <CardHeader className="pb-3">
        <SectionHeader icon={Users} title="Agent Organization Chart" subtitle="Live workforce hierarchy — click an agent for details" />
      </CardHeader>
      <CardContent>
        {/* CEO node */}
        <div className="flex justify-center mb-4">
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-11 w-11 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
              <Cpu className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-semibold text-center leading-tight">CEO Heartbeat<br /><span className="text-muted-foreground font-normal">Executive Controller</span></span>
          </div>
        </div>
        {/* Connector line */}
        <div className="flex justify-center mb-3">
          <div className="w-px h-5 bg-border" />
        </div>
        {/* Horizontal branch */}
        <div className="relative">
          <div className="absolute top-0 left-8 right-8 h-px bg-border" />
        </div>
        {/* Agent columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-5">
          {(agents ?? []).map(agent => {
            const meta = AGENTS_META[agent.agentType];
            const dept = DEPARTMENTS.find(d => d.id === meta?.dept);
            return (
              <button
                key={agent.agentType}
                onClick={() => setSelectedAgent(selectedAgent?.agentType === agent.agentType ? null : agent)}
                data-testid={`orgchart-agent-${agent.agentType}`}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all text-center ${
                  selectedAgent?.agentType === agent.agentType
                    ? "border-primary bg-primary/5"
                    : agent.enabled
                    ? "border-border hover:border-primary/40 bg-card"
                    : "border-border/40 bg-muted/20 opacity-50"
                }`}
              >
                <div className={`h-10 w-10 rounded-xl ${meta?.color ?? "bg-slate-500"} flex items-center justify-center text-white text-sm font-bold`}>
                  {meta?.initials ?? "?"}
                </div>
                <div>
                  <p className="text-xs font-semibold leading-tight">{meta?.name ?? agent.agentType}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{dept?.label ?? meta?.dept}</p>
                </div>
                <Badge
                  className={`text-[9px] px-1.5 py-0 h-3.5 ${
                    agent.enabled
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {agent.enabled ? "Active" : "Inactive"}
                </Badge>
              </button>
            );
          })}
        </div>

        {/* Agent detail panel */}
        {selectedAgent && (
          <div className="mt-3 p-3 rounded-lg border bg-muted/20 space-y-2" data-testid="orgchart-agent-detail">
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <AgentAvatar type={selectedAgent.agentType} size="sm" />
                <div>
                  <p className="text-sm font-semibold">{AGENTS_META[selectedAgent.agentType]?.name ?? selectedAgent.name}</p>
                  <p className="text-[10px] text-muted-foreground">{AGENTS_META[selectedAgent.agentType]?.role}</p>
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded bg-card border text-center">
                <p className="text-muted-foreground text-[10px]">Autonomy</p>
                <p className="font-medium capitalize">{AUTONOMY_LABELS[selectedAgent.autonomyMode] ?? selectedAgent.autonomyMode ?? "Default"}</p>
              </div>
              <div className="p-2 rounded bg-card border text-center">
                <p className="text-muted-foreground text-[10px]">Recent Actions</p>
                <p className="font-medium">{selectedAgent.recentActions ?? 0}</p>
              </div>
              <div className="p-2 rounded bg-card border text-center">
                <p className="text-muted-foreground text-[10px]">Approval</p>
                <p className="font-medium">{selectedAgent.requiresApproval ? "Required" : "Auto"}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 5: Approval Queue Widget ─────────────────────────────────────────

function ApprovalQueueCard() {
  const { toast } = useToast();
  const { data: approvals, isLoading } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/ai-approvals/${id}/approve`, {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/health"] });
      toast({ title: "Action approved." });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/ai-approvals/${id}/reject`, {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
      toast({ title: "Action rejected." });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const pendingItems = (approvals ?? []).filter(a => a.status === "pending_approval" || a.status === "pending");
  const pendingCount = pendingItems.length;

  return (
    <Card data-testid="section-approval-queue">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={Clock}
          title="Approval Queue"
          subtitle="Actions awaiting your review"
          action={
            pendingCount > 0 ? (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs font-semibold">
                {pendingCount} pending
              </Badge>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : pendingItems.length === 0 ? (
          <div className="text-center py-6 space-y-1.5" data-testid="text-no-approvals">
            <CheckCircle className="h-6 w-6 mx-auto text-emerald-500 opacity-60" />
            <p className="text-sm text-muted-foreground">No pending approvals</p>
            <p className="text-xs text-muted-foreground">Your agents are operating within approved parameters.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {pendingItems.slice(0, 8).map((item: any) => (
              <div key={item.id} className="p-3 rounded-lg border bg-card space-y-2" data-testid={`approval-item-${item.id}`}>
                <div className="flex items-start gap-2">
                  <div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-tight truncate">
                      {item.subject ?? item.messageType ?? item.actionType ?? "Agent Action"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                      {item.proposedContent ?? item.reasoningSummary ?? "Awaiting review"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => approveMutation.mutate(item.id)}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                    data-testid={`button-approve-${item.id}`}
                  >
                    <Check className="h-3 w-3 mr-1" />Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1 border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-900/20"
                    onClick={() => rejectMutation.mutate(item.id)}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                    data-testid={`button-reject-${item.id}`}
                  >
                    <X className="h-3 w-3 mr-1" />Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {pendingCount > 0 && (
          <div className="mt-3 pt-3 border-t">
            <Link href="/admin/ai-approvals">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 w-full" data-testid="button-view-all-approvals">
                View All Approvals <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 6: Coverage Analysis ─────────────────────────────────────────────

function CoverageAnalysisCard({ coverage }: { coverage: any }) {
  const configured: any[] = coverage?.configured ?? [];
  const missing: any[] = coverage?.missing ?? [];
  const gaps: any[] = coverage?.optimizationGaps ?? [];
  const score = coverage?.coverageScore ?? 0;

  return (
    <Card data-testid="section-coverage-analysis">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={Target}
          title="Workforce Coverage Analysis"
          subtitle="AI-generated gap detection across your workforce"
          action={
            <Badge className={`text-xs font-semibold ${
              score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
              score >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
              "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            }`}>
              {score}% coverage
            </Badge>
          }
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Configured */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Configured</p>
            {configured.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No core agents configured yet</p>
            ) : (
              <div className="space-y-1.5">
                {configured.map(a => (
                  <div key={a.type} className="flex items-center gap-2 text-xs">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground">— {a.dept}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Missing */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Missing</p>
            {missing.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                Full coverage achieved
              </div>
            ) : (
              <div className="space-y-1.5">
                {missing.map(a => (
                  <div key={a.type} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground ml-1">— {a.dept}</span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Optimization suggestions */}
        {gaps.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Optimization Suggestions</p>
            <div className="space-y-1.5">
              {gaps.map((g, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs">{g.message}</span>
                  </div>
                  {g.actionUrl && (
                    <Link href={g.actionUrl}>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0">
                        Fix →
                      </Button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 7: Agent Marketplace ─────────────────────────────────────────────

function AgentMarketplaceCard({ marketplace }: { marketplace: any }) {
  const [activeTab, setActiveTab] = useState<"installed" | "available">("installed");
  const installed: any[] = marketplace?.installed ?? [];
  const available: any[] = marketplace?.available ?? [];

  const riskColor = (r: string) =>
    r === "low" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
    r === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";

  const renderAgent = (agent: any, showInstallBtn = false) => {
    const meta = AGENTS_META[agent.agentType];
    return (
      <div key={agent.agentType} className="p-3 rounded-lg border bg-card space-y-2" data-testid={`marketplace-agent-${agent.agentType}`}>
        <div className="flex items-start gap-2">
          <div className={`h-9 w-9 rounded-lg ${meta?.color ?? "bg-slate-500"} flex items-center justify-center shrink-0 text-white text-xs font-bold`}>
            {meta?.initials ?? agent.name?.slice(0, 2).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{agent.name}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{agent.category}</Badge>
              {agent.enabled !== undefined && (
                <Badge className={`text-[10px] px-1.5 py-0 h-4 ${agent.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                  {agent.enabled ? "Active" : "Inactive"}
                </Badge>
              )}
              <Badge className={`text-[10px] px-1.5 py-0 h-4 ${riskColor(agent.riskLevel)}`}>
                {agent.riskLevel} risk
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {(agent.capabilities ?? []).map((c: string) => (
            <span key={c} className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full">{c}</span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {agent.estimatedImpact}
          </div>
          {showInstallBtn && (
            <Link href="/onboarding/ai-workforce">
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1">
                <Play className="h-3 w-3" />Enable
              </Button>
            </Link>
          )}
        </div>
        {agent.requiredIntegrations?.length > 0 && (
          <p className="text-[9px] text-muted-foreground">
            Requires: {agent.requiredIntegrations.join(", ")}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card data-testid="section-agent-marketplace">
      <CardHeader className="pb-3">
        <SectionHeader icon={ShoppingBag} title="Agent Marketplace" subtitle="Manage your installed agents and explore expansion options" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("installed")}
            data-testid="tab-installed"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "installed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check className="h-3 w-3" />
            Installed ({installed.length})
          </button>
          <button
            onClick={() => setActiveTab("available")}
            data-testid="tab-available"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "available" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Package className="h-3 w-3" />
            Available ({available.length})
          </button>
        </div>

        {activeTab === "installed" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {installed.map(a => renderAgent(a, false))}
          </div>
        )}

        {activeTab === "available" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {available.map(a => renderAgent(a, true))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 8: Executive Insights ────────────────────────────────────────────

function ExecutiveInsightsCard({ insights }: { insights: any }) {
  const items: any[] = insights?.insights ?? [];
  const typeStyles: Record<string, { icon: typeof AlertTriangle; cls: string; badge: string }> = {
    critical: { icon: AlertCircle,    cls: "border-rose-200 bg-rose-50 dark:bg-rose-900/10 dark:border-rose-800",       badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
    warning:  { icon: AlertTriangle,  cls: "border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800",   badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
    success:  { icon: CheckCircle,    cls: "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
    info:     { icon: Info,           cls: "border-blue-200 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-800",       badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  };

  return (
    <Card data-testid="section-executive-insights">
      <CardHeader className="pb-3">
        <SectionHeader icon={Lightbulb} title="Executive Insights" subtitle="AI-generated insights ranked by business impact" />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <Lightbulb className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Insights will appear as your agents become active.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item: any) => {
              const style = typeStyles[item.type] ?? typeStyles.info;
              const Icon = style.icon;
              return (
                <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border ${style.cls}`} data-testid={`insight-${item.id}`}>
                  <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed">{item.message}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge className={`text-[9px] px-1.5 py-0 h-4 ${style.badge}`}>{item.type}</Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{item.impact} impact</Badge>
                    </div>
                  </div>
                  {item.action && item.actionUrl && (
                    <Link href={item.actionUrl}>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 shrink-0">
                        {item.action} <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 9: Workforce Readiness Score ─────────────────────────────────────

function ReadinessScoreCard({ readiness }: { readiness: any }) {
  const percent = readiness?.completionPercent ?? 0;
  const checklist: any[] = readiness?.checklist ?? [];
  const isReady = percent >= 85;

  const statusStyles: Record<string, string> = {
    complete: "text-emerald-600 dark:text-emerald-400",
    in_progress: "text-amber-600 dark:text-amber-400",
    incomplete: "text-muted-foreground",
  };

  return (
    <Card data-testid="section-readiness-score">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={Zap}
          title="Workforce Readiness Score"
          subtitle="Deployment checklist before full autonomous operations"
          action={
            <Badge className={`text-xs font-semibold px-2 py-0.5 ${
              isReady
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            }`}>
              {percent}% ready
            </Badge>
          }
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ready / Not ready banner */}
        <div className={`flex items-center gap-3 p-3 rounded-lg border ${
          isReady
            ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
            : "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800"
        }`}>
          {isReady ? (
            <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-semibold ${isReady ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
              {isReady ? "Ready for Autonomous Operations" : "Action Required Before Full Deployment"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {readiness?.completed ?? 0} of {readiness?.total ?? 0} readiness checks complete
            </p>
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Readiness progress</span>
            <span className="font-semibold">{percent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isReady ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          {checklist.map(item => (
            <div key={item.id} className="flex items-start gap-2.5 py-1.5 border-b last:border-0" data-testid={`readiness-${item.id}`}>
              <div className="mt-0.5">
                {item.status === "complete" ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : item.status === "in_progress" ? (
                  <Clock className="h-4 w-4 text-amber-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground/60" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium ${statusStyles[item.status]}`}>{item.title}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 capitalize">{item.priority}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{item.description}</p>
              </div>
              {item.status !== "complete" && item.actionUrl && (
                <Link href={item.actionUrl}>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 shrink-0">
                    Fix →
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Inline edit: Departments ─────────────────────────────────────────────────

function DepartmentsEdit({ current, onSave, onCancel, isSaving }: {
  current: string[]; onSave: (d: string[]) => void; onCancel: () => void; isSaving: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(current);
  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(d => d !== id) : [...p, id]);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {DEPARTMENTS.map(dept => {
          const active = selected.includes(dept.id);
          return (
            <button key={dept.id} onClick={() => toggle(dept.id)} data-testid={`dept-edit-${dept.id}`}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <dept.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{dept.label}</span>
                  <span className="text-[10px] text-muted-foreground">{dept.agents.join(", ")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-1" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(selected)} disabled={isSaving} data-testid="button-save-departments">
          {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Departments</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>
      </div>
    </div>
  );
}

// ─── Inline edit: Integrations ────────────────────────────────────────────────

function IntegrationsEdit({ current, onSave, onCancel, isSaving }: {
  current: string[]; onSave: (i: string[]) => void; onCancel: () => void; isSaving: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(current);
  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(INTEGRATION_META).map(([id, meta]) => {
          const active = selected.includes(id);
          const Icon = meta.icon;
          return (
            <button key={id} onClick={() => toggle(id)} data-testid={`integration-edit-${id}`}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
              <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium flex-1">{meta.label}</span>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(selected)} disabled={isSaving} data-testid="button-save-integrations">
          {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Integrations</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>
      </div>
    </div>
  );
}

// ─── Agent Card (config section) ──────────────────────────────────────────────

function AgentCard({ agent }: { agent: any }) {
  const meta = AGENTS_META[agent.agentType] ?? {
    name: agent.name ?? agent.agentType, role: agent.role ?? "AI Agent",
    dept: agent.department ?? "—", color: "bg-slate-500",
    initials: (agent.name ?? "?").slice(0, 2).toUpperCase(),
  };
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${agent.enabled ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"}`} data-testid={`agent-card-${agent.agentType}`}>
      <AgentAvatar type={agent.agentType} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{meta.name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{meta.role}</Badge>
          {agent.enabled ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Active</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{DEPARTMENTS.find(d => d.id === meta.dept)?.label ?? meta.dept}</p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" />{AUTONOMY_LABELS[agent.autonomyMode] ?? agent.autonomyMode ?? "Default"}</span>
          {agent.requiresApproval && <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" />Approval required</span>}
          {agent.recentActions > 0 && <span className="text-[10px] text-muted-foreground">{agent.recentActions} recent actions</span>}
          {agent.disabledReason && <span className="text-[10px] text-muted-foreground italic">{agent.disabledReason}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminAiWorkforceSettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editingDepts, setEditingDepts] = useState(false);
  const [editingIntegrations, setEditingIntegrations] = useState(false);

  // Core data
  const { data: settings, isLoading: settingsLoading } = useQuery<any | null>({ queryKey: ["/api/workforce/settings"], staleTime: 30_000 });
  const { data: agents, isLoading: agentsLoading } = useQuery<any[]>({ queryKey: ["/api/workforce/agents"], staleTime: 60_000 });
  const { data: workflows } = useQuery<any[]>({ queryKey: ["/api/workflow-graphs"], staleTime: 60_000 });
  const { data: auditLog, isLoading: auditLoading } = useQuery<any[]>({ queryKey: ["/api/workforce/audit-log"], staleTime: 60_000 });
  const { data: govSettings } = useQuery<any>({ queryKey: ["/api/governance/settings"], staleTime: 60_000 });

  // Phase 2: executive dashboard data
  const { data: health, isLoading: healthLoading } = useQuery<any>({ queryKey: ["/api/workforce/health"], staleTime: 30_000, refetchInterval: 60_000 });
  const { data: execSummary, isLoading: summaryLoading } = useQuery<any>({ queryKey: ["/api/workforce/executive-summary"], staleTime: 60_000 });
  const { data: activityMetrics, isLoading: activityLoading } = useQuery<any>({ queryKey: ["/api/workforce/activity-metrics"], staleTime: 30_000, refetchInterval: 60_000 });
  const { data: coverage, isLoading: coverageLoading } = useQuery<any>({ queryKey: ["/api/workforce/coverage-analysis"], staleTime: 60_000 });
  const { data: marketplace, isLoading: marketplaceLoading } = useQuery<any>({ queryKey: ["/api/workforce/agent-marketplace"], staleTime: 120_000 });
  const { data: insights, isLoading: insightsLoading } = useQuery<any>({ queryKey: ["/api/workforce/insights"], staleTime: 60_000, refetchInterval: 120_000 });
  const { data: readiness, isLoading: readinessLoading } = useQuery<any>({ queryKey: ["/api/workforce/readiness"], staleTime: 60_000 });

  // Redirect to onboarding if unconfigured
  useEffect(() => {
    if (!settingsLoading && settings === null) {
      navigate("/onboarding/ai-workforce", { replace: true });
    }
  }, [settings, settingsLoading, navigate]);

  const saveMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await apiRequest("PUT", "/api/workforce/settings", updates);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/coverage-analysis"] });
      const changed = data.changes?.length ?? 0;
      toast({ title: changed > 0 ? "Workforce updated." : "No changes detected.", description: changed > 0 ? `${data.changes?.join(", ")} updated.` : undefined });
      setEditingDepts(false);
      setEditingIntegrations(false);
    },
    onError: () => toast({ title: "Failed to save changes", variant: "destructive" }),
  });

  if (settingsLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  if (!settings) return null;

  const enabledDepartments: string[] = Array.isArray(settings.enabledDepartments) ? settings.enabledDepartments : [];
  const selectedIntegrations: string[] = Array.isArray(settings.selectedIntegrations) ? settings.selectedIntegrations : [];
  const selectedTemplates: string[] = Array.isArray(settings.selectedWorkflowTemplates) ? settings.selectedWorkflowTemplates : [];
  const goals: string[] = Array.isArray(settings.goals) ? settings.goals : [];
  const govInfo = GOVERNANCE_LABELS[settings.governanceMode] ?? GOVERNANCE_LABELS.collaborative;
  const activeAgents = agents?.filter(a => a.enabled) ?? [];
  const wizardWorkflows = workflows?.filter(w => w.tags?.includes("source:ai_workforce_wizard")) ?? [];
  const lastUpdated = settings.updatedAt ? new Date(settings.updatedAt) : null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto" data-testid="page-workforce-settings">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/ai-workforce">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />AI Workforce
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            AI Workforce Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Executive operating center — visibility, governance, performance, and workforce optimization.
            {lastUpdated && <span className="ml-1.5 text-xs">Config updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-operations">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" data-testid="button-ai-operations">
              <Activity className="h-3.5 w-3.5" />Live Operations
            </Button>
          </Link>
          <Link href="/onboarding/ai-workforce">
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground h-8 text-xs" data-testid="button-rerun-wizard">
              <RotateCcw className="h-3.5 w-3.5" />Rerun Wizard
            </Button>
          </Link>
        </div>
      </div>

      {/* ── 1. Workforce Health Score ───────────────────────────────────────── */}
      {healthLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <WorkforceHealthCard health={health} />
      )}

      {/* ── 2. AI Executive Summary ────────────────────────────────────────── */}
      {summaryLoading ? (
        <Skeleton className="h-52 rounded-xl" />
      ) : (
        <ExecutiveSummaryCard summary={execSummary} />
      )}

      {/* ── 3. Activity Dashboard ─────────────────────────────────────────── */}
      <ActivityDashboardCard metrics={activityMetrics} />

      {/* ── 4 & 5. Org Chart + Approval Queue ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agentsLoading ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : (
          <AgentOrgChart agents={agents ?? []} />
        )}
        <ApprovalQueueCard />
      </div>

      {/* ── 6. Coverage Analysis ──────────────────────────────────────────── */}
      {coverageLoading ? (
        <Skeleton className="h-52 rounded-xl" />
      ) : (
        <CoverageAnalysisCard coverage={coverage} />
      )}

      {/* ── 7. Agent Marketplace ──────────────────────────────────────────── */}
      {marketplaceLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <AgentMarketplaceCard marketplace={marketplace} />
      )}

      {/* ── 8. Executive Insights ─────────────────────────────────────────── */}
      {insightsLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <ExecutiveInsightsCard insights={insights} />
      )}

      {/* ── 9. Readiness Score ────────────────────────────────────────────── */}
      {readinessLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <ReadinessScoreCard readiness={readiness} />
      )}

      <Separator />
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Configuration</p>

      {/* ── Overview snapshot ─────────────────────────────────────────────── */}
      <Card data-testid="section-overview">
        <CardHeader className="pb-3">
          <SectionHeader icon={Star} title="Workforce Overview" subtitle="Current configuration snapshot" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Governance</span>
              <Badge className={`w-fit text-xs font-semibold px-2 py-0.5 ${govInfo.badge}`}>{govInfo.label}</Badge>
              <span className="text-[10px] text-muted-foreground leading-tight">{govInfo.desc}</span>
            </div>
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Departments</span>
              <span className="text-2xl font-bold">{enabledDepartments.length}</span>
              <span className="text-[10px] text-muted-foreground">of {DEPARTMENTS.length} active</span>
            </div>
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Agents</span>
              {agentsLoading ? <Skeleton className="h-7 w-10" /> : (
                <><span className="text-2xl font-bold">{activeAgents.length}</span><span className="text-[10px] text-muted-foreground">of {agents?.length ?? 0} enabled</span></>
              )}
            </div>
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Workflows</span>
              <span className="text-2xl font-bold">{wizardWorkflows.length}</span>
              <span className="text-[10px] text-muted-foreground">from setup</span>
            </div>
          </div>
          {goals.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Business Goals</p>
              <div className="flex flex-wrap gap-1.5">
                {goals.map(g => <Badge key={g} variant="secondary" className="text-xs">{GOAL_LABELS[g] ?? g}</Badge>)}
              </div>
            </div>
          )}
          {settings.orgPreset && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Org type: <span className="font-medium text-foreground capitalize">{settings.orgPreset.replace(/_/g, " ")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Agents config ─────────────────────────────────────────────────── */}
      <Card data-testid="section-agents">
        <CardHeader className="pb-3">
          <SectionHeader icon={Brain} title="Active Agents" subtitle="Agents enabled for your organization"
            action={<Link href="/admin/ai-workforce/capabilities"><Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-agents"><Edit2 className="h-3.5 w-3.5" />Edit Agents<ChevronRight className="h-3.5 w-3.5" /></Button></Link>}
          />
        </CardHeader>
        <CardContent>
          {agentsLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : !agents?.length ? (
            <div className="text-center py-6 text-sm text-muted-foreground"><Brain className="h-6 w-6 mx-auto mb-2 opacity-40" />No agents configured yet.</div>
          ) : (
            <div className="space-y-2">{agents.map(agent => <AgentCard key={agent.agentType} agent={agent} />)}</div>
          )}
        </CardContent>
      </Card>

      {/* ── Departments ──────────────────────────────────────────────────── */}
      <Card data-testid="section-departments">
        <CardHeader className="pb-3">
          <SectionHeader icon={Users} title="Departments" subtitle="AI departments included in your workforce"
            action={!editingDepts ? <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setEditingDepts(true)} data-testid="button-edit-departments"><Edit2 className="h-3.5 w-3.5" />Edit Departments</Button> : null}
          />
        </CardHeader>
        <CardContent>
          {editingDepts ? (
            <DepartmentsEdit current={enabledDepartments} onSave={depts => saveMutation.mutate({ enabledDepartments: depts })} onCancel={() => setEditingDepts(false)} isSaving={saveMutation.isPending} />
          ) : (
            <div className="space-y-2">
              {DEPARTMENTS.map(dept => {
                const active = enabledDepartments.includes(dept.id);
                return (
                  <div key={dept.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${active ? "border-border bg-card" : "border-border/40 bg-muted/20 opacity-50"}`} data-testid={`dept-row-${dept.id}`}>
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary/10" : "bg-muted"}`}>
                      <dept.icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{dept.label}</span>
                        {active ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Active</Badge> : <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>}
                        <span className="text-[10px] text-muted-foreground">Agents: {dept.agents.join(", ")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Governance ───────────────────────────────────────────────────── */}
      <Card data-testid="section-governance">
        <CardHeader className="pb-3">
          <SectionHeader icon={Shield} title="Governance" subtitle="Approval rules and autonomy settings"
            action={<Link href="/admin/ai-governance"><Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-governance"><Edit2 className="h-3.5 w-3.5" />Edit Governance<ChevronRight className="h-3.5 w-3.5" /></Button></Link>}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`flex items-start gap-3 p-3 rounded-lg border-2 ${settings.governanceMode === "supervised" ? "border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800" : settings.governanceMode === "autonomous" ? "border-violet-300 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800" : "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800"}`}>
            <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{govInfo.label} Mode</span>
                <Badge className={`text-xs ${govInfo.badge}`}>{settings.governanceMode}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{govInfo.desc}</p>
            </div>
          </div>
          {govSettings && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { label: "Autonomous comms", value: govSettings.allowAutonomousCommunication },
                { label: "Autonomous scheduling", value: govSettings.allowAutonomousScheduling },
                { label: "Financial actions", value: govSettings.allowAutonomousFinancialActions },
                { label: "Web research", value: govSettings.allowExternalWebAccess },
                { label: "Cross-workflow memory", value: govSettings.allowCrossWorkflowMemory },
                { label: "Operator review", value: govSettings.operatorReviewRequired },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border text-xs">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${item.value ? "bg-emerald-500" : "bg-rose-400"}`} />
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          )}
          {govSettings?.emergencyPauseEnabled && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
              <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Emergency Pause Active</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Integrations ─────────────────────────────────────────────────── */}
      <Card data-testid="section-integrations">
        <CardHeader className="pb-3">
          <SectionHeader icon={Plug} title="Integrations" subtitle="Tools connected to your AI workforce"
            action={!editingIntegrations ? <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setEditingIntegrations(true)} data-testid="button-edit-integrations"><Edit2 className="h-3.5 w-3.5" />Edit Integrations</Button> : null}
          />
        </CardHeader>
        <CardContent>
          {editingIntegrations ? (
            <IntegrationsEdit current={selectedIntegrations} onSave={integrations => saveMutation.mutate({ selectedIntegrations: integrations })} onCancel={() => setEditingIntegrations(false)} isSaving={saveMutation.isPending} />
          ) : selectedIntegrations.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              <Plug className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No integrations selected.
              <button onClick={() => setEditingIntegrations(true)} className="text-primary hover:underline ml-1">Add one →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedIntegrations.map(id => {
                const meta = INTEGRATION_META[id]; if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <div key={id} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`integration-row-${id}`}>
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-primary" /></div>
                    <div className="flex-1 min-w-0"><span className="text-sm font-medium">{meta.label}</span></div>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] px-1.5 py-0 h-4">Pending setup</Badge>
                  </div>
                );
              })}
            </div>
          )}
          {selectedIntegrations.length > 0 && !editingIntegrations && (
            <p className="text-[10px] text-muted-foreground mt-2">Connect integrations in <Link href="/admin/integrations" className="text-primary hover:underline">Integration settings</Link>.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Workflows & Automations ───────────────────────────────────────── */}
      <Card data-testid="section-workflows">
        <CardHeader className="pb-3">
          <SectionHeader icon={GitBranch} title="Workflows & Automations" subtitle="Starter workflows created from your setup"
            action={<Link href="/admin/workflow-builder"><Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-automations"><Edit2 className="h-3.5 w-3.5" />Edit Automations<ChevronRight className="h-3.5 w-3.5" /></Button></Link>}
          />
        </CardHeader>
        <CardContent>
          {selectedTemplates.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Selected Templates</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedTemplates.map(id => <Badge key={id} variant="secondary" className="text-xs"><GitBranch className="h-3 w-3 mr-1" />{WORKFLOW_TEMPLATE_LABELS[id] ?? id}</Badge>)}
              </div>
            </div>
          )}
          {wizardWorkflows.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              <GitBranch className="h-6 w-6 mx-auto mb-2 opacity-40" />No starter workflows created yet.
            </div>
          ) : (
            <div className="space-y-2">
              {wizardWorkflows.map(wf => (
                <div key={wf.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`workflow-row-${wf.id}`}>
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><GitBranch className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{wf.name}</p>
                    {wf.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{wf.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {wf.published ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Live</Badge> : <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Draft</Badge>}
                    <Link href={`/admin/workflows/${wf.id}/live`}><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><ChevronRight className="h-3.5 w-3.5" /></Button></Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Change History ────────────────────────────────────────────────── */}
      <div data-testid="section-audit-trail">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Change History</h2>
          <Badge variant="secondary" className="text-[10px]">{auditLog?.length ?? 0}</Badge>
        </div>
        {auditLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : !auditLog?.length ? (
          <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-lg" data-testid="text-no-audit">
            <History className="h-6 w-6 mx-auto mb-2 opacity-40" />No configuration changes recorded yet.
          </div>
        ) : (
          <Card>
            <CardContent className="pt-4 divide-y">
              {auditLog.slice(0, 10).map(entry => (
                <div key={entry.id} className="flex gap-3 py-2.5" data-testid={`audit-entry-${entry.id}`}>
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <History className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium capitalize">{(entry.eventType ?? "").replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-muted-foreground">{entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) : ""}</span>
                      {entry.changedBy && <span className="text-[10px] text-muted-foreground">by {entry.changedBy}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <Separator />
      <div className="flex items-center justify-between gap-4 py-2">
        <div>
          <p className="text-sm font-semibold">Rerun Setup Wizard</p>
          <p className="text-xs text-muted-foreground">Go through the full setup flow again. Your existing configuration will be updated, not replaced.</p>
        </div>
        <Link href="/onboarding/ai-workforce">
          <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20" data-testid="button-rerun-wizard-danger">
            <RotateCcw className="h-3.5 w-3.5" />Rerun Wizard
          </Button>
        </Link>
      </div>
    </div>
  );
}
