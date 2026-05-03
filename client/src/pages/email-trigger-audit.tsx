import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Target,
  RefreshCw,
  Filter,
  Send,
  Mail,
  Bot,
  TrendingUp,
  AlertOctagon,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type TriggerAuditSummary = {
  summary: {
    totalEvaluated: number;
    totalExecuted: number;
    totalBlocked: number;
    byTriggerType: Record<string, number>;
    byActionType: Record<string, number>;
  };
  blockReasons: { reason: string; count: number }[];
  timeline: {
    timestamp: string;
    triggerType: string;
    actionType: string;
    prospectName: string | null;
    outcome: string;
    reason: string | null;
    confidenceLevel: string | null;
    riskScore: number | null;
    missedOpportunity: boolean;
    collisionDetected: boolean;
  }[];
  missedOpportunities: number;
  collisions: number;
  events: any[];
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  daily_outreach: "Daily Outreach",
  follow_up_cron: "Follow-Up Cron",
  auto_execution: "Auto-Execution",
  manual: "Manual",
  system_event: "System Event",
};

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  cron_8_30am: "8:30 AM Cron",
  hourly_follow_up_cron: "Hourly Follow-Up",
  auto_exec_hook: "Auto-Exec Hook",
  user_click: "User Action",
  api_call: "API Call",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  send_initial_email: "Send Initial Email",
  send_follow_up: "Send Follow-Up",
  generate_draft: "Generate Draft",
  send_response: "Send Response",
};

