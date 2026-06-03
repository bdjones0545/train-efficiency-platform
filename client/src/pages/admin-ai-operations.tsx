import { useState, useEffect, useRef } from "react";
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
  Activity, Brain, Clock, CheckCircle, XCircle, AlertCircle,
  ArrowLeft, RefreshCw, CircleDot, TrendingUp, GitBranch, Users,
  Mail, Calendar, Search, FileText, ChevronRight, ChevronDown, X,
  Play, Pause, RotateCcw, StopCircle, Zap, Radio, Eye,
  BarChart3, Shield, DollarSign, MessageSquare, Target, Cpu,
  AlertTriangle, Filter, Check, Layers, Timer, Award, Crosshair,
  BrainCircuit, SlidersHorizontal, SkipForward, Ban,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Static agent metadata ─────────────────────────────────────────────────────

const AGENT_META: Record<string, { name: string; dept: string; color: string; initials: string }> = {
  relay_agent:   { name: "Relay",  dept: "Communications",       color: "bg-blue-500",    initials: "RL" },
  pulse_agent:   { name: "Pulse",  dept: "Client Success",       color: "bg-emerald-500", initials: "PS" },
  tempo_agent:   { name: "Tempo",  dept: "Scheduling",           color: "bg-violet-500",  initials: "TM" },
  apex_agent:    { name: "Apex",   dept: "Revenue",              color: "bg-amber-500",   initials: "AX" },
  vector_agent:  { name: "Vector", dept: "Research",             color: "bg-pink-500",    initials: "VC" },
  atlas_agent:   { name: "Atlas",  dept: "Executive Intelligence",color: "bg-slate-600",   initials: "AT" },
  ceo_heartbeat: { name: "CEO Heartbeat", dept: "Executive",     color: "bg-primary",     initials: "CH" },
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string; pulse?: boolean }> = {
  running:           { icon: CircleDot,    color: "text-blue-500",    bg: "bg-blue-500/10",    label: "Running",    pulse: true },
  active:            { icon: CircleDot,    color: "text-blue-500",    bg: "bg-blue-500/10",    label: "Active",     pulse: true },
  completed:         { icon: CheckCircle,  color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Completed" },
  success:           { icon: CheckCircle,  color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Completed" },
  failed:            { icon: XCircle,      color: "text-rose-500",    bg: "bg-rose-500/10",    label: "Failed" },
  error:             { icon: XCircle,      color: "text-rose-500",    bg: "bg-rose-500/10",    label: "Error" },
  pending:           { icon: Clock,        color: "text-amber-500",   bg: "bg-amber-500/10",   label: "Pending" },
  pending_approval:  { icon: Clock,        color: "text-amber-500",   bg: "bg-amber-500/10",   label: "Needs Approval" },
  queued:            { icon: Timer,        color: "text-slate-500",   bg: "bg-slate-500/10",   label: "Queued" },
  idle:              { icon: Timer,        color: "text-slate-400",   bg: "bg-slate-400/10",   label: "Idle" },
  paused:            { icon: Pause,        color: "text-orange-500",  bg: "bg-orange-500/10",  label: "Paused" },
};

const TABS = [
  { id: "feed",       label: "Live Feed",    icon: Activity },
  { id: "agents",     label: "Agents",       icon: Brain },
  { id: "workflows",  label: "Workflows",    icon: GitBranch },
  { id: "revenue",    label: "Revenue",      icon: DollarSign },
  { id: "approvals",  label: "Approvals",    icon: Clock },
  { id: "analytics",  label: "Analytics",    icon: BarChart3 },
  { id: "memory",     label: "Memory",       icon: BrainCircuit },
  { id: "controls",   label: "CEO Controls", icon: SlidersHorizontal },
  { id: "timeline",   label: "Timeline",     icon: Layers },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Shared helper components ──────────────────────────────────────────────────

function AgentChip({ agentType, size = "sm" }: { agentType: string; size?: "sm" | "xs" }) {
  const m = AGENT_META[agentType];
  const sz = size === "xs" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[10px]";
  return (
    <div className={`${sz} ${m?.color ?? "bg-slate-500"} rounded-md flex items-center justify-center text-white font-bold shrink-0`}>
      {m?.initials ?? agentType.slice(0, 2).toUpperCase()}
    </div>
  );
}

function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "xs" }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.color} ${cfg.bg}`}>
      {cfg.pulse ? (
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.color.replace("text-", "bg-")}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.color.replace("text-", "bg-")}`} />
        </span>
      ) : (
        <Icon className="h-2.5 w-2.5" />
      )}
      {cfg.label}
    </span>
  );
}

// ─── Mission Control Strip ─────────────────────────────────────────────────────

