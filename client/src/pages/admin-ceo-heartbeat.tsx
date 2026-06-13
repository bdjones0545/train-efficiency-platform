import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson, parseApiResponse} from "@/lib/api-helpers";
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
  ArrowRight, Star, Shield, Sparkles, X, Timer, Lightbulb, Cpu, Layers
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
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [localLastRun, setLocalLastRun] = useState<any>(null);

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
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/status?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const { data: healthData } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/health", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/health?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const { data: prioritiesData, isLoading: prioritiesLoading } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/priorities", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/priorities?orgId=${encodeURIComponent(orgId)}`),
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
      return fetchJson(`/api/admin/ceo-heartbeat/timeline?${params}`);
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const { data: auditData } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/audit-log", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/audit-log?orgId=${encodeURIComponent(orgId)}`),
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

  const { data: dlqSummary } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/dead-letter-summary", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/dead-letter-summary?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const { data: ledgerHealth } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/ledger-health", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/ledger-health?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 120_000,
  });

  const { data: lockContention } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/lock-contention", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/lock-contention?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const { data: approvalRaceMetrics } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/approval-race-metrics", orgId],
    queryFn: () => fetchJson(`/api/admin/ceo-heartbeat/approval-race-metrics?orgId=${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const { data: hermesStats, isLoading: hermesLoading } = useQuery<any>({
    queryKey: ["/api/hermes/stats"],
    refetchInterval: 120_000,
  });

  const { data: execMetrics } = useQuery<any>({
    queryKey: ["/api/executions/metrics"],
    refetchInterval: 120_000,
  });

  const { data: actionCenterSummary } = useQuery<any>({
    queryKey: ["/api/action-center/summary"],
    refetchInterval: 120_000,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const orgQs = orgId ? `?orgId=${orgId}` : "";

  const runMutation = useMutation({
    mutationFn: () => {
      const isFirst = !status?.lastRun && !localLastRun;
      return apiRequest("POST", `/api/admin/ceo-heartbeat/run${orgQs}`)
        .then(r => parseApiResponse<any>(r))
        .then((json: any) => ({ ...json, _isFirst: isFirst }));
    },
    onSuccess: (data: any) => {
      const wasFirst = data?._isFirst ?? false;
      const runRecord = data?.run ?? null;
      const wasLockBlocked = !data?.success && (data?.errors ?? []).some((e: string) => e.includes("Lock already held"));

      // Store the completed run record immediately so cards render without
      // waiting for the background status refetch to complete.
      if (runRecord) setLocalLastRun(runRecord);
      if (wasFirst || runRecord) {
        setHasRunOnce(true);
        setBannerDismissed(true);
      }

      let title: string;
      let description: string;

      if (wasLockBlocked) {
        title = "Heartbeat already running";
        description = "A heartbeat cycle just completed. Refreshing latest results…";
      } else if (runRecord?.status === "completed") {
        title = wasFirst ? "CEO Heartbeat initialized successfully." : "Heartbeat cycle complete";
        description = `${runRecord.agentsCoordinated ?? 0} agents coordinated · ${runRecord.errorsEncountered ?? 0} error(s) · ${fmtMs(runRecord.durationMs)}`;
      } else {
        title = "Heartbeat cycle started";
        description = wasFirst ? "Your operational baseline has been established." : "CEO Heartbeat is running now.";
      }

      toast({ title, description });

      // Refetch immediately so background data catches up.
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/health", orgId] });
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/priorities", orgId] });
      queryClient.refetchQueries({ queryKey: timelineQKey });
      queryClient.refetchQueries({ queryKey: ["/api/reliability/executive-summary"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/pause${orgQs}`).then(r => parseApiResponse<any>(r)),
    onSuccess: () => {
      toast({ title: "Heartbeat paused", description: "Automation will not auto-execute until resumed." });
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/resume${orgQs}`).then(r => parseApiResponse<any>(r)),
    onSuccess: () => {
      toast({ title: "Heartbeat resumed", description: "CEO Heartbeat is active again." });
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/status", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/retry-failed${orgQs}`).then(r => parseApiResponse<any>(r)),
    onSuccess: (data: any) => {
      toast({ title: "Jobs retried", description: `${data?.retried ?? 0} failed jobs queued for retry.` });
      queryClient.refetchQueries({ queryKey: timelineQKey });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const recalcMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/ceo-heartbeat/recalculate-priorities${orgQs}`).then(r => parseApiResponse<any>(r)),
    onSuccess: () => {
      toast({ title: "Priorities recalculated" });
      queryClient.refetchQueries({ queryKey: ["/api/admin/ceo-heartbeat/priorities", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Prefer localLastRun (set immediately from mutation response) over the
  // potentially-stale cached status query value.
  const lastRun = localLastRun ?? status?.lastRun ?? null;
  const health = healthData ?? {};
  const priorities = prioritiesData?.priorities ?? [];
  const timeline = timelineData?.entries ?? [];
  const isPaused = status?.isPaused ?? false;
  const isRunning = status?.isRunning ?? false;
  const isInitializing = runMutation.isPending;
  const hasNeverRun = !!orgId && !statusLoading && !lastRun && !hasRunOnce && !isInitializing;
  const showOnboardingBanner = hasNeverRun && !bannerDismissed;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto overflow-x-hidden pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-indigo-500 flex-shrink-0" />
            CEO Heartbeat
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Unified orchestration layer — coordinates all agents, approvals, and outcomes from one center
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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

      {/* ── First-Run Onboarding Banner ── */}
      {showOnboardingBanner && (
        <Card className="border-l-4 border-l-indigo-500 bg-indigo-500/5" data-testid="card-onboarding-banner">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">
                    Welcome to CEO Heartbeat
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                    CEO Heartbeat monitors agents, approvals, workflows, and operational health for your organization.
                    The first heartbeat establishes your operational baseline and coordinates all active agents.
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" onClick={() => runMutation.mutate()}
                      disabled={runMutation.isPending || isRunning}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white"
                      data-testid="button-banner-initialize">
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      {runMutation.isPending ? "Initializing…" : "Initialize Heartbeat"}
                    </Button>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Timer className="h-3.5 w-3.5" />
                      Automatic heartbeat runs every 30 minutes
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={() => setBannerDismissed(true)}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
                data-testid="button-dismiss-banner" aria-label="Dismiss banner">
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Platform Reliability Card ── */}
      {reliabilitySummary && (
        <Card className={`border-l-4 w-full overflow-hidden ${
          reliabilitySummary.status === "operational" ? "border-l-emerald-500 bg-emerald-500/5" :
          reliabilitySummary.status === "degraded"    ? "border-l-yellow-500 bg-yellow-500/5" :
                                                        "border-l-red-500 bg-red-500/5"
        }`} data-testid="card-reliability-summary">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3 mb-3">
              <Shield className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                reliabilitySummary.status === "operational" ? "text-emerald-500" :
                reliabilitySummary.status === "degraded"    ? "text-yellow-500" : "text-red-500"
              }`} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Platform Status</span>
                  <Badge className={`text-[10px] capitalize ${
                    reliabilitySummary.status === "operational" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" :
                    reliabilitySummary.status === "degraded"    ? "bg-yellow-500/15 text-yellow-700 border-yellow-200" :
                                                                  "bg-red-500/15 text-red-700 border-red-200"
                  }`}>{reliabilitySummary.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{reliabilitySummary.recommendation}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-center">
              <div className="p-2 rounded border bg-card/50">
                <div className="text-base font-bold tabular-nums">{reliabilitySummary.uptime}%</div>
                <div className="text-[10px] text-muted-foreground">Uptime</div>
              </div>
              <div className="p-2 rounded border bg-card/50">
                <div className={`text-base font-bold tabular-nums ${reliabilitySummary.criticalAlerts > 0 ? "text-red-500" : "text-emerald-500"}`}>
                  {reliabilitySummary.criticalAlerts}
                </div>
                <div className="text-[10px] text-muted-foreground">Critical Alerts</div>
              </div>
              <div className="p-2 rounded border bg-card/50">
                <div className={`text-base font-bold tabular-nums ${reliabilitySummary.clientErrorsLastHour > 5 ? "text-orange-500" : "text-muted-foreground"}`}>
                  {reliabilitySummary.clientErrorsLastHour}
                </div>
                <div className="text-[10px] text-muted-foreground">Client Errors/hr</div>
              </div>
              <div className="p-2 rounded border bg-card/50">
                <div className="text-base font-bold tabular-nums">
                  {reliabilitySummary.healthChecksTotal > 0
                    ? `${reliabilitySummary.healthChecksPass}/${reliabilitySummary.healthChecksTotal}`
                    : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">Checks Passing</div>
              </div>
              <div className="p-2 rounded border bg-card/50">
                <div className={`text-base font-bold tabular-nums ${
                  (reliabilitySummary.dlqPending ?? 0) >= 20 ? "text-red-500" :
                  (reliabilitySummary.dlqPending ?? 0) >= 5  ? "text-yellow-500" :
                  "text-muted-foreground"
                }`}>
                  {reliabilitySummary.dlqPending ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground">DLQ Pending</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                <a href="/admin/reliability" data-testid="link-reliability-dashboard">View Dashboard</a>
              </Button>
              {reliabilitySummary.criticalAlerts > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-orange-600 border-orange-300 hover:bg-orange-50"
                  data-testid="button-resolve-stale-alerts"
                  onClick={async () => {
                    try {
                      const r = await fetch("/api/reliability/resolve-all-alerts", { method: "POST" });
                      const d = await r.json();
                      toast({ title: "Stale alerts resolved", description: `${d.resolved ?? 0} alert(s) cleared.` });
                      queryClient.refetchQueries({ queryKey: ["/api/reliability/executive-summary"] });
                    } catch {
                      toast({ title: "Error", description: "Could not resolve alerts.", variant: "destructive" });
                    }
                  }}
                >
                  Resolve {reliabilitySummary.criticalAlerts} Stale Alert{reliabilitySummary.criticalAlerts !== 1 ? "s" : ""}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Execution Safeguard Signals ── */}
      {(dlqSummary || ledgerHealth || lockContention || approvalRaceMetrics) && (
        <Card className={`border-l-4 w-full overflow-hidden ${
          (dlqSummary?.severity === "critical" || ledgerHealth?.severity === "critical" || lockContention?.severity === "critical" || approvalRaceMetrics?.severity === "critical")
            ? "border-l-red-500 bg-red-500/5"
            : (dlqSummary?.severity === "warning" || ledgerHealth?.severity === "warning" || lockContention?.severity === "warning" || approvalRaceMetrics?.severity === "warning")
            ? "border-l-yellow-500 bg-yellow-500/5"
            : "border-l-emerald-500 bg-emerald-500/5"
        }`} data-testid="card-safeguard-signals">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-semibold">Execution Safeguard Signals</span>
              <span className="text-xs text-muted-foreground">— live idempotency &amp; concurrency health</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* DLQ */}
              <div className={`p-2 rounded border text-center ${
                dlqSummary?.severity === "critical" ? "border-red-300 bg-red-50 dark:bg-red-950/30" :
                dlqSummary?.severity === "warning"  ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                "border-border bg-card/50"
              }`} data-testid="signal-dlq">
                <div className={`text-lg font-bold tabular-nums ${
                  (dlqSummary?.total ?? 0) > 0 ? "text-red-500" : "text-emerald-500"
                }`}>{dlqSummary?.total ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">Dead-Letter Queue</div>
                {(dlqSummary?.finalFailed ?? 0) > 0 && (
                  <div className="text-[9px] text-red-500 mt-0.5">{dlqSummary.finalFailed} final-failed</div>
                )}
              </div>
              {/* Ledger drift */}
              <div className={`p-2 rounded border text-center ${
                ledgerHealth?.severity === "critical" ? "border-red-300 bg-red-50 dark:bg-red-950/30" :
                ledgerHealth?.severity === "warning"  ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                "border-border bg-card/50"
              }`} data-testid="signal-ledger-drift">
                <div className={`text-lg font-bold tabular-nums ${
                  (ledgerHealth?.drifters ?? 0) > 0 ? "text-red-500" : "text-emerald-500"
                }`}>{ledgerHealth?.drifters ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">Ledger Drifters</div>
                {(ledgerHealth?.maxDriftCents ?? 0) > 0 && (
                  <div className="text-[9px] text-red-500 mt-0.5">max {ledgerHealth.maxDriftCents}¢ off</div>
                )}
              </div>
              {/* Lock contention */}
              <div className={`p-2 rounded border text-center ${
                lockContention?.severity === "critical" ? "border-red-300 bg-red-50 dark:bg-red-950/30" :
                lockContention?.severity === "warning"  ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                "border-border bg-card/50"
              }`} data-testid="signal-lock-contention">
                <div className={`text-lg font-bold tabular-nums ${
                  (lockContention?.count ?? 0) >= 3 ? "text-yellow-500" :
                  (lockContention?.count ?? 0) > 0  ? "text-muted-foreground" : "text-emerald-500"
                }`}>{lockContention?.count ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">Lock Blocks (24h)</div>
                {(lockContention?.count ?? 0) >= 10 && (
                  <div className="text-[9px] text-red-500 mt-0.5">high contention</div>
                )}
              </div>
              {/* Approval races */}
              <div className={`p-2 rounded border text-center ${
                approvalRaceMetrics?.severity === "critical" ? "border-red-300 bg-red-50 dark:bg-red-950/30" :
                approvalRaceMetrics?.severity === "warning"  ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                "border-border bg-card/50"
              }`} data-testid="signal-approval-races">
                <div className={`text-lg font-bold tabular-nums ${
                  (approvalRaceMetrics?.count ?? 0) >= 2 ? "text-yellow-500" :
                  (approvalRaceMetrics?.count ?? 0) > 0  ? "text-muted-foreground" : "text-emerald-500"
                }`}>{approvalRaceMetrics?.count ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">Approval Races (24h)</div>
                {(approvalRaceMetrics?.count ?? 0) >= 5 && (
                  <div className="text-[9px] text-red-500 mt-0.5">UI debounce needed</div>
                )}
              </div>
            </div>
            {/* Inline alerts for non-zero signals */}
            {((dlqSummary?.finalFailed ?? 0) > 0 || (ledgerHealth?.drifters ?? 0) > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(dlqSummary?.finalFailed ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded px-2 py-0.5" data-testid="alert-dlq-final-failed">
                    <AlertTriangle className="h-3 w-3" />
                    {dlqSummary.finalFailed} job(s) permanently failed — review Dead-Letter Queue
                  </div>
                )}
                {(ledgerHealth?.drifters ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded px-2 py-0.5" data-testid="alert-ledger-drift">
                    <AlertTriangle className="h-3 w-3" />
                    {ledgerHealth.drifters} wallet(s) have balance drift — run repair via Billing dashboard
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* System Status Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1 — Last Heartbeat */}
        <Card data-testid="card-last-heartbeat" className={hasNeverRun ? "border-indigo-200 dark:border-indigo-800" : ""}>
          <CardContent className="pt-4 pb-3">
            {hasNeverRun ? (
              <>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Heartbeat Ready</div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug mb-2.5">
                  Your organization has not completed its first heartbeat cycle yet.
                </p>
                <Button size="sm" className="h-7 text-xs w-full" onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending || isRunning} data-testid="button-first-run-card">
                  <Play className="h-3 w-3 mr-1" />
                  {runMutation.isPending ? "Initializing…" : "Run First Heartbeat"}
                </Button>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-1">Last Heartbeat</div>
                <div className="font-medium text-sm">{fmtTime(lastRun?.startedAt)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {fmtMs(lastRun?.durationMs)} • <span className={lastRun?.status === "completed" ? "text-green-600" : "text-red-500"}>{lastRun?.status}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Next Heartbeat / Automatic indicator */}
        <Card data-testid="card-next-heartbeat">
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Next Heartbeat</div>
            <div className="font-medium text-sm">{status?.nextHeartbeatAt ? fmtTime(status.nextHeartbeatAt) : "Automatic"}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Timer className="h-3 w-3 text-indigo-400" />
              {hasNeverRun
                ? <span className="text-indigo-600 dark:text-indigo-400 font-medium">Auto-schedule active</span>
                : "Runs every 30 minutes"}
            </div>
          </CardContent>
        </Card>

        {/* Card 3 — Agents Coordinated */}
        <Card data-testid="card-agents-coordinated" className={hasNeverRun ? "border-dashed" : ""}>
          <CardContent className="pt-4 pb-3">
            {hasNeverRun ? (
              <>
                <div className="text-xs text-muted-foreground mb-1">Agents Coordinated</div>
                <div className="font-medium text-sm text-indigo-600 dark:text-indigo-400">Waiting For First Run</div>
                <div className="text-xs text-muted-foreground mt-1 leading-snug">
                  The first heartbeat will discover and coordinate available agents.
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-1">Agents Coordinated</div>
                <div className="font-bold text-xl">{lastRun?.agentsCoordinated ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">{`${lastRun?.actionsEvaluated ?? 0} actions evaluated`}</div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 4 — Errors */}
        <Card data-testid="card-errors-last-run" className={hasNeverRun ? "border-dashed" : ""}>
          <CardContent className="pt-4 pb-3">
            {hasNeverRun ? (
              <>
                <div className="text-xs text-muted-foreground mb-1">Errors (last run)</div>
                <div className="font-medium text-sm text-muted-foreground">No Runs Yet</div>
                <div className="text-xs text-muted-foreground mt-1 leading-snug">
                  No heartbeat cycles have been executed.
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-1">Errors (last run)</div>
                <div className={`font-bold text-xl ${(lastRun?.errorsEncountered ?? 0) > 0 ? "text-red-500" : "text-green-600"}`}>
                  {lastRun?.errorsEncountered ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{`${lastRun?.actionsPendingApproval ?? 0} pending approval`}</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Manual Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Settings className="h-4 w-4" />Manual Controls</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
          <Button size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || isRunning}
            data-testid="button-run-heartbeat"
            className={`w-full sm:w-auto text-sm whitespace-normal ${hasNeverRun ? "bg-indigo-600 hover:bg-indigo-700 text-white" : ""}`}>
            {hasNeverRun
              ? <Sparkles className="h-4 w-4 mr-1 flex-shrink-0" />
              : <Play className="h-4 w-4 mr-1 flex-shrink-0" />}
            {isInitializing
              ? "Initializing heartbeat…"
              : runMutation.isPending
                ? "Running…"
                : (hasNeverRun ? "Initialize Heartbeat" : "Run Heartbeat Now")}
          </Button>
          {isPaused ? (
            <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending || isInitializing} data-testid="button-resume-automation"
              className="w-full sm:w-auto text-sm">
              <Play className="h-4 w-4 mr-1 flex-shrink-0" />
              Resume Automation
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending || isInitializing} data-testid="button-pause-automation"
              className="w-full sm:w-auto text-sm">
              <Pause className="h-4 w-4 mr-1 flex-shrink-0" />
              Pause All Automation
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending || isInitializing} data-testid="button-retry-failed"
            className="w-full sm:w-auto text-sm">
            <RotateCcw className="h-4 w-4 mr-1 flex-shrink-0" />
            {retryMutation.isPending ? "Retrying…" : "Retry Failed Jobs"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending || isInitializing} data-testid="button-recalculate-priorities"
            className="w-full sm:w-auto text-sm">
            <Brain className="h-4 w-4 mr-1 flex-shrink-0" />
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

      {/* ── Hermes Intelligence Engine ─────────────────────────────────────── */}
      <Card className="border-l-4 border-l-violet-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-violet-500" />
                Hermes Intelligence Engine
              </CardTitle>
              <CardDescription className="text-xs">
                Active learning agent — analyzes signals and generates prioritized recommendations
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {hermesStats && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    hermesStats.lastRunAt
                      ? "border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-400"
                      : "border-muted-foreground text-muted-foreground"
                  }`}
                  data-testid="badge-hermes-status"
                >
                  {hermesStats.lastRunAt ? "✓ Active" : "Not yet run"}
                </Badge>
              )}
              <a
                href="/admin/ceo-heartbeat"
                className="text-xs text-violet-500 hover:underline flex items-center gap-0.5"
                data-testid="link-hermes-trigger"
                onClick={(e) => { e.preventDefault(); runMutation.mutate(); }}
              >
                Run now <Zap className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hermesLoading ? (
            <div className="text-xs text-muted-foreground">Loading Hermes stats…</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Last Run */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-last-run">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Last Run</span>
                </div>
                <div className="text-xs font-semibold text-foreground leading-tight">
                  {hermesStats?.lastRunAt
                    ? (() => {
                        const mins = Math.round((Date.now() - new Date(hermesStats.lastRunAt).getTime()) / 60_000);
                        if (mins < 60) return `${mins}m ago`;
                        return `${Math.round(mins / 60)}h ago`;
                      })()
                    : "Never"}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {hermesStats?.lastRunAt ? new Date(hermesStats.lastRunAt).toLocaleTimeString() : "—"}
                </div>
              </div>

              {/* Signals Processed */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-signals">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Signals (24h)</span>
                </div>
                <div className="text-lg font-bold text-violet-600 dark:text-violet-400">
                  {hermesStats?.signalsProcessed24h ?? "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">analyzed</div>
              </div>

              {/* Recommendations Generated */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-recommendations">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Lightbulb className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Recommendations</span>
                </div>
                <div className="text-lg font-bold text-foreground">
                  {hermesStats?.recommendations24h ?? "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {hermesStats?.queuedForReview24h != null
                    ? `${hermesStats.queuedForReview24h} queued`
                    : "last 24h"}
                </div>
              </div>

              {/* Average Confidence */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-confidence">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Target className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Avg Confidence</span>
                </div>
                <div className={`text-lg font-bold ${
                  (hermesStats?.confidenceAverage ?? 0) >= 80
                    ? "text-green-600 dark:text-green-400"
                    : (hermesStats?.confidenceAverage ?? 0) >= 60
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}>
                  {hermesStats?.confidenceAverage != null
                    ? `${hermesStats.confidenceAverage}%`
                    : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">per recommendation</div>
              </div>

              {/* Failures 24h */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-failures">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Failures (24h)</span>
                </div>
                <div className={`text-lg font-bold ${
                  (hermesStats?.failures24h ?? 0) > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400"
                }`}>
                  {hermesStats?.failures24h ?? "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">engine errors</div>
              </div>

              {/* Success Rate */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid="hermes-card-success-rate">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Success Rate</span>
                </div>
                <div className={`text-lg font-bold ${
                  (hermesStats?.successRate ?? 0) >= 70
                    ? "text-green-600 dark:text-green-400"
                    : (hermesStats?.successRate ?? 0) >= 40
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}>
                  {hermesStats?.successRate != null
                    ? `${hermesStats.successRate}%`
                    : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">approval rate (7d)</div>
              </div>
            </div>
          )}

          {!hermesLoading && !hermesStats?.lastRunAt && (
            <div className="mt-3 text-xs text-muted-foreground bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-md px-3 py-2">
              <Lightbulb className="h-3 w-3 text-violet-500 inline mr-1" />
              Hermes will run automatically on the next CEO Heartbeat cycle. Click "Run now" to trigger immediately.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Execution Engine */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              Execution Engine
            </CardTitle>
            <a href="/admin/action-center" className="text-xs text-green-500 hover:underline flex items-center gap-1">
              Action Center <ArrowRight className="h-3 w-3" />
            </a>
          </div>
          <CardDescription className="text-xs">Unified approval queue · execution outcomes · cross-agent coordination</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              {
                label: "Pending Actions",
                value: actionCenterSummary?.pending?.total ?? "—",
                color: "text-yellow-600 dark:text-yellow-400",
                testId: "heartbeat-exec-pending",
              },
              {
                label: "Total Executed",
                value: execMetrics?.totalExecutions ?? "—",
                color: "text-primary",
                testId: "heartbeat-exec-total",
              },
              {
                label: "Success Rate",
                value: execMetrics?.successRate != null ? `${execMetrics.successRate}%` : "—",
                color: execMetrics?.successRate >= 80 ? "text-green-600 dark:text-green-400" : execMetrics?.successRate >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400",
                testId: "heartbeat-exec-success-rate",
              },
              {
                label: "Open Conflicts",
                value: actionCenterSummary?.conflicts?.open ?? "—",
                color: (actionCenterSummary?.conflicts?.open ?? 0) > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400",
                testId: "heartbeat-exec-conflicts",
              },
            ].map((s) => (
              <div key={s.label} className="bg-muted/30 rounded-lg p-3 space-y-1" data-testid={s.testId}>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {execMetrics?.byType && Object.keys(execMetrics.byType).length > 0 && (
            <div className="space-y-1">
              {Object.entries(execMetrics.byType as Record<string, number>)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 4)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
                    <span className="text-muted-foreground capitalize">{type.replace(/_/g, " ")}</span>
                    <span className="font-semibold">{count as number} executions</span>
                  </div>
                ))}
            </div>
          )}
          {actionCenterSummary?.coordination?.duplicatesPrevented > 0 && (
            <div className="mt-2 text-xs text-muted-foreground bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
              <CheckCircle2 className="h-3 w-3 text-green-500 inline mr-1" />
              {actionCenterSummary.coordination.duplicatesPrevented} duplicate actions prevented by cross-agent coordination
            </div>
          )}
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
