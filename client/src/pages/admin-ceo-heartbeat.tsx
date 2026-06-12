import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, Play, Pause, RotateCcw, Zap, AlertTriangle, CheckCircle2,
  Clock, Brain, ShieldAlert, BarChart3, Filter, RefreshCw, TrendingUp,
  XCircle, ChevronRight, Calendar, Users, Target, Settings, Crosshair,
  ArrowRight, Star, Shield
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function urgencyColor(u: string): string {
  if (u === "critical") return "destructive";
  if (u === "high") return "destructive";
  if (u === "medium") return "secondary";
  return "outline";
}

function statusColor(s: string): string {
  if (s === "completed") return "bg-green-500/10 text-green-600 border-green-200";
  if (s === "failed") return "bg-red-500/10 text-red-600 border-red-200";
  if (s === "running") return "bg-blue-500/10 text-blue-600 border-blue-200";
  if (s === "pending") return "bg-yellow-500/10 text-yellow-600 border-yellow-200";
  if (s === "skipped") return "bg-gray-500/10 text-gray-500 border-gray-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function actionTypeIcon(t: string) {
  if (t === "recommendation") return <Target className="h-3 w-3" />;
  if (t === "error") return <XCircle className="h-3 w-3 text-red-500" />;
  if (t === "email_sent") return <Zap className="h-3 w-3 text-green-500" />;
  if (t === "approval_required") return <ShieldAlert className="h-3 w-3 text-yellow-500" />;
  if (t === "reply_detected") return <Activity className="h-3 w-3 text-blue-500" />;
  if (t === "booking_created") return <Calendar className="h-3 w-3 text-purple-500" />;
  if (t === "revenue_outcome") return <TrendingUp className="h-3 w-3 text-green-600" />;
  if (t === "heartbeat_cycle") return <Brain className="h-3 w-3 text-indigo-500" />;
  return <Activity className="h-3 w-3" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminCeoHeartbeatPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sessionCtx } = useQuery<{ orgId: string | null; orgName: string | null }>({
    queryKey: ["/api/admin/ceo-heartbeat/session-context"],
    staleTime: 5 * 60_000,
  });
  const orgId: string = sessionCtx?.orgId ?? "";

  const [timelineFilters, setTimelineFilters] = useState({
    agent: "",
    domain: "",
    actionType: "",
    actionStatus: "",
    since: "24h",
  });

  function sinceDate(val: string) {
    const map: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
    const h = map[val] ?? 24;
    return new Date(Date.now() - h * 3600 * 1000).toISOString();
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: status, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/status", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const { data: healthData } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/health", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const { data: prioritiesData, isLoading: prioritiesLoading } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/priorities", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const timelineQKey = [
    "/api/admin/ceo-heartbeat/timeline",
    orgId,
    timelineFilters,
  ];

  const { data: timelineData, isLoading: timelineLoading } = useQuery<any>({
    queryKey: timelineQKey,
    queryFn: () => {
      const params = new URLSearchParams({ orgId, since: sinceDate(timelineFilters.since), limit: "100" });
      if (timelineFilters.agent) params.set("agent", timelineFilters.agent);
      if (timelineFilters.domain) params.set("domain", timelineFilters.domain);
      if (timelineFilters.actionType) params.set("actionType", timelineFilters.actionType);
      if (timelineFilters.actionStatus) params.set("actionStatus", timelineFilters.actionStatus);
      return fetch(`/api/admin/ceo-heartbeat/timeline?${params}`).then(r => r.json());
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const { data: auditData } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/audit-log", orgId],
    enabled: !!orgId,
  });

  const { data: oppSummary, isLoading: oppSummaryLoading } = useQuery<any>({
    queryKey: ["/api/opportunity-acquisition/heartbeat-summary"],
    refetchInterval: 120_000,
  });

  const { data: agentQualityRisks } = useQuery<any>({
    queryKey: ["/api/admin/agent-quality/risks"],
    refetchInterval: 120_000,
  });

  const { data: reliabilitySummary } = useQuery<any>({
    queryKey: ["/api/reliability/executive-summary"],
    refetchInterval: 60_000,
    refetchOnMount: "always",
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/run?orgId=${orgId}`),
    onSuccess: () => {
      toast({ title: "Heartbeat cycle started", description: "CEO Heartbeat is running now." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
      queryClient.invalidateQueries({ queryKey: timelineQKey });
      queryClient.invalidateQueries({ queryKey: ["/api/reliability/executive-summary"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/pause?orgId=${orgId}`),
    onSuccess: () => {
      toast({ title: "Heartbeat paused", description: "Automation will not auto-execute until resumed." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/resume?orgId=${orgId}`),
    onSuccess: () => {
      toast({ title: "Heartbeat resumed", description: "CEO Heartbeat is active again." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/retry-failed?orgId=${orgId}`),
    onSuccess: (data: any) => {
      toast({ title: "Jobs retried", description: `${data?.retried ?? 0} failed jobs queued for retry.` });
      queryClient.invalidateQueries({ queryKey: timelineQKey });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const recalcMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/recalculate-priorities?orgId=${orgId}`),
    onSuccess: () => {
      toast({ title: "Priorities recalculated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ceo-heartbeat/priorities", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const lastRun = status?.lastRun;
  const health = healthData ?? {};
  const priorities = prioritiesData?.priorities ?? [];
  const timeline = timelineData?.entries ?? [];
  const isPaused = status?.isPaused ?? false;
  const isRunning = status?.isRunning ?? false;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-indigo-500" />
            CEO Heartbeat
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Unified orchestration layer — coordinates all agents, approvals, and outcomes from one center
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isPaused ? "destructive" : isRunning ? "secondary" : "outline"}
            className="text-xs">
            {isPaused ? "⏸ Paused" : isRunning ? "⟳ Running" : "● Active"}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries()}
            data-testid="button-refresh-all">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Platform Reliability Card ── */}
      {reliabilitySummary && (
        <Card className={`border-l-4 ${
          reliabilitySummary.status === "operational" ? "border-l-emerald-500 bg-emerald-500/5" :
          reliabilitySummary.status === "degraded"    ? "border-l-yellow-500 bg-yellow-500/5" :
                                                        "border-l-red-500 bg-red-500/5"
        }`} data-testid="card-reliability-summary">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <Shield className={`h-5 w-5 ${
                  reliabilitySummary.status === "operational" ? "text-emerald-500" :
                  reliabilitySummary.status === "degraded"    ? "text-yellow-500" : "text-red-500"
                }`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Platform Status</span>
                    <Badge className={`text-[10px] capitalize ${
                      reliabilitySummary.status === "operational" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" :
                      reliabilitySummary.status === "degraded"    ? "bg-yellow-500/15 text-yellow-700 border-yellow-200" :
                                                                    "bg-red-500/15 text-red-700 border-red-200"
                    }`}>{reliabilitySummary.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{reliabilitySummary.recommendation}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-center">
                <div>
                  <div className="text-lg font-bold tabular-nums">{reliabilitySummary.uptime}%</div>
                  <div className="text-[10px] text-muted-foreground">Uptime</div>
                </div>
                <div>
                  <div className={`text-lg font-bold tabular-nums ${reliabilitySummary.criticalAlerts > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {reliabilitySummary.criticalAlerts}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Critical Alerts</div>
                </div>
                <div>
                  <div className={`text-lg font-bold tabular-nums ${reliabilitySummary.clientErrorsLastHour > 5 ? "text-orange-500" : "text-muted-foreground"}`}>
                    {reliabilitySummary.clientErrorsLastHour}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Client Errors/hr</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums">
                    {reliabilitySummary.healthChecksTotal > 0
                      ? `${reliabilitySummary.healthChecksPass}/${reliabilitySummary.healthChecksTotal}`
                      : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Checks Passing</div>
                </div>
                <div>
                  <div className={`text-lg font-bold tabular-nums ${
                    (reliabilitySummary.dlqPending ?? 0) >= 20 ? "text-red-500" :
                    (reliabilitySummary.dlqPending ?? 0) >= 5  ? "text-yellow-500" :
                    "text-muted-foreground"
                  }`}>
                    {reliabilitySummary.dlqPending ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">DLQ Pending</div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <a href="/admin/reliability" data-testid="link-reliability-dashboard">View Dashboard</a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Status Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Last Heartbeat</div>
            <div className="font-medium text-sm">{lastRun ? fmtTime(lastRun.startedAt) : "Not run yet"}</div>
            {lastRun && (
              <div className="text-xs text-muted-foreground mt-1">
                {fmtMs(lastRun.durationMs)} • <span className={lastRun.status === "completed" ? "text-green-600" : "text-red-500"}>{lastRun.status}</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Next Heartbeat</div>
            <div className="font-medium text-sm">{status?.nextHeartbeatAt ? fmtTime(status.nextHeartbeatAt) : "Automatic"}</div>
            <div className="text-xs text-muted-foreground mt-1">Runs every 30 minutes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Agents Coordinated</div>
            <div className="font-bold text-xl">{lastRun?.agentsCoordinated ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">{lastRun ? `${lastRun.actionsEvaluated ?? 0} actions evaluated` : "Run heartbeat to see data"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Errors (last run)</div>
            <div className={`font-bold text-xl ${(lastRun?.errorsEncountered ?? 0) > 0 ? "text-red-500" : lastRun ? "text-green-600" : "text-muted-foreground"}`}>
              {lastRun ? (lastRun.errorsEncountered ?? 0) : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{lastRun ? `${lastRun.actionsPendingApproval ?? 0} pending approval` : "No run data yet"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Manual Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Settings className="h-4 w-4" />Manual Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || isRunning}
            data-testid="button-run-heartbeat">
            <Play className="h-4 w-4 mr-1" />
            {runMutation.isPending ? "Running…" : "Run Heartbeat Now"}
          </Button>
          {isPaused ? (
            <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending} data-testid="button-resume-automation">
              <Play className="h-4 w-4 mr-1" />
              Resume Automation
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending} data-testid="button-pause-automation">
              <Pause className="h-4 w-4 mr-1" />
              Pause All Automation
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending} data-testid="button-retry-failed">
            <RotateCcw className="h-4 w-4 mr-1" />
            {retryMutation.isPending ? "Retrying…" : "Retry Failed Jobs"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending} data-testid="button-recalculate-priorities">
            <Brain className="h-4 w-4 mr-1" />
            {recalcMutation.isPending ? "Recalculating…" : "Recalculate Priorities"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Priorities */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              Top Priorities
            </CardTitle>
            <CardDescription className="text-xs">Ranked actions from all agent systems</CardDescription>
          </CardHeader>
          <CardContent>
            {prioritiesLoading ? (
              <div className="text-sm text-muted-foreground">Loading priorities…</div>
            ) : priorities.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No active priorities. Run heartbeat to generate.
              </div>
            ) : (
              <div className="space-y-2">
                {priorities.map((p: any, i: number) => (
                  <div key={p.id ?? i} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    data-testid={`priority-item-${i}`}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-xs font-bold text-indigo-600">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight">{p.summary}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.decisionReason}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className="text-xs h-4 px-1">{p.agentName}</Badge>
                        {p.metadata?.urgency && (
                          <Badge variant={urgencyColor(p.metadata.urgency) as any} className="text-xs h-4 px-1">
                            {p.metadata.urgency}
                          </Badge>
                        )}
                        {p.requiresApproval && (
                          <Badge variant="secondary" className="text-xs h-4 px-1">
                            <ShieldAlert className="h-3 w-3 mr-0.5" />Approval needed
                          </Badge>
                        )}
                        {p.metadata?.estimatedRevenueCents > 0 && (
                          <span className="text-xs text-green-600 font-medium">
                            ~${Math.round(p.metadata.estimatedRevenueCents / 100).toLocaleString()} potential
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-mono font-bold text-indigo-600">{p.priority}</div>
                      <div className="text-[10px] text-muted-foreground">score</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Execution Health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Execution Health (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Successful Actions", value: health.successfulActions ?? 0, color: "text-green-600", icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> },
                { label: "Failed Actions", value: health.failedActions ?? 0, color: health.failedActions > 0 ? "text-red-600" : "text-gray-500", icon: <XCircle className="h-4 w-4 text-red-400" /> },
                { label: "Auto Executed", value: health.autoExecuted ?? 0, color: "text-blue-600", icon: <Zap className="h-4 w-4 text-blue-500" /> },
                { label: "Pending Approvals", value: health.pendingApprovals ?? 0, color: health.pendingApprovals > 0 ? "text-yellow-600" : "text-gray-500", icon: <ShieldAlert className="h-4 w-4 text-yellow-500" /> },
                { label: "Skipped Duplicates", value: health.skippedDuplicates ?? 0, color: "text-gray-500", icon: <RotateCcw className="h-4 w-4 text-gray-400" /> },
                { label: "Unresolved Errors", value: health.unresolvedErrors ?? 0, color: health.unresolvedErrors > 0 ? "text-red-600" : "text-gray-500", icon: <AlertTriangle className="h-4 w-4 text-red-400" /> },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card"
                  data-testid={`health-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {stat.icon}
                  <div>
                    <div className={`font-bold text-lg leading-none ${stat.color}`}>{stat.value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <Separator className="my-4" />

            {/* Recent heartbeat runs */}
            <div className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</div>
            <div className="space-y-1">
              {(status?.recentRuns ?? []).slice(0, 5).map((run: any) => (
                <div key={run.id} className="flex items-center gap-2 text-xs py-1"
                  data-testid={`run-item-${run.id}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${run.status === "completed" ? "bg-green-500" : run.status === "failed" ? "bg-red-500" : "bg-yellow-400"}`} />
                  <span className="text-muted-foreground">{fmtTime(run.startedAt)}</span>
                  <span className="flex-1" />
                  <span>{run.agentsCoordinated ?? 0} agents</span>
                  <span className="text-muted-foreground">{fmtMs(run.durationMs)}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1">{run.triggeredBy}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Opportunity Acquisition Department Card */}
      <Card className="border-indigo-200 dark:border-indigo-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-indigo-500" />
              Opportunity Acquisition Department
            </CardTitle>
            <a href="/admin/opportunity-acquisition" className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
              Open OS <ArrowRight className="h-3 w-3" />
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Live pipeline status — monitored by CEO Heartbeat every 30 minutes</p>
        </CardHeader>
        <CardContent>
          {oppSummaryLoading ? (
            <div className="text-sm text-muted-foreground">Loading opportunity data…</div>
          ) : !oppSummary ? (
            <div className="text-sm text-muted-foreground">No data — run the CEO Heartbeat to generate.</div>
          ) : (
            <div className="space-y-4">
              {/* Metric grid */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {[
                  { label: "Found",          value: oppSummary.opportunitiesFound ?? 0,  color: "text-blue-600" },
                  { label: "Qualified",      value: oppSummary.qualified ?? 0,           color: "text-emerald-600" },
                  { label: "Replies",        value: oppSummary.replies ?? 0,             color: "text-violet-600" },
                  { label: "Meetings",       value: oppSummary.meetings ?? 0,            color: "text-amber-600" },
                  { label: "Wins",           value: oppSummary.wins ?? 0,                color: "text-green-600" },
                  { label: "Pending Drafts", value: oppSummary.pendingDrafts ?? 0,       color: (oppSummary.pendingDrafts ?? 0) > 0 ? "text-orange-500" : "text-gray-500" },
                ].map(stat => (
                  <div key={stat.label} className="text-center p-2 rounded-lg border bg-card"
                    data-testid={`opp-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className={`font-bold text-xl leading-none ${stat.color}`}>{stat.value}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Executive summary */}
              {oppSummary.executiveSummary && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 leading-relaxed">
                  {oppSummary.executiveSummary}
                </div>
              )}

              {/* Best Action Today */}
              {oppSummary.bestAction && (
                <div className={`flex items-start gap-3 p-3 rounded-lg border-l-4 ${
                  oppSummary.bestAction.priority === "critical" ? "border-l-red-500 bg-red-50 dark:bg-red-950/20" :
                  oppSummary.bestAction.priority === "high"     ? "border-l-orange-500 bg-orange-50 dark:bg-orange-950/20" :
                  oppSummary.bestAction.priority === "medium"   ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20" :
                                                                   "border-l-blue-400 bg-blue-50 dark:bg-blue-950/20"
                }`} data-testid="opp-best-action">
                  <Star className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                    oppSummary.bestAction.priority === "critical" ? "text-red-500" :
                    oppSummary.bestAction.priority === "high"     ? "text-orange-500" :
                    oppSummary.bestAction.priority === "medium"   ? "text-amber-500" : "text-blue-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{oppSummary.bestAction.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{oppSummary.bestAction.description}</div>
                  </div>
                  <a href={oppSummary.bestAction.route}
                    className="text-xs text-primary hover:underline flex-shrink-0 flex items-center gap-0.5">
                    Act <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              )}

              {/* Health check alerts (failed only) */}
              {(oppSummary.healthChecks ?? []).filter((c: any) => !c.passed).length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Health Alerts</div>
                  {(oppSummary.healthChecks as any[]).filter(c => !c.passed).map((check: any) => (
                    <div key={check.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/40"
                      data-testid={`opp-health-${check.id}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        check.severity === "critical" ? "bg-red-500" :
                        check.severity === "high"     ? "bg-orange-500" :
                        check.severity === "medium"   ? "bg-amber-400" : "bg-blue-400"
                      }`} />
                      <span className="font-medium">{check.label}:</span>
                      <span className="text-muted-foreground flex-1">{check.detail}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1 flex-shrink-0">{check.severity}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unified Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-green-500" />
                Unified Operating Timeline
              </CardTitle>
              <CardDescription className="text-xs">
                Every agent action, approval, outcome, and error in one stream
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {timelineData?.total ?? 0} events
              </Badge>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Select value={timelineFilters.since} onValueChange={v => setTimelineFilters(f => ({ ...f, since: v }))}>
              <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-timeline-since">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last 1h</SelectItem>
                <SelectItem value="6h">Last 6h</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7d</SelectItem>
              </SelectContent>
            </Select>

            <Select value={timelineFilters.actionType} onValueChange={v => setTimelineFilters(f => ({ ...f, actionType: v === "all" ? "" : v }))}>
              <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-timeline-action-type">
                <SelectValue placeholder="Action type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="recommendation">Recommendation</SelectItem>
                <SelectItem value="email_sent">Email sent</SelectItem>
                <SelectItem value="approval_required">Approval required</SelectItem>
                <SelectItem value="reply_detected">Reply detected</SelectItem>
                <SelectItem value="booking_created">Booking created</SelectItem>
                <SelectItem value="revenue_outcome">Revenue outcome</SelectItem>
                <SelectItem value="heartbeat_cycle">Heartbeat cycle</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="skipped_duplicate">Skipped duplicate</SelectItem>
              </SelectContent>
            </Select>

            <Select value={timelineFilters.actionStatus} onValueChange={v => setTimelineFilters(f => ({ ...f, actionStatus: v === "all" ? "" : v }))}>
              <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-timeline-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
                <SelectItem value="requires_approval">Requires approval</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Filter by agent…"
              value={timelineFilters.agent}
              onChange={e => setTimelineFilters(f => ({ ...f, agent: e.target.value }))}
              className="h-7 w-36 text-xs"
              data-testid="input-timeline-agent-filter"
            />

            <Input
              placeholder="Filter by domain…"
              value={timelineFilters.domain}
              onChange={e => setTimelineFilters(f => ({ ...f, domain: e.target.value }))}
              className="h-7 w-36 text-xs"
              data-testid="input-timeline-domain-filter"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ScrollArea className="h-[420px]">
            {timelineLoading ? (
              <div className="p-6 text-sm text-muted-foreground text-center">Loading timeline…</div>
            ) : timeline.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No timeline events found. Run the heartbeat to populate the timeline.
              </div>
            ) : (
              <div className="divide-y">
                {timeline.map((entry: any) => (
                  <div key={entry.id}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                    data-testid={`timeline-entry-${entry.id}`}>
                    <div className="flex-shrink-0 mt-0.5">
                      {actionTypeIcon(entry.actionType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-foreground leading-tight">{entry.summary}</span>
                        {entry.communicationDomain && (
                          <Badge variant="outline" className="text-[10px] h-3.5 px-1">{entry.communicationDomain}</Badge>
                        )}
                      </div>
                      {entry.decisionReason && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{entry.decisionReason}</div>
                      )}
                      {entry.errorMessage && (
                        <div className="text-[11px] text-red-500 mt-0.5 font-mono">{entry.errorMessage}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">{entry.agentName}</span>
                        {entry.relatedEntityType && (
                          <span className="text-[10px] text-muted-foreground">• {entry.relatedEntityType}:{entry.relatedEntityId?.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor(entry.actionStatus)}`}>
                        {entry.actionStatus}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(entry.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Agent Quality Risks */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="h-4 w-4 text-blue-500" />
              Agent Quality &amp; Trust
            </CardTitle>
            <a href="/admin/agent-quality" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
              Full Dashboard <ArrowRight className="h-3 w-3" />
            </a>
          </div>
          <CardDescription className="text-xs">30-day rolling trust scores and risk signals across all agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!agentQualityRisks ? (
            <p className="text-xs text-muted-foreground">Loading quality signals…</p>
          ) : (
            <>
              {agentQualityRisks.rejectionSpikeAgents?.length > 0 && (
                <div className="space-y-1.5">
                  {agentQualityRisks.rejectionSpikeAgents.map((a: any) => (
                    <div key={a.agentName} className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
                      <ShieldAlert className="h-3 w-3 text-red-500 shrink-0" />
                      <span className="font-medium text-red-700 dark:text-red-400">Rejection spike — {a.agentName.replace(/_/g, " ")}</span>
                      <span className="text-red-500 ml-auto">{a.rejectionRate != null ? `${Math.round(Number(a.rejectionRate) * 100)}% rejection` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              {agentQualityRisks.decliningAgents?.length > 0 && (
                <div className="space-y-1.5">
                  {agentQualityRisks.decliningAgents.map((a: any) => (
                    <div key={a.agentName} className="flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                      <TrendingUp className="h-3 w-3 text-amber-500 shrink-0 rotate-180" />
                      <span className="font-medium text-amber-700 dark:text-amber-400">Declining — {a.agentName.replace(/_/g, " ")}</span>
                      <span className="text-amber-500 ml-auto">Δ {Number(a.scoreDelta).toFixed(1)} pts</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                {agentQualityRisks.bestAgent && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Best: <strong className="text-foreground">{agentQualityRisks.bestAgent.agentName.replace(/_/g, " ")}</strong> ({Number(agentQualityRisks.bestAgent.score ?? 0).toFixed(1)})
                  </span>
                )}
                {agentQualityRisks.worstAgent && (
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3 text-red-400" />
                    Needs work: <strong className="text-foreground">{agentQualityRisks.worstAgent.agentName.replace(/_/g, " ")}</strong> ({Number(agentQualityRisks.worstAgent.score ?? 0).toFixed(1)})
                  </span>
                )}
              </div>
              {!agentQualityRisks.hasRisks && !agentQualityRisks.bestAgent && (
                <p className="text-xs text-muted-foreground">No quality data yet — open the Agent Quality dashboard and click "Recompute Scores".</p>
              )}
              {!agentQualityRisks.hasRisks && agentQualityRisks.bestAgent && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> All agents within healthy quality ranges</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Admin Audit Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-purple-500" />
            Admin Action Audit Log
          </CardTitle>
          <CardDescription className="text-xs">Every human approval, rejection, and system change — last 7 days</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-64">
            {!auditData?.entries?.length ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No admin actions recorded yet.</div>
            ) : (
              <div className="divide-y">
                {auditData.entries.map((entry: any) => (
                  <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20"
                    data-testid={`audit-entry-${entry.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{entry.actionType}</span>
                        {entry.targetTable && (
                          <Badge variant="outline" className="text-[10px] h-3.5 px-1">{entry.targetTable}</Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {entry.adminEmail || entry.adminUserId} • {entry.ipAddress ?? "—"}
                      </div>
                      {entry.notes && <div className="text-[11px] text-muted-foreground">{entry.notes}</div>}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex-shrink-0">{fmtTime(entry.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