function MissionControlStrip() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/ops/mission-control"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const kpis = [
    { label: "Active Agents",       value: data?.activeAgents ?? 0,       icon: Brain,      color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-500/10",   accent: "border-blue-500/20" },
    { label: "Workflows Running",   value: data?.workflowsRunning ?? 0,   icon: GitBranch,  color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", accent: "border-violet-500/20" },
    { label: "Approvals Pending",   value: data?.approvalsPending ?? 0,   icon: Clock,      color: data?.approvalsPending > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400", bg: data?.approvalsPending > 0 ? "bg-amber-500/10" : "bg-emerald-500/10", accent: "border-amber-500/20" },
    { label: "Revenue Opps Open",   value: data?.revenueOppsOpen ?? 0,   icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", accent: "border-emerald-500/20" },
    { label: "Meetings Today",      value: data?.meetingsToday ?? 0,      icon: Calendar,   color: "text-sky-600 dark:text-sky-400",      bg: "bg-sky-500/10",    accent: "border-sky-500/20" },
    { label: "Tasks Completed",     value: data?.tasksToday ?? 0,        icon: CheckCircle,color: "text-green-600 dark:text-green-400",   bg: "bg-green-500/10",  accent: "border-green-500/20" },
  ];

  return (
    <div className="bg-card border rounded-xl p-4" data-testid="section-mission-control">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Crosshair className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Executive Mission Control</h2>
            <p className="text-[10px] text-muted-foreground">
              Live operations snapshot
              {data?.lastUpdated && ` · Updated ${formatDistanceToNow(new Date(data.lastUpdated), { addSuffix: true })}`}
            </p>
          </div>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 w-7 p-0"
          data-testid="button-refresh-mission"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className={`flex flex-col gap-1 p-3 rounded-lg border ${kpi.accent} ${kpi.bg}`} data-testid={`mission-kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${kpi.color}`} />
                <span className="text-[10px] text-muted-foreground leading-tight">{kpi.label}</span>
              </div>
              {isLoading ? <Skeleton className="h-7 w-10" /> : (
                <span className={`text-2xl font-extrabold ${kpi.color}`}>{kpi.value}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab 1: Live Operations Feed ───────────────────────────────────────────────

function LiveFeedTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selectedAction, setSelectedAction] = useState<any | null>(null);

  const { data: feed, isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ["/api/workforce/activity", statusFilter, agentFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (agentFilter !== "all") params.set("agent", agentFilter);
      const r = await fetch(`/api/workforce/activity?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: decision, isLoading: decisionLoading } = useQuery<any>({
    queryKey: ["/api/ops/agent-decision", selectedAction?.id],
    queryFn: async () => {
      const r = await fetch(`/api/ops/agent-decision/${selectedAction.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!selectedAction,
  });

  const STATUS_FILTERS = ["all", "running", "completed", "failed", "pending"];

  const actionLabel = (type: string) =>
    (type ?? "action").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="space-y-3" data-testid="tab-live-feed">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              data-testid={`filter-status-${s}`}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All Activity" : s}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap ml-auto">
          {Object.entries(AGENT_META).map(([type, m]) => (
            <button
              key={type}
              onClick={() => setAgentFilter(agentFilter === type ? "all" : type)}
              data-testid={`filter-agent-${type}`}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                agentFilter === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-3 w-3 rounded-sm ${m.color} flex items-center justify-center text-[7px] text-white font-bold`}>{m.initials}</span>
              {m.name}
            </button>
          ))}
        </div>
        <Button
          variant="ghost" size="sm" className="h-7 w-7 p-0 ml-1"
          onClick={() => refetch()} disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Feed list */}
        <div className={`space-y-1.5 ${selectedAction ? "lg:col-span-2" : "lg:col-span-3"}`}>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
          ) : !feed?.length ? (
            <div className="text-center py-12 text-sm text-muted-foreground border-2 border-dashed rounded-xl">
              <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No activity matching current filters.
            </div>
          ) : (
            feed.map((item: any) => {
              const meta = AGENT_META[item.agentType ?? item.actorType];
              const isSelected = selectedAction?.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedAction(isSelected ? null : item)}
                  data-testid={`feed-item-${item.id}`}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all hover:border-primary/40 ${
                    isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  <AgentChip agentType={item.agentType ?? item.actorType ?? ""} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{meta?.name ?? item.agentName ?? "Agent"}</span>
                      <span className="text-xs text-muted-foreground truncate">{actionLabel(item.actionType)}</span>
                    </div>
                    {item.reasoningSummary && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{item.reasoningSummary}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={item.status} />
                    <span className="text-[9px] text-muted-foreground">
                      {item.timestamp ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }) : ""}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Decision detail panel */}
        {selectedAction && (
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Action Detail</span>
                  <button onClick={() => setSelectedAction(null)}>
                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
                {decisionLoading ? (
                  <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
                ) : decision ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AgentChip agentType={decision.agentType ?? ""} size="sm" />
                      <div>
                        <p className="text-xs font-semibold">{decision.agentName}</p>
                        <p className="text-[10px] text-muted-foreground">{decision.department}</p>
                      </div>
                    </div>
                    <Separator />
                    {[
                      { label: "Decision", value: actionLabel(decision.decision) },
                      { label: "Reason", value: decision.reason },
                      { label: "Rule", value: decision.rule },
                      { label: "Risk Level", value: decision.riskLevel ?? "unknown" },
                      { label: "Outcome", value: decision.outcome },
                    ].map(row => (
                      <div key={row.label}>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{row.label}</p>
                        <p className="text-xs mt-0.5">{row.value}</p>
                      </div>
                    ))}
                    {decision.confidence != null && (
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Confidence</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${decision.confidence >= 80 ? "bg-emerald-500" : decision.confidence >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                              style={{ width: `${decision.confidence}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold">{decision.confidence}%</span>
                        </div>
                      </div>
                    )}
                    {decision.toolsUsed?.length > 0 && (
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Tools Used</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {decision.toolsUsed.map((t: string) => (
                            <span key={t} className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <StatusBadge status={decision.status} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Decision details not available for this action.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Active Agent Monitor ───────────────────────────────────────────────

function AgentsTab() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const { data: agents, isLoading } = useQuery<any[]>({ queryKey: ["/api/workforce/agents"], staleTime: 30_000, refetchInterval: 30_000 });
  const { data: scorecard } = useQuery<any>({ queryKey: ["/api/workforce/scorecard"], staleTime: 60_000 });

  const agentBreakdown: Record<string, any> = {};
  (scorecard?.agentBreakdown ?? []).forEach((a: any) => { agentBreakdown[a.agentType] = a; });

  return (
    <div className="space-y-3" data-testid="tab-agents">
      {isLoading ? (
        Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
      ) : !agents?.length ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
          <Brain className="h-6 w-6 mx-auto mb-2 opacity-40" />No agents configured.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {agents.map((agent: any) => {
            const meta = AGENT_META[agent.agentType];
            const breakdown = agentBreakdown[agent.agentType];
            const status = agent.enabled ? (breakdown?.actions > 0 ? "active" : "idle") : "paused";
            const successRate = breakdown && breakdown.actions > 0
              ? Math.round(((breakdown.actions - breakdown.errors) / breakdown.actions) * 100)
              : 0;
            const expanded = expandedAgent === agent.agentType;
            return (
              <div key={agent.agentType} className="rounded-xl border bg-card overflow-hidden" data-testid={`agent-monitor-${agent.agentType}`}>
                <button
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedAgent(expanded ? null : agent.agentType)}
                >
                  <div className={`h-10 w-10 rounded-xl ${meta?.color ?? "bg-slate-500"} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {meta?.initials ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{meta?.name ?? agent.agentType}</span>
                      <StatusBadge status={status} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{meta?.dept}</p>
                    {breakdown && (
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground">{breakdown.actions ?? 0} actions</span>
                        {breakdown.actions > 0 && (
                          <span className={`text-[10px] font-medium ${successRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : successRate >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {successRate}% success
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t bg-muted/20 space-y-3">
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: "Autonomy", value: agent.autonomyMode ?? "Default" },
                        { label: "Approval", value: agent.requiresApproval ? "Required" : "Auto" },
                        { label: "Recent Actions", value: agent.recentActions ?? 0 },
                      ].map(m => (
                        <div key={m.label} className="p-2 rounded-lg bg-card border text-center">
                          <p className="text-[9px] text-muted-foreground uppercase">{m.label}</p>
                          <p className="text-xs font-semibold mt-0.5 capitalize">{m.value}</p>
                        </div>
                      ))}
                    </div>
                    {breakdown && (
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Success rate</span>
                          <span className="font-semibold">{successRate}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${successRate >= 80 ? "bg-emerald-500" : successRate >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {agent.disabledReason && (
                      <p className="text-[10px] text-muted-foreground italic">{agent.disabledReason}</p>
                    )}
                    <Link href="/admin/ai-workforce/capabilities">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full">
                        Configure Agent <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
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

// ─── Tab 3: Workflow Execution Center ─────────────────────────────────────────

function WorkflowsTab() {
  const { toast } = useToast();
  const { data: stats } = useQuery<any>({ queryKey: ["/api/job-queue/stats"], staleTime: 15_000, refetchInterval: 15_000 });
  const { data: jobs, isLoading, refetch } = useQuery<any[]>({ queryKey: ["/api/job-queue/jobs"], staleTime: 15_000, refetchInterval: 15_000 });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("POST", `/api/job-queue/${id}/cancel`, {}); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/job-queue/jobs"] }); toast({ title: "Workflow cancelled." }); },
    onError: () => toast({ title: "Failed to cancel", variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("POST", `/api/job-queue/dead-letter/${id}/retry`, {}); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/job-queue/jobs"] }); toast({ title: "Workflow queued for retry." }); },
    onError: () => toast({ title: "Failed to retry", variant: "destructive" }),
  });

  const queueStats = [
    { label: "Queued",    value: stats?.queued ?? 0,      color: "text-blue-600 dark:text-blue-400" },
    { label: "Running",   value: stats?.running ?? 0,     color: "text-violet-600 dark:text-violet-400" },
    { label: "Retrying",  value: stats?.retrying ?? 0,    color: "text-amber-600 dark:text-amber-400" },
    { label: "Stuck",     value: stats?.stuck ?? 0,       color: "text-rose-600 dark:text-rose-400" },
    { label: "Dead Letter", value: stats?.dead_letter ?? 0, color: "text-slate-600 dark:text-slate-400" },
  ];

  return (
    <div className="space-y-4" data-testid="tab-workflows">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {queueStats.map(s => (
          <div key={s.label} className="flex flex-col gap-0.5 p-3 rounded-lg border bg-card">
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
            <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Workflow Queue</h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : !jobs?.length ? (
        <div className="text-center py-10 text-sm text-muted-foreground border-2 border-dashed rounded-xl">
          <GitBranch className="h-6 w-6 mx-auto mb-2 opacity-40" />No workflows in queue.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.slice(0, 20).map((job: any) => {
            const isActive = job.status === "running" || job.status === "queued";
            return (
              <div key={job.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`workflow-job-${job.id}`}>
                <StatusBadge status={job.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{job.displayName ?? job.workflowType ?? "Workflow"}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {job.workflowTemplateKey && <span className="mr-2 font-mono">{job.workflowTemplateKey}</span>}
                    {job.createdAt ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true }) : ""}
                  </p>
                  {job.failureReason && <p className="text-[10px] text-rose-500 mt-0.5 truncate">{job.failureReason}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {isActive && (
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-xs gap-1 border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400"
                      onClick={() => cancelMutation.mutate(job.id)}
                      disabled={cancelMutation.isPending}
                      data-testid={`button-cancel-workflow-${job.id}`}
                    >
                      <StopCircle className="h-3 w-3" />Cancel
                    </Button>
                  )}
                  {job.status === "failed" && (
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => retryMutation.mutate(job.id)}
                      disabled={retryMutation.isPending}
                      data-testid={`button-retry-workflow-${job.id}`}
                    >
                      <RotateCcw className="h-3 w-3" />Retry
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

// ─── Tab 4: Revenue Operations Center ─────────────────────────────────────────

function RevenueTab() {
  const { data: opps, isLoading } = useQuery<any[]>({ queryKey: ["/api/workforce/opportunities"], staleTime: 60_000 });
  const { data: attr } = useQuery<any>({ queryKey: ["/api/workforce/revenue-attribution"], staleTime: 60_000 });

  const probColor = (p: number) => p >= 70 ? "text-emerald-600 dark:text-emerald-400" : p >= 40 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

  return (
    <div className="space-y-4" data-testid="tab-revenue">
      {/* Attribution summary */}
      {attr && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Revenue Generated",  value: `$${Number(attr.totalRevenueGenerated ?? 0).toLocaleString()}`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Revenue Influenced", value: `$${Number(attr.totalRevenueInfluenced ?? 0).toLocaleString()}`, color: "text-blue-600 dark:text-blue-400" },
            { label: "Revenue Recovered",  value: `$${Number(attr.totalRevenueRecovered ?? 0).toLocaleString()}`, color: "text-violet-600 dark:text-violet-400" },
            { label: "Labor Saved",        value: `$${Number(attr.totalEstimatedLaborSavings ?? 0).toLocaleString()}`, color: "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="flex flex-col gap-0.5 p-3 rounded-lg border bg-card">
              <span className="text-[10px] text-muted-foreground">{m.label}</span>
              <span className={`text-lg font-bold ${m.color}`}>{m.value}</span>
            </div>
          ))}
        </div>
      )}

      <h3 className="text-sm font-semibold">Revenue Opportunities</h3>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : !opps?.length ? (
        <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
          <TrendingUp className="h-6 w-6 mx-auto mb-2 opacity-40" />No open revenue opportunities right now.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Opportunity", "Est. Value", "Agent Owner", "Status", "Probability", "Next Action"].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opps.map((opp: any) => (
                <tr key={opp.id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`revenue-opp-${opp.id}`}>
                  <td className="py-2.5 px-3 font-medium">{opp.title}</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400 font-semibold">
                    {opp.potentialValue ? `$${Number(opp.potentialValue).toLocaleString()}` : "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <AgentChip agentType={opp.agentId ?? ""} size="xs" />
                      <span>{AGENT_META[opp.agentId ?? ""]?.name ?? opp.agentId ?? "—"}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><StatusBadge status={opp.status ?? "open"} /></td>
                  <td className="py-2.5 px-3">
                    {opp.probability != null ? (
                      <span className={`font-semibold ${probColor(opp.probability)}`}>{opp.probability}%</span>
                    ) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground max-w-32 truncate">{opp.nextAction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Approval Command Center ───────────────────────────────────────────

function ApprovalsTab() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: approvals, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals"],
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const pending = (approvals ?? []).filter(a => a.status === "pending_approval" || a.status === "pending");

  const approveMutation = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("POST", `/api/ai-approvals/${id}/approve`, {}); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); queryClient.invalidateQueries({ queryKey: ["/api/ops/mission-control"] }); toast({ title: "Approved." }); },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("POST", `/api/ai-approvals/${id}/reject`, {}); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); toast({ title: "Rejected." }); },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => { const r = await apiRequest("POST", "/api/ai-approvals/bulk-approve", { ids }); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); setSelected(new Set()); toast({ title: `${selected.size} actions approved.` }); },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async (ids: string[]) => { const r = await apiRequest("POST", "/api/ai-approvals/bulk-reject", { ids }); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); setSelected(new Set()); toast({ title: `${selected.size} actions rejected.` }); },
    onError: () => toast({ title: "Bulk reject failed", variant: "destructive" }),
  });

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll = () => setSelected(new Set(pending.map((a: any) => a.id)));
  const clearSelect = () => setSelected(new Set());

  const impactColors: Record<string, string> = {
    high: "text-rose-600 dark:text-rose-400", medium: "text-amber-600 dark:text-amber-400", low: "text-emerald-600 dark:text-emerald-400",
  };

  return (
    <div className="space-y-4" data-testid="tab-approvals">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Pending Approvals</h3>
          {pending.length > 0 && (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">{pending.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => bulkApproveMutation.mutate([...selected])} disabled={bulkApproveMutation.isPending}
                data-testid="button-bulk-approve">
                <Check className="h-3 w-3 mr-1" />Approve All
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-rose-300 text-rose-600"
                onClick={() => bulkRejectMutation.mutate([...selected])} disabled={bulkRejectMutation.isPending}
                data-testid="button-bulk-reject">
                <X className="h-3 w-3 mr-1" />Reject All
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelect}>Clear</Button>
            </>
          )}
          {selected.size === 0 && pending.length > 1 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAll} data-testid="button-select-all">
              Select All
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
          <CheckCircle className="h-6 w-6 mx-auto mb-2 text-emerald-500 opacity-70" />
          <p className="text-sm">No pending approvals</p>
          <p className="text-xs mt-1">All agent actions are operating within approved parameters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((item: any) => {
            const isSelected = selected.has(item.id);
            return (
              <div key={item.id} className={`p-4 rounded-xl border transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border bg-card"}`} data-testid={`approval-item-${item.id}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleSelect(item.id)}
                    className={`h-4 w-4 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground"}`}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </button>
                  <AgentChip agentType={item.agentType ?? ""} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{item.subject ?? item.messageType ?? item.actionType ?? "Agent Action"}</span>
                      {item.riskLevel && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${impactColors[item.riskLevel] ?? ""}`}>
                          {item.riskLevel} risk
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {item.proposedContent ?? item.reasoningSummary ?? "No details available"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {item.timestamp ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }) : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 pl-10">
                  <Button size="sm" className="h-7 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => approveMutation.mutate(item.id)} disabled={approveMutation.isPending || rejectMutation.isPending}
                    data-testid={`button-approve-${item.id}`}>
                    <Check className="h-3 w-3 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1 border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400"
                    onClick={() => rejectMutation.mutate(item.id)} disabled={approveMutation.isPending || rejectMutation.isPending}
                    data-testid={`button-reject-${item.id}`}>
                    <X className="h-3 w-3 mr-1" />Reject
                  </Button>
                  <Link href="/admin/ai-approvals">
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                      <Eye className="h-3 w-3" />View
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab 6: Workforce Performance Analytics ────────────────────────────────────

function AnalyticsTab() {
  const [period, setPeriod] = useState("7d");
  const { data: scorecard, isLoading } = useQuery<any>({
    queryKey: ["/api/workforce/scorecard", period],
    queryFn: async () => {
      const r = await fetch(`/api/workforce/scorecard?period=${period}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  const topPerformers = [...(scorecard?.agentBreakdown ?? [])].sort((a, b) => b.actions - a.actions).slice(0, 3);

  return (
    <div className="space-y-4" data-testid="tab-analytics">
      {/* Period selector */}
      <div className="flex gap-2">
        {[{ label: "Today", value: "today" }, { label: "7 Days", value: "7d" }, { label: "30 Days", value: "30d" }].map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Total Actions",       value: scorecard?.totalActions ?? 0,         color: "text-foreground" },
              { label: "Success Rate",        value: `${scorecard?.successRate ?? 0}%`,    color: scorecard?.successRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
              { label: "Workflow Executions", value: scorecard?.workflowExecutions ?? 0,   color: "text-blue-600 dark:text-blue-400" },
              { label: "Revenue Influenced",  value: `$${Number(scorecard?.revenueInfluenced ?? 0).toLocaleString()}`, color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Approvals Requested", value: scorecard?.approvalsRequested ?? 0,  color: "text-amber-600 dark:text-amber-400" },
              { label: "Approvals Approved",  value: scorecard?.approvalsApproved ?? 0,   color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Agent Utilization",   value: `${scorecard?.agentUtilization ?? 0}%`, color: "text-violet-600 dark:text-violet-400" },
              { label: "Failed Actions",      value: scorecard?.failedActions ?? 0,        color: scorecard?.failedActions > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
            ].map(m => (
              <div key={m.label} className="flex flex-col gap-0.5 p-3 rounded-lg border bg-card">
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
                <span className={`text-xl font-bold ${m.color}`}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* Top performers */}
          {topPerformers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Award className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Top Performers</h3>
              </div>
              <div className="flex gap-2 flex-wrap">
                {topPerformers.map((a: any, i: number) => (
                  <div key={a.agentType} className={`flex items-center gap-2.5 p-3 rounded-xl border bg-card flex-1 min-w-40 ${i === 0 ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10" : ""}`}>
                    {i === 0 && <Award className="h-4 w-4 text-amber-500 shrink-0" />}
                    <AgentChip agentType={a.agentType} size="sm" />
                    <div>
                      <p className="text-xs font-semibold">{AGENT_META[a.agentType]?.name ?? a.agentName}</p>
                      <p className="text-[10px] text-muted-foreground">{a.actions} actions · {a.errors} errors</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent breakdown table */}
          {(scorecard?.agentBreakdown ?? []).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Agent Scorecards</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {["Agent", "Actions", "Errors", "Success Rate", "Status"].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scorecard.agentBreakdown.map((a: any) => {
                      const rate = a.actions > 0 ? Math.round(((a.actions - a.errors) / a.actions) * 100) : 0;
                      return (
                        <tr key={a.agentType} className="border-b hover:bg-muted/30" data-testid={`scorecard-row-${a.agentType}`}>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <AgentChip agentType={a.agentType} size="xs" />
                              <span className="font-medium">{AGENT_META[a.agentType]?.name ?? a.agentName}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-semibold">{a.actions}</td>
                          <td className="py-2.5 px-3 text-rose-500">{a.errors}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className={`h-full rounded-full ${rate >= 80 ? "bg-emerald-500" : rate >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${rate}%` }} />
                              </div>
                              <span className={`font-semibold ${rate >= 80 ? "text-emerald-600 dark:text-emerald-400" : rate >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{rate}%</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={a.actions > 0 ? "active" : "idle"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 7: Agent Memory & Decision Viewer ────────────────────────────────────

function MemoryTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: feed, isLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/activity"],
    queryFn: async () => {
      const r = await fetch("/api/workforce/activity?limit=50", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 30_000,
  });

  const { data: decision, isLoading: decisionLoading } = useQuery<any>({
    queryKey: ["/api/ops/agent-decision", selectedId],
    queryFn: async () => {
      const r = await fetch(`/api/ops/agent-decision/${selectedId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!selectedId,
  });

  const actionLabel = (type: string) => (type ?? "action").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="tab-memory">
      {/* Action selector */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BrainCircuit className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Select an Action</h3>
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : (
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
            {(feed ?? []).filter(a => a.reasoningSummary).map((item: any) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                data-testid={`memory-action-${item.id}`}
                className={`w-full flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all ${selectedId === item.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"}`}
              >
                <AgentChip agentType={item.agentType ?? ""} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{actionLabel(item.actionType)}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{item.reasoningSummary}</p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
            {(feed ?? []).filter(a => a.reasoningSummary).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No actions with recorded reasoning yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Decision detail */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Eye className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Decision Viewer</h3>
        </div>
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
            <BrainCircuit className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">Select an action to inspect its decision</p>
          </div>
        ) : decisionLoading ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : decision ? (
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center gap-2">
                <AgentChip agentType={decision.agentType ?? ""} />
                <div>
                  <p className="text-sm font-semibold">{decision.agentName}</p>
                  <p className="text-xs text-muted-foreground">{decision.department}</p>
                </div>
              </div>
              <Separator />
              {[
                { label: "Decision Made",    value: actionLabel(decision.decision), icon: Zap },
                { label: "Reason",           value: decision.reason,                icon: Target },
                { label: "Rule / Trigger",   value: decision.rule,                  icon: Shield },
                { label: "Outcome",          value: decision.outcome,               icon: CheckCircle },
              ].map(row => {
                const Icon = row.icon;
                return (
                  <div key={row.label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{row.label}</p>
                      <p className="text-xs mt-0.5">{row.value}</p>
                    </div>
                  </div>
                );
              })}
              {decision.confidence != null && (
                <div className="p-3 rounded-lg bg-muted/40">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-muted-foreground uppercase tracking-wide font-medium text-[9px]">Confidence Level</span>
                    <span className={`font-bold text-base ${decision.confidence >= 80 ? "text-emerald-600 dark:text-emerald-400" : decision.confidence >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{decision.confidence}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${decision.confidence >= 80 ? "bg-emerald-500" : decision.confidence >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${decision.confidence}%` }} />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={decision.status} />
                {decision.riskLevel && (
                  <Badge variant="outline" className="text-[10px] capitalize">{decision.riskLevel} risk</Badge>
                )}
                {decision.toolsUsed?.map((t: string) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
            <p className="text-xs">Decision details not available for this action.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 8: CEO Control Panel ─────────────────────────────────────────────────

function ControlsTab() {
  const { toast } = useToast();
  const [broadcast, setBroadcast] = useState("");
  const { data: govSettings } = useQuery<any>({ queryKey: ["/api/governance/settings"], staleTime: 30_000 });
  const { data: agents } = useQuery<any[]>({ queryKey: ["/api/workforce/agents"], staleTime: 30_000 });

  const controlMutation = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload?: any }) => {
      const r = await apiRequest("POST", "/api/ops/control-panel", { action, payload });
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/mission-control"] });
      toast({ title: data.message ?? "Action executed." });
      setBroadcast("");
    },
    onError: () => toast({ title: "Failed to execute action", variant: "destructive" }),
  });

  const isPaused = govSettings?.emergencyPauseEnabled === true;
  const enabledAgents = (agents ?? []).filter((a: any) => a.enabled);

  const QUICK_ACTIONS = [
    { action: "pause_workforce",   label: "Pause Entire Workforce",    icon: Pause,       danger: true,     desc: "Suspend all agent actions immediately" },
    { action: "resume_workforce",  label: "Resume Workforce",          icon: Play,        success: true,    desc: "Restore normal agent operations" },
    { action: "force_workflow",    label: "Force Workflow Run",        icon: SkipForward, warning: false,   desc: "Manually trigger workflow execution" },
    { action: "trigger_task",      label: "Trigger Agent Task",        icon: Zap,         warning: false,   desc: "Manually dispatch a specific task" },
  ];

  return (
    <div className="space-y-6" data-testid="tab-controls">
      {/* Emergency status banner */}
      {isPaused && (
        <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20">
          <Pause className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Workforce Emergency Pause Active</p>
            <p className="text-xs text-muted-foreground">All agent actions are currently suspended. Resume to restore operations.</p>
          </div>
          <Button
            size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => controlMutation.mutate({ action: "resume_workforce" })}
            disabled={controlMutation.isPending}
            data-testid="button-resume-workforce-banner"
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />Resume Workforce
          </Button>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Workforce Controls</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(qa => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.action}
                onClick={() => controlMutation.mutate({ action: qa.action })}
                disabled={controlMutation.isPending}
                data-testid={`control-${qa.action}`}
                className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:opacity-90 ${
                  qa.danger ? "border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/10 hover:bg-rose-100 dark:hover:bg-rose-900/20" :
                  qa.success ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-100 dark:hover:bg-emerald-900/20" :
                  "border-border bg-card hover:bg-muted/30"
                }`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                  qa.danger ? "bg-rose-100 dark:bg-rose-900/30" : qa.success ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-primary/10"
                }`}>
                  <Icon className={`h-4.5 w-4.5 ${qa.danger ? "text-rose-600 dark:text-rose-400" : qa.success ? "text-emerald-600 dark:text-emerald-400" : "text-primary"}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold">{qa.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{qa.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-agent controls */}
      {enabledAgents.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Agent-Level Controls</h3>
          <div className="space-y-2">
            {enabledAgents.map((agent: any) => {
              const meta = AGENT_META[agent.agentType];
              return (
                <div key={agent.agentType} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`agent-control-${agent.agentType}`}>
                  <AgentChip agentType={agent.agentType} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{meta?.name ?? agent.agentType}</p>
                    <p className="text-[10px] text-muted-foreground">{meta?.dept}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => controlMutation.mutate({ action: "pause_agent", payload: { agentType: agent.agentType } })}
                      disabled={controlMutation.isPending}
                      data-testid={`button-pause-agent-${agent.agentType}`}>
                      <Pause className="h-3 w-3" />Pause
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => controlMutation.mutate({ action: "restart_agent", payload: { agentType: agent.agentType } })}
                      disabled={controlMutation.isPending}
                      data-testid={`button-restart-agent-${agent.agentType}`}>
                      <RotateCcw className="h-3 w-3" />Restart
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Broadcast instruction */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Radio className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Broadcast Instruction to All Agents</h3>
        </div>
        <div className="space-y-2">
          <Textarea
            value={broadcast}
            onChange={(e: any) => setBroadcast(e.target.value)}
            placeholder='e.g. "All agents prioritize lead recovery today." or "Focus only on high-value prospects this week."'
            className="text-sm min-h-24 resize-none"
            data-testid="input-broadcast"
          />
          <div className="flex justify-between items-center gap-2">
            <p className="text-[10px] text-muted-foreground">This instruction will be logged and queued for agent context on next run.</p>
            <Button
              size="sm"
              onClick={() => controlMutation.mutate({ action: "broadcast_instruction", payload: { instruction: broadcast } })}
              disabled={!broadcast.trim() || controlMutation.isPending}
              data-testid="button-broadcast"
            >
              <Radio className="h-3.5 w-3.5 mr-1.5" />
              {controlMutation.isPending ? "Sending…" : "Broadcast"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 9: Autonomous Operations Timeline ────────────────────────────────────

function TimelineTab() {
  const { data: timeline, isLoading } = useQuery<any>({ queryKey: ["/api/ops/autonomous-timeline"], staleTime: 60_000 });

  const STAGE_ICONS: Record<string, typeof Search> = {
    search: Search, "zoom-in": Eye, mail: Mail, calendar: Calendar, "file-text": FileText, "check-circle": CheckCircle,
  };

  const STAGE_COLORS: Record<string, { bg: string; border: string; text: string; bar: string }> = {
    blue:    { bg: "bg-blue-500/10",    border: "border-blue-200 dark:border-blue-800",    text: "text-blue-600 dark:text-blue-400",    bar: "bg-blue-500" },
    violet:  { bg: "bg-violet-500/10",  border: "border-violet-200 dark:border-violet-800",  text: "text-violet-600 dark:text-violet-400",  bar: "bg-violet-500" },
    sky:     { bg: "bg-sky-500/10",     border: "border-sky-200 dark:border-sky-800",     text: "text-sky-600 dark:text-sky-400",     bar: "bg-sky-500" },
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
    amber:   { bg: "bg-amber-500/10",   border: "border-amber-200 dark:border-amber-800",   text: "text-amber-600 dark:text-amber-400",   bar: "bg-amber-500" },
    green:   { bg: "bg-green-500/10",   border: "border-green-200 dark:border-green-800",   text: "text-green-600 dark:text-green-400",   bar: "bg-green-500" },
  };

  const stages: any[] = timeline?.stages ?? [];
  const totalEvents = timeline?.totalEvents ?? 0;
  const maxCount = Math.max(...stages.map((s: any) => s.count), 1);

  return (
    <div className="space-y-4" data-testid="tab-timeline">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Autonomous Operations Pipeline</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalEvents} events in the last 7 days — showing your complete autonomous business process
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-border" />

          <div className="space-y-3">
            {stages.map((stage: any, idx: number) => {
              const Icon = STAGE_ICONS[stage.icon] ?? CircleDot;
              const colors = STAGE_COLORS[stage.color] ?? STAGE_COLORS.blue;
              const pct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;

              return (
                <div key={stage.key} className="relative pl-12" data-testid={`timeline-stage-${stage.key}`}>
                  {/* Node */}
                  <div className={`absolute left-0 top-3 h-10 w-10 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center z-10`}>
                    <Icon className={`h-4.5 w-4.5 ${colors.text}`} />
                  </div>

                  {/* Arrow connector (not on last) */}
                  {idx < stages.length - 1 && (
                    <div className="absolute left-4.5 top-10 h-3 flex flex-col items-center">
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 rotate-90" />
                    </div>
                  )}

                  <div className={`p-4 rounded-xl border ${colors.border} ${colors.bg}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{stage.stage}</span>
                        <Badge className={`${colors.text.replace("text-", "bg-").replace(" dark:text-", " dark:bg-")} bg-opacity-10 text-xs`} style={{ background: undefined }}>
                          <span className={colors.text}>{stage.count} events</span>
                        </Badge>
                      </div>
                    </div>

                    {/* Progress bar showing relative activity */}
                    <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 mb-3 overflow-hidden">
                      <div className={`h-full rounded-full ${colors.bar} transition-all`} style={{ width: `${pct}%` }} />
                    </div>

                    {/* Recent events */}
                    {stage.recentLogs?.length > 0 && (
                      <div className="space-y-1">
                        {stage.recentLogs.map((log: any) => (
                          <div key={log.id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <CircleDot className={`h-2.5 w-2.5 shrink-0 ${colors.text}`} />
                            <span className="font-medium">{log.agentName}</span>
                            <span>·</span>
                            <span>{log.actionType?.replace(/_/g, " ")}</span>
                            <span>·</span>
                            <span>{log.timestamp ? formatDistanceToNow(new Date(log.timestamp), { addSuffix: true }) : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {stage.count === 0 && (
                      <p className="text-[10px] text-muted-foreground italic">No activity in this stage yet</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminAiOperationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const { data: approvals } = useQuery<any[]>({ queryKey: ["/api/ai-approvals"], staleTime: 30_000, refetchInterval: 30_000 });
  const pendingCount = (approvals ?? []).filter(a => a.status === "pending_approval" || a.status === "pending").length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-ai-operations">

      {/* Header */}
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
            AI Operations Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live execution layer — monitor, control, and orchestrate your AI workforce in real time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-workforce/settings">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" data-testid="button-go-settings">
              <SlidersHorizontal className="h-3.5 w-3.5" />Settings
            </Button>
          </Link>
          <Link href="/admin/ai-approvals">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8 relative" data-testid="button-go-approvals">
              <Clock className="h-3.5 w-3.5" />
              Approvals
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </Button>
          </Link>
        </div>
      </div>

      {/* Mission Control always visible */}
      <MissionControlStrip />

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasBadge = tab.id === "approvals" && pendingCount > 0;
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
                <span className="h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center ml-0.5">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "feed"      && <LiveFeedTab />}
        {activeTab === "agents"    && <AgentsTab />}
        {activeTab === "workflows" && <WorkflowsTab />}
        {activeTab === "revenue"   && <RevenueTab />}
        {activeTab === "approvals" && <ApprovalsTab />}
        {activeTab === "analytics" && <AnalyticsTab />}
        {activeTab === "memory"    && <MemoryTab />}
        {activeTab === "controls"  && <ControlsTab />}
        {activeTab === "timeline"  && <TimelineTab />}
      </div>
    </div>
  );
}
