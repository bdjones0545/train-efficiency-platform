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
  XCircle, ChevronRight, Calendar, Users, Target, Settings
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useOrgId(): string {
  return (window as any).__orgId ?? "";
}

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
  const orgId = useOrgId();

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

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/run?orgId=${orgId}`),
    onSuccess: () => {
      toast({ title: "Heartbeat cycle started", description: "CEO Heartbeat is running now." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
      queryClient.invalidateQueries({ queryKey: timelineQKey });
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

      {/* System Status Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Last Heartbeat</div>
            <div className="font-medium text-sm">{lastRun ? fmtTime(lastRun.startedAt) : "Never"}</div>
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
            <div className="font-medium text-sm">{status?.nextHeartbeatAt ? fmtTime(status.nextHeartbeatAt) : "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">Every 30 minutes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Agents Coordinated</div>
            <div className="font-bold text-xl">{lastRun?.agentsCoordinated ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">{lastRun?.actionsEvaluated ?? 0} actions evaluated</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Errors (last run)</div>
            <div className={`font-bold text-xl ${(lastRun?.errorsEncountered ?? 0) > 0 ? "text-red-500" : "text-green-600"}`}>
              {lastRun?.errorsEncountered ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{lastRun?.actionsPendingApproval ?? 0} pending approval</div>
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
