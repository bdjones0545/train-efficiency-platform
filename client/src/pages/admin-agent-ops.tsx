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
  Archive, Repeat, Ban, Plug, Pause, Hash, Search, Cpu, Globe, BarChart3,
  Server, Network, Bot, Layers, Shield, ChevronDown, ChevronUp, Wifi, WifiOff, Brain, Wrench,
} from "lucide-react";
import { Link } from "wouter";
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

type OpsMonitorItem = {
  id: string;
  label: string;
  status: "operational" | "ready" | "degraded" | "connected" | "disconnected";
  reason: string;
  lastChecked: string;
  source: string;
  fix: string | null;
};

type OpsMonitorData = {
  success: boolean;
  data: {
    infrastructure: OpsMonitorItem[];
    externalIntegrations: OpsMonitorItem[];
    executionLog: any[];
  };
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

// ─── Ops Monitor Section ──────────────────────────────────────────────────────

const INFRA_ICONS: Record<string, React.ElementType> = {
  database: Database,
  hermes: Network,
  agentmail: Mail,
  obsidian: Brain,
  ceo_heartbeat: Activity,
  workflow_runner: GitBranch,
  execution_engine: Zap,
  approval_center: CheckSquare,
  business_brain: Cpu,
  agent_registry: Layers,
  attention_inbox: Inbox,
};

const EXT_ICONS: Record<string, React.ElementType> = {
  gmail: Mail,
  google_calendar: Calendar,
  stripe: CreditCard,
  twilio: MessageSquare,
  sendgrid: Mail,
  slack: Hash,
  openrouter: Cpu,
  hubspot: BarChart3,
  meta_ads: Globe,
};

function opsStatusConfig(status: string): { dot: string; badge: string; icon: React.ElementType } {
  switch (status) {
    case "operational":
    case "connected":
      return { dot: "bg-green-500", badge: "text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300", icon: CheckCircle };
    case "ready":
      return { dot: "bg-blue-400", badge: "text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300", icon: CircleDot };
    case "degraded":
      return { dot: "bg-red-500", badge: "text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300", icon: AlertTriangle };
    case "disconnected":
    default:
      return { dot: "bg-gray-400", badge: "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400", icon: WifiOff };
  }
}

function opsStatusLabel(status: string): string {
  switch (status) {
    case "operational": return "Operational";
    case "connected": return "Connected";
    case "ready": return "Ready";
    case "degraded": return "Degraded";
    case "disconnected": return "Disconnected";
    default: return status;
  }
}

function OpsMonitorCard({ item, iconMap }: { item: OpsMonitorItem; iconMap: Record<string, React.ElementType> }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconMap[item.id] ?? Server;
  const cfg = opsStatusConfig(item.status);
  const StatusIcon = cfg.icon;
  const isWarning = item.status === "degraded" || item.status === "disconnected";

  return (
    <div
      className={`rounded-lg border bg-card transition-all ${isWarning ? "border-amber-200 dark:border-amber-800/50" : "border-border"}`}
      data-testid={`card-opsmonitor-${item.id}`}
    >
      <button
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <div className={`p-1.5 rounded-md shrink-0 ${isWarning ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"}`}>
          <Icon className={`h-3.5 w-3.5 ${isWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold truncate">{item.label}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              {opsStatusLabel(item.status)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.reason}</p>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t bg-muted/20 space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <div>
              <span className="text-muted-foreground uppercase tracking-wide font-medium">Status</span>
              <p className="font-semibold mt-0.5 capitalize">{opsStatusLabel(item.status)}</p>
            </div>
            <div>
              <span className="text-muted-foreground uppercase tracking-wide font-medium">Source</span>
              <p className="font-semibold mt-0.5 font-mono">{item.source}</p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground uppercase tracking-wide font-medium">Reason</span>
              <p className="mt-0.5">{item.reason}</p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground uppercase tracking-wide font-medium">Last Checked</span>
              <p className="mt-0.5">{item.lastChecked ? ts(item.lastChecked) : "—"}</p>
            </div>
          </div>
          {item.fix && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <Wrench className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700 dark:text-amber-300">{item.fix}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpsMonitorSection({ data, isLoading, refetch, isFetching }: {
  data: OpsMonitorData | undefined;
  isLoading: boolean;
  refetch: () => void;
  isFetching: boolean;
}) {
  const infrastructure = data?.data?.infrastructure ?? [];
  const externalIntegrations = data?.data?.externalIntegrations ?? [];

  const infraDegraded = infrastructure.filter(i => i.status === "degraded").length;
  const extDisconnected = externalIntegrations.filter(i => i.status === "disconnected").length;

  return (
    <div className="space-y-4" data-testid="section-ops-monitor">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">System Health</h2>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={refetch} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Product Infrastructure */}
      <div data-testid="section-infrastructure">
        <div className="flex items-center gap-2 mb-2">
          <Server className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">Product Infrastructure</h3>
          {infraDegraded > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300">
              {infraDegraded} degraded
            </span>
          )}
          {infraDegraded === 0 && !isLoading && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300">
              All operational
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {infrastructure.map(item => (
              <OpsMonitorCard key={item.id} item={item} iconMap={INFRA_ICONS} />
            ))}
          </div>
        )}
      </div>

      {/* External Integrations */}
      <div data-testid="section-external-integrations">
        <div className="flex items-center gap-2 mb-2">
          <Wifi className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">External Integrations</h3>
          {extDisconnected > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400">
              {extDisconnected} not connected
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {externalIntegrations.map(item => (
              <OpsMonitorCard key={item.id} item={item} iconMap={EXT_ICONS} />
            ))}
          </div>
        )}
      </div>
    </div>
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

  const { data: opsMonitor, isLoading: opsMonitorLoading, refetch: refetchOpsMonitor, isFetching: opsMonitorFetching } = useQuery<OpsMonitorData>({
    queryKey: ["/api/admin/agent-ops/ops-monitor"],
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
    refetchOpsMonitor();
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

      {/* Ops Monitor — Infrastructure + External Integrations */}
      <OpsMonitorSection
        data={opsMonitor}
        isLoading={opsMonitorLoading}
        refetch={refetchOpsMonitor}
        isFetching={opsMonitorFetching}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-7 w-full">
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
          <TabsTrigger value="dead-letter" data-testid="tab-dead-letter">
            Dead Letter
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit-trail">Audit Trail</TabsTrigger>
          <TabsTrigger value="connectors" data-testid="tab-connectors">Connectors</TabsTrigger>
          <TabsTrigger value="integration-health" data-testid="tab-integration-health">Integrations</TabsTrigger>
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

        {/* ── Dead Letter Queue ── */}
        <TabsContent value="dead-letter" className="space-y-4 mt-4">
          <DeadLetterPanel />
        </TabsContent>

        {/* ── Connectors ── */}
        <TabsContent value="connectors" className="space-y-4 mt-4">
          <ConnectorsPanel />
        </TabsContent>

        {/* ── Integration Health ── */}
        <TabsContent value="integration-health" className="space-y-4 mt-4">
          <IntegrationHealthPanel />
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

// ─── Dead Letter Panel ────────────────────────────────────────────────────────

type DeadLetterJob = {
  id: string;
  jobType: string;
  status: string;
  agentType: string | null;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  failedAt: string | null;
  payload: Record<string, any>;
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
  workflowRunId: string | null;
};

function DeadLetterPanel() {
  const { toast } = useToast();
  const { data: jobs, isLoading, refetch } = useQuery<DeadLetterJob[]>({
    queryKey: ["/api/job-queue/dead-letter"],
    refetchInterval: 60000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/job-queue/dead-letter/${id}/retry`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job re-queued", description: "The job has been moved back to the queue." });
      queryClient.invalidateQueries({ queryKey: ["/api/job-queue/dead-letter"] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-queue/stats"] });
    },
    onError: () => toast({ title: "Retry failed", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/job-queue/${id}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/job-queue/dead-letter"] });
      queryClient.invalidateQueries({ queryKey: ["/api/job-queue/stats"] });
    },
    onError: () => toast({ title: "Cancel failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="panel-dead-letter">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Archive className="h-4 w-4 text-red-500" />
            Dead Letter Queue
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Jobs that exhausted all retry attempts. You can re-queue or discard them.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-dead-letter">
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : !jobs?.length ? (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg text-center" data-testid="text-no-dead-letter">
          <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
          <p className="text-sm font-medium">Dead letter queue is empty</p>
          <p className="text-xs text-muted-foreground mt-1">All jobs completed or are still in-flight.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="list-dead-letter-jobs">
          {jobs.map(job => (
            <div
              key={job.id}
              className="border rounded-lg p-4 bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900/50"
              data-testid={`row-dead-letter-${job.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold font-mono">{job.jobType}</span>
                    {job.agentType && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                        {job.agentType}
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      dead_letter
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>{job.attemptCount}/{job.maxAttempts} attempts</span>
                    {job.deadLetteredAt && <span>{ts(job.deadLetteredAt)}</span>}
                    {job.workflowRunId && (
                      <span className="font-mono text-[10px]">run: {job.workflowRunId.slice(0, 8)}…</span>
                    )}
                  </div>
                  {job.deadLetterReason && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      Reason: {job.deadLetterReason}
                    </p>
                  )}
                  {job.lastError && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2 font-mono">{job.lastError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400"
                    onClick={() => retryMutation.mutate(job.id)}
                    disabled={retryMutation.isPending}
                    data-testid={`button-retry-${job.id}`}
                  >
                    <Repeat className="h-3 w-3" />
                    Retry
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                    onClick={() => cancelMutation.mutate(job.id)}
                    disabled={cancelMutation.isPending}
                    data-testid={`button-cancel-${job.id}`}
                  >
                    <Ban className="h-3 w-3" />
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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

// ─── Integration Health Panel ─────────────────────────────────────────────────

const INT_LABELS: Record<string, string> = {
  gmail: "Gmail", google_calendar: "Google Calendar", slack: "Slack",
  openrouter: "OpenRouter", research_agent: "Research Agent",
  meta_ads: "Meta Ads", hubspot: "HubSpot", stripe: "Stripe", twilio: "Twilio",
};
const INT_ICONS: Record<string, any> = {
  gmail: Mail, google_calendar: Calendar, slack: Hash, openrouter: Cpu,
  research_agent: Search, meta_ads: Globe, hubspot: BarChart3, stripe: Zap,
  twilio: Activity, discord: Hash, custom_webhook: Plug,
};
const STATUS_DOT_COLORS: Record<string, string> = {
  connected: "bg-green-500", disconnected: "bg-gray-300",
  degraded: "bg-amber-400", paused: "bg-blue-400", error: "bg-red-500",
};
const ALL_INT_TYPES = ["gmail","google_calendar","slack","openrouter","research_agent","meta_ads","hubspot","stripe","twilio"];

function IntegrationHealthPanel() {
  const { toast } = useToast();

  const { data: integrations, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/integrations"],
    refetchInterval: 30000,
  });
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/integrations/stats"],
    refetchInterval: 30000,
  });
  const { data: logs, isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/integrations/logs/all"],
    refetchInterval: 30000,
  });

  const pauseMut = useMutation({
    mutationFn: async (type: string) => (await apiRequest("POST", `/api/integrations/${type}/pause`, { reason: "Paused from Agent Ops" })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/integrations"] }); toast({ title: "Integration paused" }); },
  });
  const resumeMut = useMutation({
    mutationFn: async (type: string) => (await apiRequest("POST", `/api/integrations/${type}/resume`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/integrations"] }); toast({ title: "Integration resumed" }); },
  });
  const healthMut = useMutation({
    mutationFn: async (type: string) => (await apiRequest("POST", `/api/integrations/${type}/health-check`)).json(),
    onSuccess: (d: any, type) => { toast({ title: `Health: ${d.status}`, description: d.warnings?.[0] ?? "All clear" }); queryClient.invalidateQueries({ queryKey: ["/api/integrations"] }); },
  });

  const intMap = new Map((integrations ?? []).map((i: any) => [i.integrationType, i]));

  return (
    <div className="space-y-4" data-testid="panel-integration-health">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Integration Health</h3>
          <p className="text-xs text-muted-foreground mt-0.5">All external integrations managed via the governance runtime.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-integrations">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Link href="/admin/ai-workforce">
            <Button variant="outline" size="sm" data-testid="button-open-workforce">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Full View
            </Button>
          </Link>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 text-center"><p className="text-xl font-bold text-green-600">{stats.connected}</p><p className="text-xs text-muted-foreground">Connected</p></Card>
          <Card className="p-3 text-center"><p className="text-xl font-bold text-amber-500">{stats.degraded + stats.error}</p><p className="text-xs text-muted-foreground">Issues</p></Card>
          <Card className="p-3 text-center"><p className="text-xl font-bold text-primary">{stats.recentActions}</p><p className="text-xs text-muted-foreground">Recent Actions</p></Card>
          <Card className="p-3 text-center"><p className={`text-xl font-bold ${(stats.successRate ?? 100) >= 80 ? "text-green-600" : "text-amber-600"}`}>{stats.successRate ?? 100}%</p><p className="text-xs text-muted-foreground">Success Rate</p></Card>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ALL_INT_TYPES.map(type => {
            const integration = intMap.get(type);
            const status = integration?.status ?? "disconnected";
            const Icon = INT_ICONS[type] ?? Plug;
            const dotCls = STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.disconnected;
            return (
              <Card key={type} className="p-3" data-testid={`card-int-health-${type}`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold truncate">{INT_LABELS[type] ?? type}</span>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
                    </div>
                    <p className="text-[10px] text-muted-foreground capitalize">{status}</p>
                  </div>
                </div>
                {integration?.lastFailureReason && status !== "connected" && (
                  <p className="text-[10px] text-red-500 line-clamp-1 mb-1">{integration.lastFailureReason}</p>
                )}
                {integration && (
                  <div className="flex items-center gap-1 mt-1">
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => healthMut.mutate(type)} disabled={healthMut.isPending}>
                      <Activity className="h-2.5 w-2.5 mr-0.5" />Check
                    </Button>
                    {status === "paused" ? (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-green-600" onClick={() => resumeMut.mutate(type)} disabled={resumeMut.isPending}>
                        <Play className="h-2.5 w-2.5 mr-0.5" />Resume
                      </Button>
                    ) : status === "connected" ? (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-amber-600" onClick={() => pauseMut.mutate(type)} disabled={pauseMut.isPending}>
                        <Pause className="h-2.5 w-2.5 mr-0.5" />Pause
                      </Button>
                    ) : null}
                  </div>
                )}
                {!integration && (
                  <p className="text-[10px] text-muted-foreground italic">Not configured</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Execution Log</h4>
        {logsLoading ? (
          <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : !logs?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg" data-testid="text-no-int-logs">No integration actions logged yet.</p>
        ) : (
          <div className="border rounded-lg divide-y divide-border/50">
            {logs.slice(0, 10).map((log: any) => (
              <div key={log.id} className="flex items-center gap-3 px-3 py-2" data-testid={`row-int-log-${log.id}`}>
                <div className="shrink-0">
                  {log.status === "success" ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    : log.status === "blocked" ? <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />
                    : log.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-500" />
                    : <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{INT_LABELS[log.integrationType] ?? log.integrationType} · {log.actionType?.replace(/_/g," ")}</p>
                  {log.inputSummary && <p className="text-[10px] text-muted-foreground truncate">{log.inputSummary}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-medium ${log.status === "success" ? "text-green-500" : log.status === "failed" ? "text-red-500" : "text-orange-500"}`}>{log.status}</p>
                  {log.latencyMs && <p className="text-[10px] text-muted-foreground">{log.latencyMs}ms</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
