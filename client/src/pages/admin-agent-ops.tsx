import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw,
  Database, Mail, MessageSquare, Activity, Zap, ShieldAlert,
  GitBranch, RotateCcw, CheckSquare, ExternalLink, AlertCircle,
  Info, Timer, Lock, CircleDot, Play, Link2, Link2Off, CreditCard, Calendar, Inbox, ArrowRight,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { RecentAgentActivity } from "@/components/recent-agent-activity";

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthCheck = {
  configured?: boolean;
  reachable?: boolean;
  active?: boolean;
  lastRunAt?: string | null;
  label: string;
};

type HealthData = {
  sendgrid: HealthCheck;
  twilio: HealthCheck;
  database: HealthCheck;
  workflowRunner: HealthCheck;
  businessBrainCron: HealthCheck;
  revenueAgentCron: HealthCheck;
  failedJobsLast24h: number;
  pendingApprovalsCount: number;
};

type Alert = {
  level: "error" | "warning" | "info";
  message: string;
  type: string;
  count?: number;
};

type AlertsData = { alerts: Alert[]; critical: number };

type FailedToolCall = {
  id: string;
  orgId: string;
  agentName: string;
  toolName: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  inputSummary: string | null;
  proposedInput: Record<string, any>;
  reason: string | null;
  error: string | null;
  status: string;
  retryCount: number;
  createdAt: string;
  executedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  sendAttempts: number;
};