const BLOCK_REASON_COLORS: Record<string, string> = {
  DNC: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  OPTED_OUT: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  DAILY_LIMIT_REACHED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  AUTO_EXEC_LIMIT_REACHED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  COOLDOWN_ACTIVE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  DEAL_ACTIVE_BLOCK: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  MISSING_EMAIL: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  LOW_CONFIDENCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  HIGH_RISK: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  INVALID_STAGE: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  AGENT_DISABLED: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  NO_ELIGIBLE_PROSPECTS: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  DUPLICATE_CONTACT: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function outcomeColor(outcome: string, missed: boolean, collision: boolean) {
  if (collision) return "bg-purple-500";
  if (outcome === "executed") return "bg-green-500";
  if (outcome === "blocked") return "bg-red-500";
  if (missed) return "bg-yellow-500";
  return "bg-gray-400";
}

function outcomeBadge(outcome: string, missed: boolean, collision: boolean) {
  if (collision) return { label: "Collision", cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" };
  if (outcome === "executed") return { label: "Executed", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  if (outcome === "blocked") return { label: "Blocked", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
  if (missed) return { label: "Missed", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" };
  return { label: "Evaluated", cls: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300" };
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  sub,
  colorClass,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colorClass ?? "bg-muted"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground leading-tight">{label}</div>
        <div className="text-2xl font-bold leading-tight mt-0.5" data-testid={`stat-${label.replace(/\s+/g, "-").toLowerCase()}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </Card>
  );
}

function TimelineRow({ event, idx }: { event: TriggerAuditSummary["timeline"][number]; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const badge = outcomeBadge(event.outcome, event.missedOpportunity, event.collisionDetected);
  const dot = outcomeColor(event.outcome, event.missedOpportunity, event.collisionDetected);

  return (
    <div
      className="flex gap-3 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-muted/30 rounded px-1 transition-colors"
      onClick={() => setExpanded((v) => !v)}
      data-testid={`timeline-row-${idx}`}
    >
      <div className="flex flex-col items-center pt-1 shrink-0">
        <div className={`w-2 h-2 rounded-full ${dot} mt-0.5 shrink-0`} />
        <div className="flex-1 w-px bg-border mt-1" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate max-w-[180px]">
              {event.prospectName ?? "—"}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>
              {badge.label}
            </span>
            {event.collisionDetected && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                ⚠ Collision
              </span>
            )}
            {event.missedOpportunity && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                Missed
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-foreground">
              {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{TRIGGER_TYPE_LABELS[event.triggerType] ?? event.triggerType}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">{ACTION_TYPE_LABELS[event.actionType] ?? event.actionType}</span>
          {event.reason && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${BLOCK_REASON_COLORS[event.reason] ?? "bg-gray-100 text-gray-700"}`}>
                {event.reason}
              </span>
            </>
          )}
        </div>
        {expanded && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs space-y-1">
            {event.confidenceLevel && (
              <div><span className="font-medium">Confidence:</span> {event.confidenceLevel}</div>
            )}
            {event.riskScore != null && (
              <div><span className="font-medium">Risk Score:</span> {event.riskScore}</div>
            )}
            <div><span className="font-medium">Trigger:</span> {TRIGGER_TYPE_LABELS[event.triggerType] ?? event.triggerType}</div>
            <div><span className="font-medium">Action:</span> {ACTION_TYPE_LABELS[event.actionType] ?? event.actionType}</div>
            <div><span className="font-medium">Time:</span> {new Date(event.timestamp).toLocaleString()}</div>
            {event.reason && (
              <div><span className="font-medium">Reason:</span> {event.reason}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type ProspectAudit = {
  prospectId: string;
  events: any[];
  timeline: TriggerAuditSummary["timeline"];
  totalSent: number;
  totalBlocked: number;
  blockReasons: { reason: string; count: number }[];
};

export default function EmailTriggerAuditPage() {
  useLocation();
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const prospectIdFilter = searchParams.get("prospect_id") ?? null;

  const [windowHours, setWindowHours] = useState("24");
  const [filterTrigger, setFilterTrigger] = useState<string>("all");
  const [filterAction, setFilterAction] = useState<string>("all");

  const params = new URLSearchParams({ window: windowHours });
  if (filterTrigger !== "all") params.set("trigger_type", filterTrigger);
  if (filterAction !== "all") params.set("action_type", filterAction);

  const { data, isLoading, refetch, isRefetching } = useQuery<TriggerAuditSummary>({
    queryKey: ["/api/email-agent/trigger-audit", windowHours, filterTrigger, filterAction],
    queryFn: () => fetch(`/api/email-agent/trigger-audit?${params}`).then((r) => r.json()),
    refetchInterval: 30_000,
    enabled: !prospectIdFilter,
  });

  const { data: prospectData, isLoading: prospectLoading } = useQuery<ProspectAudit>({
    queryKey: ["/api/email-agent/trigger-audit/prospect", prospectIdFilter],
    queryFn: () =>
      fetch(`/api/email-agent/trigger-audit/prospect/${prospectIdFilter}`).then((r) => r.json()),
    enabled: !!prospectIdFilter,
    refetchInterval: 30_000,
  });

  const execRate = data
    ? data.summary.totalEvaluated > 0
      ? Math.round((data.summary.totalExecuted / data.summary.totalEvaluated) * 100)
      : 0
    : 0;

  const mostCommonTrigger = data
    ? Object.entries(data.summary.byTriggerType).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const triggerTypeEntries = data ? Object.entries(data.summary.byTriggerType).sort((a, b) => b[1] - a[1]) : [];
  const maxTriggerCount = triggerTypeEntries[0]?.[1] ?? 1;

  const actionTypeEntries = data ? Object.entries(data.summary.byActionType).sort((a, b) => b[1] - a[1]) : [];

  if (prospectIdFilter) {
    return (
      <div className="space-y-6 pb-10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Trigger Trace — Prospect
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{prospectIdFilter}</p>
          </div>
          <a href="/admin/trigger-audit">
            <Button variant="outline" size="sm" data-testid="button-back-to-audit">
              ← All Triggers
            </Button>
          </a>
        </div>

        {prospectLoading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !prospectData || prospectData.timeline.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No trigger events recorded for this prospect yet.</p>
            <p className="text-xs mt-1">Events appear once the Email Agent evaluates this prospect.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{prospectData.totalSent}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Emails Sent</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold text-red-500">{prospectData.totalBlocked}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Blocked</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold">{prospectData.timeline.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Total Events</div>
              </Card>
            </div>

            {prospectData.blockReasons.length > 0 && (
              <Card className="p-4">
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-destructive" /> Block Reasons
                </h2>
                <div className="flex flex-wrap gap-2">
                  {prospectData.blockReasons.map(({ reason, count }) => (
                    <span key={reason} className={`text-xs px-2 py-0.5 rounded font-medium ${BLOCK_REASON_COLORS[reason] ?? "bg-gray-100 text-gray-700"}`}>
                      {reason} ({count}×)
                    </span>
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary" /> Full Event Timeline
              </h2>
              <div className="max-h-[600px] overflow-y-auto">
                {prospectData.timeline.map((event, idx) => (
                  <TimelineRow key={idx} event={event} idx={idx} />
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Trigger Audit
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Full observability into every email trigger decision — sent, blocked, missed, or colliding.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          data-testid="button-refresh-audit"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={windowHours} onValueChange={setWindowHours}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24">Last 24 hours</SelectItem>
            <SelectItem value="48">Last 48 hours</SelectItem>
            <SelectItem value="168">Last 7 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterTrigger} onValueChange={setFilterTrigger}>
          <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-trigger-type">
            <SelectValue placeholder="All triggers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All triggers</SelectItem>
            <SelectItem value="daily_outreach">Daily Outreach</SelectItem>
            <SelectItem value="follow_up_cron">Follow-Up Cron</SelectItem>
            <SelectItem value="auto_execution">Auto-Execution</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-action-type">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="send_initial_email">Send Initial Email</SelectItem>
            <SelectItem value="send_follow_up">Send Follow-Up</SelectItem>
            <SelectItem value="generate_draft">Generate Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Emails Sent"
            value={data?.summary.totalExecuted ?? 0}
            icon={Send}
            sub={`of ${data?.summary.totalEvaluated ?? 0} evaluated`}
            colorClass="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          />
          <SummaryCard
            label="Emails Blocked"
            value={data?.summary.totalBlocked ?? 0}
            icon={XCircle}
            sub={`${data?.summary.totalEvaluated ? Math.round((data.summary.totalBlocked / data.summary.totalEvaluated) * 100) : 0}% of evaluated`}
            colorClass="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          />
          <SummaryCard
            label="Execution Rate"
            value={`${execRate}%`}
            icon={TrendingUp}
            sub={execRate >= 50 ? "healthy" : execRate > 0 ? "below target" : "no sends yet"}
            colorClass={execRate >= 50 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"}
          />
          <SummaryCard
            label="Top Trigger"
            value={mostCommonTrigger ? TRIGGER_TYPE_LABELS[mostCommonTrigger] ?? mostCommonTrigger : "—"}
            icon={Zap}
            sub={mostCommonTrigger ? `${data?.summary.byTriggerType[mostCommonTrigger] ?? 0} events` : "no events yet"}
            colorClass="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          />
        </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────────────── */}
      {data && (data.missedOpportunities > 0 || data.collisions > 0) && (
        <div className="space-y-2">
          {data.missedOpportunities > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-700" data-testid="alert-missed-opportunities">
              <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                {data.missedOpportunities} missed revenue opportunit{data.missedOpportunities === 1 ? "y" : "ies"} detected
              </span>
              <span className="text-xs text-yellow-700 dark:text-yellow-400">— follow-ups were due but not sent</span>
            </div>
          )}
          {data.collisions > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-purple-50 border border-purple-200 dark:bg-purple-900/20 dark:border-purple-700" data-testid="alert-collisions">
              <AlertOctagon className="h-4 w-4 text-purple-600 shrink-0" />
              <span className="text-sm font-medium text-purple-800 dark:text-purple-300">
                {data.collisions} trigger collision{data.collisions === 1 ? "" : "s"} detected
              </span>
              <span className="text-xs text-purple-700 dark:text-purple-400">— same prospect triggered by multiple sources</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Trigger Breakdown ─────────────────────────────────────────────── */}
        <Card className="p-4 col-span-1">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Target className="h-4 w-4 text-primary" />
            Trigger Breakdown
          </h2>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : triggerTypeEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No trigger events in this window</p>
          ) : (
            <div className="space-y-2">
              {triggerTypeEntries.map(([type, count]) => (
                <div key={type} data-testid={`trigger-breakdown-${type}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium">{TRIGGER_TYPE_LABELS[type] ?? type}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.round((count / maxTriggerCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Block Reasons ─────────────────────────────────────────────────── */}
        <Card className="p-4 col-span-1">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <XCircle className="h-4 w-4 text-destructive" />
            Block Reasons
          </h2>
          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
          ) : !data || data.blockReasons.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 py-4">
              <CheckCircle className="h-4 w-4" />
              No blocked events in this window
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.blockReasons.map(({ reason, count }) => (
                <div key={reason} className="flex items-center justify-between" data-testid={`block-reason-${reason}`}>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${BLOCK_REASON_COLORS[reason] ?? "bg-gray-100 text-gray-700"}`}>
                    {reason}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">{count}×</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Action Type Breakdown ─────────────────────────────────────────── */}
        <Card className="p-4 col-span-1">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Mail className="h-4 w-4 text-primary" />
            Action Types
          </h2>
          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : actionTypeEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No events in this window</p>
          ) : (
            <div className="space-y-2.5">
              {actionTypeEntries.map(([type, count]) => {
                const eventsOfType = data?.events.filter((e) => e.actionType === type) ?? [];
                const executed = eventsOfType.filter((e) => e.wasExecuted).length;
                const blocked = eventsOfType.filter((e) => e.executionBlocked).length;
                return (
                  <div key={type} data-testid={`action-type-${type}`}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{ACTION_TYPE_LABELS[type] ?? type}</span>
                      <span className="text-muted-foreground">{count} total</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="text-green-600 dark:text-green-400">{executed} sent</span>
                      <span>·</span>
                      <span className="text-red-500">{blocked} blocked</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Timeline Feed ───────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" />
          Event Timeline
          {data && (
            <Badge variant="secondary" className="ml-1 text-xs">{data.timeline.length} events</Badge>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Click any row to expand. <span className="text-green-600 dark:text-green-400 font-medium">Green</span> = sent, <span className="text-red-500 font-medium">Red</span> = blocked, <span className="text-yellow-500 font-medium">Yellow</span> = missed opportunity, <span className="text-purple-600 font-medium">Purple</span> = collision.
        </p>

        {isLoading ? (
          <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data || data.timeline.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No trigger events found in this time window.</p>
            <p className="text-xs mt-1">Trigger logs will appear here once the Email Agent evaluates prospects.</p>
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            {data.timeline.map((event, idx) => (
              <TimelineRow key={idx} event={event} idx={idx} />
            ))}
          </div>
        )}
      </Card>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /><span>This panel is for internal debugging only and is not visible to end users.</span></div>
        <div className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /><span>Refreshes every 30 seconds</span></div>
      </div>
    </div>
  );
}