type FailedWorkflow = {
  id: string;
  workflowType: string;
  displayName: string;
  status: string;
  entityName: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

type StuckWorkflow = FailedWorkflow & {
  lockedAt: string | null;
  nextCheckAt: string | null;
  stuckReason: "locked_too_long" | "confirmation_overdue" | "response_overdue" | "unknown";
};

type DrawerItem =
  | { kind: "tool-call"; data: FailedToolCall }
  | { kind: "workflow"; data: FailedWorkflow | StuckWorkflow };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthStatus(check: HealthCheck): "ok" | "warn" | "err" {
  if (check.reachable !== undefined) return check.reachable ? "ok" : "err";
  if (check.configured !== undefined) return check.configured ? "ok" : "warn";
  if (check.active !== undefined) return check.active ? "ok" : "warn";
  return "ok";
}

function HealthDot({ status }: { status: "ok" | "warn" | "err" }) {
  if (status === "ok") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />;
  if (status === "warn") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" />;
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />;
}

function alertIcon(level: string) {
  if (level === "error") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (level === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-400 shrink-0" />;
}

function alertBg(level: string) {
  if (level === "error") return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900";
  if (level === "warning") return "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-900";
  return "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900";
}

function stuckReasonLabel(r: string) {
  if (r === "locked_too_long") return "Locked > 2 min";
  if (r === "confirmation_overdue") return "Confirmation > 24h";
  if (r === "response_overdue") return "Response overdue";
  return "Stuck";
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    pending_confirmation: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    waiting_confirmation: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    waiting_response: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    success: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ts(val: string | null | undefined) {
  if (!val) return "—";
  try {
    return formatDistanceToNow(new Date(val), { addSuffix: true });
  } catch {
    return val;
  }
}

function fmt(val: string | null | undefined) {
  if (!val) return "—";
  try {
    return format(new Date(val), "MMM d, yyyy HH:mm");
  } catch {
    return val;
  }
}

// ─── Audit Detail Drawer ──────────────────────────────────────────────────────

function AuditDrawer({
  item,
  onClose,
  onResolve,
  onRetry,
  resolving,
  retrying,
}: {
  item: DrawerItem | null;
  onClose: () => void;
  onResolve: (id: string) => void;
  onRetry: (id: string) => void;
  resolving: boolean;
  retrying: boolean;
}) {
  if (!item) return null;

  return (
    <Sheet open={!!item} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="drawer-audit-detail">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            {item.kind === "tool-call" ? <Zap className="h-5 w-5 text-yellow-500" /> : <GitBranch className="h-5 w-5 text-blue-500" />}
            {item.kind === "tool-call" ? "Tool Call Detail" : "Workflow Detail"}
          </SheetTitle>
          <SheetDescription>
            {item.kind === "tool-call" ? `Tool: ${item.data.toolName}` : `Type: ${(item.data as FailedWorkflow).displayName}`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="space-y-4 pr-2">
            {item.kind === "tool-call" && (() => {
              const d = item.data as FailedToolCall;
              return (
                <>
                  <Section label="Overview">
                    <Row label="Agent" value={d.agentName} />
                    <Row label="Tool" value={d.toolName} />
                    <Row label="Status" value={statusBadge(d.status)} raw />
                    {d.targetName && <Row label="Target" value={`${d.targetName}${d.targetType ? ` (${d.targetType})` : ""}`} />}
                    {d.inputSummary && <Row label="Summary" value={d.inputSummary} />}
                    {d.reason && <Row label="Reason" value={d.reason} />}
                  </Section>

                  {d.error && (
                    <Section label="Error">
                      <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-all" data-testid="text-drawer-error">
                        {d.error}
                      </div>
                    </Section>
                  )}

                  <Section label="Proposed Input">
                    <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
                      {JSON.stringify(d.proposedInput, null, 2)}
                    </pre>
                  </Section>

                  <Section label="Timestamps">
                    <Row label="Created" value={fmt(d.createdAt)} />
                    <Row label="Executed" value={fmt(d.executedAt)} />
                    <Row label="Resolved" value={d.resolvedAt ? `${fmt(d.resolvedAt)} by ${d.resolvedBy}` : "—"} />
                  </Section>

                  <Section label="Counters">
                    <Row label="Retry count" value={String(d.retryCount ?? 0)} />
                    <Row label="Send attempts" value={String(d.sendAttempts ?? 0)} />
                  </Section>

                  <div className="flex gap-2 pt-2">
                    {d.status === "failed" && !d.resolvedAt && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRetry(d.id)}
                          disabled={retrying}
                          data-testid={`button-retry-${d.id}`}
                          className="flex-1"
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          {retrying ? "Retrying…" : "Retry"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResolve(d.id)}
                          disabled={resolving}
                          data-testid={`button-resolve-${d.id}`}
                          className="flex-1"
                        >
                          <CheckSquare className="h-4 w-4 mr-1" />
                          {resolving ? "Resolving…" : "Mark Resolved"}
                        </Button>
                      </>
                    )}
                    {d.resolvedAt && (
                      <Badge variant="outline" className="text-green-600 border-green-300">
                        <CheckCircle className="h-3 w-3 mr-1" /> Resolved {ts(d.resolvedAt)}
                      </Badge>
                    )}
                  </div>
                </>
              );
            })()}

            {item.kind === "workflow" && (() => {
              const d = item.data as StuckWorkflow;
              return (
                <>
                  <Section label="Overview">
                    <Row label="Workflow" value={d.displayName || d.workflowType} />
                    <Row label="Status" value={statusBadge(d.status)} raw />
                    {d.entityName && <Row label="Entity" value={d.entityName} />}
                    {d.stuckReason && <Row label="Stuck reason" value={stuckReasonLabel(d.stuckReason)} />}
                  </Section>

                  {d.error && (
                    <Section label="Error">
                      <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-all" data-testid="text-drawer-workflow-error">
                        {d.error}
                      </div>
                    </Section>
                  )}

                  <Section label="Timestamps">
                    <Row label="Created" value={fmt(d.createdAt)} />
                    <Row label="Completed" value={fmt(d.completedAt)} />
                    {d.lockedAt && <Row label="Locked at" value={fmt(d.lockedAt)} />}
                    {d.nextCheckAt && <Row label="Next check" value={fmt(d.nextCheckAt)} />}
                  </Section>

                  <div className="pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                      data-testid={`button-open-workflow-${d.id}`}
                    >
                      <a href="/admin/workflows" target="_self">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open in Workflows
                      </a>
                    </Button>
                  </div>
                </>
              );
            })()}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, raw }: { label: string; value: React.ReactNode; raw?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      {raw ? value : <span className="text-right truncate max-w-xs">{value as string}</span>}
    </div>
  );
}

// ─── Health Cards ─────────────────────────────────────────────────────────────

function HealthCard({ icon: Icon, label, check }: {
  icon: React.ElementType;
  label: string;
  check: HealthCheck | undefined;
}) {
  const st = check ? healthStatus(check) : "warn";
  return (
    <Card className="p-4 flex items-center gap-3" data-testid={`card-health-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className={`p-2 rounded-md ${st === "ok" ? "bg-green-100 dark:bg-green-900/30" : st === "warn" ? "bg-yellow-100 dark:bg-yellow-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
        <Icon className={`h-4 w-4 ${st === "ok" ? "text-green-600 dark:text-green-400" : st === "warn" ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{check?.label ?? "Checking…"}</p>
        {check?.lastRunAt && (
          <p className="text-xs text-muted-foreground">{ts(check.lastRunAt)}</p>
        )}
      </div>
      <HealthDot status={st} />
    </Card>
  );
}

// ─── Failed Tool Call Row ─────────────────────────────────────────────────────

function ToolCallRow({ call, onSelect }: { call: FailedToolCall; onSelect: () => void }) {
  return (
    <div
      className="flex items-start justify-between gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={onSelect}
      data-testid={`row-tool-call-${call.id}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5">
          {call.resolvedAt
            ? <CheckCircle className="h-4 w-4 text-green-500" />
            : <XCircle className="h-4 w-4 text-red-500" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" data-testid={`text-tool-name-${call.id}`}>{call.toolName}</p>
          <p className="text-xs text-muted-foreground truncate">{call.agentName} · {call.targetName ?? "no target"}</p>
          {call.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2">{call.error}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        {statusBadge(call.status)}
        <p className="text-xs text-muted-foreground">{ts(call.createdAt)}</p>
        {call.resolvedAt && <p className="text-xs text-green-600 dark:text-green-400">resolved</p>}
      </div>
    </div>
  );
}

// ─── Workflow Row ─────────────────────────────────────────────────────────────

function WorkflowRow({ run, onSelect, stuckReason }: {
  run: FailedWorkflow | StuckWorkflow;
  onSelect: () => void;
  stuckReason?: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={onSelect}
      data-testid={`row-workflow-${run.id}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5">
          {run.status === "failed"
            ? <XCircle className="h-4 w-4 text-red-500" />
            : <Lock className="h-4 w-4 text-yellow-500" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{run.displayName || run.workflowType}</p>
          <p className="text-xs text-muted-foreground truncate">{run.entityName ?? "no entity"}</p>
          {run.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2">{run.error}</p>
          )}
          {stuckReason && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">{stuckReasonLabel(stuckReason)}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        {statusBadge(run.status)}
        <p className="text-xs text-muted-foreground">{ts(run.createdAt)}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentOpsPage() {
  const { toast } = useToast();
  const [drawerItem, setDrawerItem] = useState<DrawerItem | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery<HealthData>({
    queryKey: ["/api/admin/agent-ops/health"],
    refetchInterval: 60_000,
  });

  const { data: alertsData, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery<AlertsData>({
    queryKey: ["/api/admin/agent-ops/alerts"],
    refetchInterval: 30_000,
  });

  const { data: failureQueue, isLoading: failureLoading, refetch: refetchFailure } = useQuery<{
    failedToolCalls: FailedToolCall[];
    failedWorkflows: FailedWorkflow[];
  }>({
    queryKey: ["/api/admin/agent-ops/failure-queue"],
    refetchInterval: 30_000,
  });

  const { data: stuckData, isLoading: stuckLoading, refetch: refetchStuck } = useQuery<{
    stuckWorkflows: StuckWorkflow[];
    count: number;
  }>({
    queryKey: ["/api/admin/agent-ops/stuck-workflows"],
    refetchInterval: 30_000,
  });

  const { data: pendingCalls, isLoading: pendingLoading } = useQuery<{
    calls: FailedToolCall[];
    count: number;
  }>({
    queryKey: ["/api/admin/agent-tool-calls/pending"],
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/agent-ops/tool-calls/${id}/resolve`);
      return res.json();
    },
    onSuccess: (_d, id) => {
      toast({ title: "Resolved", description: "Tool call marked as resolved." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/failure-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/health"] });
      if (drawerItem?.kind === "tool-call" && drawerItem.data.id === id) setDrawerItem(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/agent-ops/tool-calls/${id}/retry`);
      return res.json();
    },
    onSuccess: (_d, id) => {
      toast({ title: "Retried", description: "Tool call re-executed successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/failure-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-ops/health"] });
      if (drawerItem?.kind === "tool-call" && drawerItem.data.id === id) setDrawerItem(null);
    },
    onError: (e: Error) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  function refetchAll() {
    refetchHealth();
    refetchAlerts();
    refetchFailure();
    refetchStuck();
  }

  const alerts = alertsData?.alerts ?? [];
  const pendingCount = health?.pendingApprovalsCount ?? 0;
  const failedToolCount = failureQueue?.failedToolCalls?.length ?? 0;
  const failedWorkflowCount = failureQueue?.failedWorkflows?.length ?? 0;
  const stuckCount = stuckData?.count ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-agent-ops">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agent Operations Monitor</h1>
            <p className="text-sm text-muted-foreground">AI system health, failures, and stuck workflows</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll} data-testid="button-refresh-all">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Alert Strip */}
      {alertsLoading ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : alerts.length > 0 ? (
        <div className="space-y-2" data-testid="section-alert-strip">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${alertBg(a.level)}`}
              data-testid={`alert-${a.type}`}
            >
              {alertIcon(a.level)}
              <span className="font-medium flex-1">{a.message}</span>
              {(a.level === "error" || a.level === "warning") && (
                <a
                  href="/admin/attention"
                  className="text-xs underline opacity-60 hover:opacity-100 transition-opacity shrink-0"
                  data-testid="link-agent-ops-attention"
                >
                  Attention Inbox
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-sm" data-testid="alert-all-clear">
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          <span className="font-medium text-green-700 dark:text-green-300">All systems clear — no critical alerts</span>
        </div>
      )}

      {/* Attention Inbox crosslink — route user-facing failures to prioritised inbox */}
      {!alertsLoading && (failedToolCount + failedWorkflowCount + stuckCount) > 0 && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20 text-sm"
          data-testid="banner-attention-inbox-crosslink"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Inbox className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-amber-700 dark:text-amber-400 font-medium">
              {failedToolCount + failedWorkflowCount + stuckCount} failure{(failedToolCount + failedWorkflowCount + stuckCount) !== 1 ? "s" : ""} tracked in Attention Inbox
            </span>
          </div>
          <a
            href="/admin/attention"
            className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 shrink-0 transition-colors"
            data-testid="link-attention-from-agent-ops"
          >
            View <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {/* Health Grid */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">System Health</h2>
        {healthLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="grid-health">
            <HealthCard icon={Mail} label="SendGrid" check={health?.sendgrid} />
            <HealthCard icon={MessageSquare} label="Twilio SMS" check={health?.twilio} />
            <HealthCard icon={Database} label="Database" check={health?.database} />
            <HealthCard icon={GitBranch} label="Workflow Runner" check={health?.workflowRunner} />
            <HealthCard icon={Activity} label="Business Brain" check={health?.businessBrainCron} />
            <HealthCard icon={Zap} label="Revenue Agent" check={health?.revenueAgentCron} />
            <Card className="p-4 flex items-center gap-3" data-testid="card-health-failed-jobs">
              <div className={`p-2 rounded-md ${(health?.failedJobsLast24h ?? 0) === 0 ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                <XCircle className={`h-4 w-4 ${(health?.failedJobsLast24h ?? 0) === 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Failed Jobs (24h)</p>
                <p className="text-sm font-medium">{health?.failedJobsLast24h ?? 0}</p>
              </div>
              <HealthDot status={(health?.failedJobsLast24h ?? 0) === 0 ? "ok" : "err"} />
            </Card>
            <Card className="p-4 flex items-center gap-3" data-testid="card-health-pending-approvals">
              <div className={`p-2 rounded-md ${pendingCount === 0 ? "bg-green-100 dark:bg-green-900/30" : "bg-yellow-100 dark:bg-yellow-900/30"}`}>
                <Clock className={`h-4 w-4 ${pendingCount === 0 ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Pending Approvals</p>
                <p className="text-sm font-medium">{pendingCount}</p>
              </div>
              <HealthDot status={pendingCount === 0 ? "ok" : "warn"} />
            </Card>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-yellow-500 text-white text-[10px] h-4 min-w-4 px-1">{pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="failure-queue" data-testid="tab-failure-queue">
            Failures
            {(failedToolCount + failedWorkflowCount) > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-4 min-w-4 px-1">{failedToolCount + failedWorkflowCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-stuck-workflows">
            Stuck
            {stuckCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] h-4 min-w-4 px-1">{stuckCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit-trail">Audit Trail</TabsTrigger>
          <TabsTrigger value="connectors" data-testid="tab-connectors">Connectors</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4 text-center" data-testid="stat-pending-approvals">
              <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{pendingCount}</p>
              <p className="text-sm text-muted-foreground mt-1">Pending Approvals</p>
            </Card>
            <Card className="p-4 text-center" data-testid="stat-failed-total">
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">{failedToolCount + failedWorkflowCount}</p>
              <p className="text-sm text-muted-foreground mt-1">Unresolved Failures</p>
            </Card>
            <Card className="p-4 text-center" data-testid="stat-stuck-total">
              <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">{stuckCount}</p>
              <p className="text-sm text-muted-foreground mt-1">Stuck Workflows</p>
            </Card>
          </div>

          {/* Pending confirmations */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              Pending Confirmations
            </h3>
            {pendingLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : !pendingCalls?.calls?.length ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg" data-testid="text-no-pending">No pending confirmations</div>
            ) : (
              <div className="space-y-2" data-testid="list-pending-calls">
                {pendingCalls.calls.map(c => (
                  <ToolCallRow
                    key={c.id}
                    call={c}
                    onSelect={() => setDrawerItem({ kind: "tool-call", data: c })}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Failure Queue ── */}
        <TabsContent value="failure-queue" className="space-y-4 mt-4">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" />
              Failed Tool Calls
              <span className="text-xs text-muted-foreground font-normal">(unresolved)</span>
            </h3>
            {failureLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : !failureQueue?.failedToolCalls?.length ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg" data-testid="text-no-failed-tool-calls">No unresolved failed tool calls</div>
            ) : (
              <div className="space-y-2" data-testid="list-failed-tool-calls">
                {failureQueue.failedToolCalls.map(c => (
                  <ToolCallRow
                    key={c.id}
                    call={c}
                    onSelect={() => setDrawerItem({ kind: "tool-call", data: c })}
                  />
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-blue-500" />
              Failed Workflows
            </h3>
            {failureLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : !failureQueue?.failedWorkflows?.length ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg" data-testid="text-no-failed-workflows">No failed workflows</div>
            ) : (
              <div className="space-y-2" data-testid="list-failed-workflows">
                {failureQueue.failedWorkflows.map(w => (
                  <WorkflowRow
                    key={w.id}
                    run={w}
                    onSelect={() => setDrawerItem({ kind: "workflow", data: w as StuckWorkflow })}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Stuck Workflows ── */}
        <TabsContent value="stuck" className="space-y-4 mt-4">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4 text-orange-500" />
              Stuck / Blocked Workflows
            </h3>
            {stuckLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : !stuckData?.stuckWorkflows?.length ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg" data-testid="text-no-stuck-workflows">No stuck workflows detected</div>
            ) : (
              <div className="space-y-2" data-testid="list-stuck-workflows">
                {stuckData.stuckWorkflows.map(w => (
                  <WorkflowRow
                    key={w.id}
                    run={w}
                    stuckReason={w.stuckReason}
                    onSelect={() => setDrawerItem({ kind: "workflow", data: w })}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-muted bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Detection rules</p>
            <p><span className="text-orange-500 font-medium">Locked &gt; 2 min</span> — workflow run acquired a lock but never released it</p>
            <p><span className="text-orange-500 font-medium">Confirmation &gt; 24h</span> — step awaiting admin approval for over a day</p>
            <p><span className="text-orange-500 font-medium">Response overdue</span> — next_check_at passed by more than 2 hours</p>
          </div>
        </TabsContent>

        {/* ── Audit Trail ── */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          <AuditTrail
            onSelect={(c) => setDrawerItem({ kind: "tool-call", data: c })}
          />
        </TabsContent>

        {/* ── Connectors ── */}
        <TabsContent value="connectors" className="space-y-4 mt-4">
          <ConnectorsPanel />
        </TabsContent>
      </Tabs>

      {/* Detail Drawer */}
      <AuditDrawer
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
        onResolve={(id) => resolveMutation.mutate(id)}
        onRetry={(id) => retryMutation.mutate(id)}
        resolving={resolveMutation.isPending}
        retrying={retryMutation.isPending}
      />

      <RecentActivityPanel />
    </div>
  );
}

// ─── Connectors Panel ─────────────────────────────────────────────────────────

type ConnectorStatus = {
  googleCalendar: { configured: boolean; connected: boolean; email: string | null; status: string };
  stripe: { configured: boolean; connected: boolean; status: string };
};

type AgentInvoice = {
  id: string;
  stripeInvoiceId: string | null;
  clientId: string | null;
  amountCents: number | null;
  description: string | null;
  status: string | null;
  stripeInvoiceUrl: string | null;
  paidAt: string | null;
  createdAt: string | null;
};

function ConnectorsPanel() {
  const { toast } = useToast();

  const { data: connectors, isLoading: loadingConnectors, refetch: refetchConnectors } = useQuery<ConnectorStatus>({
    queryKey: ["/api/admin/connectors"],
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery<AgentInvoice[]>({
    queryKey: ["/api/admin/agent-invoices"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/connectors/google-calendar/connect");
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "Connect failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Connect failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/connectors/google-calendar");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Google Calendar disconnected" });
      refetchConnectors();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/connectors"] });
    },
    onError: (err: any) => {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  const statusBadgeConnector = (status: string) => {
    if (status === "connected") return <Badge className="bg-green-100 text-green-800 border-green-200">Connected</Badge>;
    if (status === "disconnected") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Disconnected</Badge>;
    return <Badge variant="outline" className="text-muted-foreground">Not Configured</Badge>;
  };

  return (
    <div className="space-y-6" data-testid="connectors-panel">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Google Calendar */}
        <Card className="p-5 space-y-4" data-testid="connector-google-calendar">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Google Calendar</p>
              <p className="text-xs text-muted-foreground truncate">OAuth per-org · Conflict detection · Two-way sync</p>
            </div>
            {loadingConnectors ? <Skeleton className="h-6 w-20" /> : statusBadgeConnector(connectors?.googleCalendar?.status ?? "not_configured")}
          </div>

          {connectors?.googleCalendar?.email && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2" data-testid="gcal-email">
              Connected as <span className="font-medium text-foreground">{connectors.googleCalendar.email}</span>
            </div>
          )}

          {!connectors?.googleCalendar?.configured && !loadingConnectors && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
              Set <code className="font-mono">GOOGLE_CLIENT_ID</code> and <code className="font-mono">GOOGLE_CLIENT_SECRET</code> environment variables to enable.
            </div>
          )}

          <div className="flex gap-2">
            {connectors?.googleCalendar?.connected ? (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-gcal-disconnect"
              >
                <Link2Off className="h-3.5 w-3.5 mr-1.5" />
                {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending || !connectors?.googleCalendar?.configured}
                data-testid="button-gcal-connect"
              >
                <Link2 className="h-3.5 w-3.5 mr-1.5" />
                {connectMutation.isPending ? "Opening…" : "Connect"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => refetchConnectors()} data-testid="button-connectors-refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>

        {/* Stripe */}
        <Card className="p-5 space-y-4" data-testid="connector-stripe">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
              <CreditCard className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Stripe</p>
              <p className="text-xs text-muted-foreground truncate">Real invoices · Payment attribution · Webhook resumption</p>
            </div>
            {loadingConnectors ? <Skeleton className="h-6 w-20" /> : statusBadgeConnector(connectors?.stripe?.status ?? "not_configured")}
          </div>
          <p className="text-xs text-muted-foreground">
            Stripe is configured via the Replit Stripe integration or <code className="font-mono">STRIPE_SECRET_KEY</code> environment variable.
            Agent invoices are tracked in the table below.
          </p>
        </Card>
      </div>

      {/* Agent Invoices */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Agent-Created Invoices</h3>
        {loadingInvoices ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : !invoices?.length ? (
          <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg" data-testid="no-agent-invoices">
            No agent-created invoices yet. Use the <strong>create_invoice</strong> tool to create real Stripe invoices.
          </div>
        ) : (
          <div className="space-y-2" data-testid="list-agent-invoices">
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border" data-testid={`row-invoice-${inv.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{inv.description ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.stripeInvoiceId ?? "no stripe id"} · {inv.createdAt ? format(new Date(inv.createdAt), "MMM d, yyyy") : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-medium">${((inv.amountCents ?? 0) / 100).toFixed(2)}</span>
                  {inv.status === "paid" ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200">Paid</Badge>
                  ) : inv.status === "open" ? (
                    <Badge className="bg-blue-100 text-blue-800 border-blue-200">Open</Badge>
                  ) : (
                    <Badge variant="outline">{inv.status ?? "unknown"}</Badge>
                  )}
                  {inv.stripeInvoiceUrl && (
                    <a href={inv.stripeInvoiceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-invoice-${inv.id}`}>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Trail sub-component ────────────────────────────────────────────────

function AuditTrail({ onSelect }: { onSelect: (c: FailedToolCall) => void }) {
  const { data, isLoading } = useQuery<{ calls: FailedToolCall[] }>({
    queryKey: ["/api/admin/agent-tool-calls"],
  });

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  if (!data?.calls?.length) {
    return <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">No tool call history</div>;
  }

  return (
    <div className="space-y-2" data-testid="list-audit-trail">
      {data.calls.map(c => (
        <div
          key={c.id}
          className="flex items-start justify-between gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
          onClick={() => onSelect(c)}
          data-testid={`row-audit-${c.id}`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5">
              {c.status === "success" ? <CheckCircle className="h-4 w-4 text-green-500" />
                : c.status === "failed" ? <XCircle className="h-4 w-4 text-red-500" />
                : c.status === "pending_confirmation" ? <Clock className="h-4 w-4 text-yellow-500" />
                : <CircleDot className="h-4 w-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{c.toolName}</p>
              <p className="text-xs text-muted-foreground truncate">{c.agentName} · {c.targetName ?? "no target"}</p>
            </div>
          </div>
          <div className="text-right shrink-0 space-y-1">
            {statusBadge(c.status)}
            <p className="text-xs text-muted-foreground">{ts(c.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Agent Activity Panel ─────────────────────────────────────────────

function RecentActivityPanel() {
  return (
    <div className="mt-8">
      <RecentAgentActivity limit={15} title="Recent Agent Activity (Unified Log)" />
    </div>
  );
}
