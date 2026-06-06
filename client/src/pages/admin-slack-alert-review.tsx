import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
  Bot,
  Shield,
  Eye,
  Loader2,
  Hash,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackAlertRequest {
  id: string;
  org_id: string;
  agent_id: string;
  channel: string;
  alert_type: string;
  severity: "critical" | "high" | "medium";
  message: string;
  purpose: string;
  risk_level: string;
  approval_queue_id: string | null;
  slack_message_id: string | null;
  slack_channel_id: string | null;
  status: "alert_queued" | "alert_posted" | "cancelled";
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  alert_queued: { label: "Awaiting Approval", color: "bg-blue-100 text-blue-800 border-blue-200",   icon: Clock },
  alert_posted: { label: "Posted",            color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
  cancelled:    { label: "Cancelled",         color: "bg-gray-100 text-gray-600 border-gray-200",   icon: XCircle },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  critical: { label: "Critical", color: "bg-red-100 text-red-800 border-red-200",       icon: AlertTriangle },
  high:     { label: "High",     color: "bg-orange-100 text-orange-800 border-orange-200", icon: Zap },
  medium:   { label: "Medium",   color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Clock },
};

const AGENT_LABELS: Record<string, string> = {
  ceo_heartbeat:              "CEO Heartbeat",
  executive_agent:            "Executive Agent",
  software_improvement_agent: "Software Improvement",
  revenue_agent:              "Revenue Agent",
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  daily_executive_summary:      "Daily Executive Summary",
  critical_business_risk:       "Critical Business Risk",
  revenue_anomaly_alert:        "Revenue Anomaly Alert",
  system_status:                "System Status",
  critical_bug_detected:        "Critical Bug Detected",
  system_failure_detected:      "System Failure Detected",
  high_severity_task_created:   "High-Severity Task Created",
  high_value_lead_alert:        "High-Value Lead Alert",
  large_deal_stage_change:      "Large Deal Stage Change",
  revenue_recovery_opportunity: "Revenue Recovery Opportunity",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity] ?? { label: severity, color: "bg-gray-100 text-gray-600", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span
      data-testid={`severity-badge-${severity}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${cfg.color}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function AgentBadge({ agentId }: { agentId: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-xs font-medium">
      <Bot className="w-3 h-3" />
      {AGENT_LABELS[agentId] ?? agentId}
    </span>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Alert Card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onApprove,
  onCancel,
  isApproving,
  isCancelling,
}: {
  alert: SlackAlertRequest;
  onApprove?: (id: string) => void;
  onCancel?: (id: string) => void;
  isApproving?: boolean;
  isCancelling?: boolean;
}) {
  const [msgExpanded, setMsgExpanded] = useState(false);
  const isActionable = alert.status === "alert_queued";
  const hasError = !!alert.error_message;
  const alertTypeLabel = ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type.replaceAll("_", " ");

  return (
    <Card
      data-testid={`card-alert-${alert.id}`}
      className="border border-gray-200 shadow-sm"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2 items-center">
            <AgentBadge agentId={alert.agent_id} />
            <StatusBadge status={alert.status} />
            <SeverityBadge severity={alert.severity} />
          </div>
          <span className="text-xs text-gray-400">{formatDate(alert.created_at)}</span>
        </div>
        <CardTitle className="text-sm font-semibold text-gray-900 mt-2">
          {alertTypeLabel}
        </CardTitle>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Hash className="w-3 h-3" />
          <span data-testid={`text-channel-${alert.id}`}>{alert.channel}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Purpose */}
        <div className="rounded-md bg-blue-50 border border-blue-100 p-2">
          <p className="text-xs text-blue-700 font-medium mb-0.5">Purpose</p>
          <p className="text-xs text-blue-900" data-testid={`text-purpose-${alert.id}`}>{alert.purpose}</p>
        </div>

        {/* Message preview */}
        <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500 font-medium">Message</p>
            <button
              data-testid={`button-toggle-message-${alert.id}`}
              onClick={() => setMsgExpanded(!msgExpanded)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              {msgExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <p
            className={`text-xs text-gray-700 whitespace-pre-line font-mono ${msgExpanded ? "" : "line-clamp-3"}`}
            data-testid={`text-message-preview-${alert.id}`}
          >
            {alert.message}
          </p>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-400">Approval Queue ID</span>
            <p className="text-gray-700 font-mono truncate" data-testid={`text-queue-id-${alert.id}`}>
              {alert.approval_queue_id ?? "—"}
            </p>
          </div>
          {alert.slack_message_id && (
            <div>
              <span className="text-gray-400">Slack Message ts</span>
              <p className="text-gray-700 font-mono truncate" data-testid={`text-message-id-${alert.id}`}>
                {alert.slack_message_id}
              </p>
            </div>
          )}
          {alert.slack_channel_id && (
            <div>
              <span className="text-gray-400">Slack Channel ID</span>
              <p className="text-gray-700 font-mono truncate">
                {alert.slack_channel_id}
              </p>
            </div>
          )}
        </div>

        {/* Error message — retryable */}
        {hasError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-2">
            <div className="flex items-center gap-1 text-xs text-red-700 font-medium mb-0.5">
              <AlertTriangle className="w-3 h-3" />
              Last Attempt Failed — Retryable
            </div>
            <p className="text-xs text-red-600" data-testid={`text-error-${alert.id}`}>
              {alert.error_message}
            </p>
          </div>
        )}

        {/* Actions */}
        {isActionable && onApprove && onCancel && (
          <>
            <Separator />
            <div className="flex items-center gap-2">
              <Button
                data-testid={`button-approve-${alert.id}`}
                size="sm"
                onClick={() => onApprove(alert.id)}
                disabled={isApproving || isCancelling}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              >
                {isApproving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {hasError ? "Retry Post" : "Approve & Post"}
              </Button>
              <Button
                data-testid={`button-cancel-${alert.id}`}
                size="sm"
                variant="outline"
                onClick={() => onCancel(alert.id)}
                disabled={isApproving || isCancelling}
                className="flex items-center gap-1.5 text-gray-600"
              >
                {isCancelling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminSlackAlertReviewPage() {
  const { toast } = useToast();
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "cancel" | null>(null);

  const pendingQuery = useQuery<{ alerts: SlackAlertRequest[]; count: number }>({
    queryKey: ["/api/composio/slack-alert/pending"],
    staleTime: 30_000,
  });

  const allQuery = useQuery<{ alerts: SlackAlertRequest[]; count: number }>({
    queryKey: ["/api/composio/slack-alert/all"],
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/composio/slack-alert/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/composio/slack-alert/all"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/composio/slack-alert/${id}/approve`),
    onMutate: (id) => { setActioningId(id); setActionType("approve"); },
    onSuccess: (data: any) => {
      toast({
        title: "Slack Alert Posted",
        description: data.message ?? "Alert successfully posted to Slack.",
      });
      invalidate();
    },
    onError: (err: any) => {
      toast({
        title: "Post Failed",
        description: err.message ?? "Composio execution failed. The request remains retryable.",
        variant: "destructive",
      });
      invalidate();
    },
    onSettled: () => { setActioningId(null); setActionType(null); },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/composio/slack-alert/${id}/cancel`),
    onMutate: (id) => { setActioningId(id); setActionType("cancel"); },
    onSuccess: () => {
      toast({ title: "Alert Cancelled", description: "Alert request has been cancelled." });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
      invalidate();
    },
    onSettled: () => { setActioningId(null); setActionType(null); },
  });

  const all = allQuery.data?.alerts ?? [];
  const pending = pendingQuery.data?.alerts ?? [];
  const posted = all.filter((a) => a.status === "alert_posted");
  const failed = all.filter((a) => a.status === "alert_queued" && !!a.error_message);
  const cancelled = all.filter((a) => a.status === "cancelled");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-600" />
            <h1 className="text-xl font-bold text-gray-900" data-testid="text-page-title">
              Slack Alert Review
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Review and approve agent-requested internal Slack alerts.
            All posts require explicit admin approval. No autonomous posting.
          </p>
        </div>
        <Button
          data-testid="button-refresh"
          variant="outline"
          size="sm"
          onClick={invalidate}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Safety notice */}
      <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 flex items-start gap-2">
        <Shield className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
        <div className="text-sm text-purple-800">
          <span className="font-semibold">Internal alerts only.</span>{" "}
          These are operational notifications to internal channels. No customer-facing
          messages, DMs, or external communications are permitted. Approving posts to
          the specified channel — no message is staged or modified.
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3" data-testid="stats-row">
        {[
          { label: "Pending",  value: pending.length, color: "text-blue-600",   testId: "stat-pending" },
          { label: "Posted",   value: posted.length,  color: "text-green-600",  testId: "stat-posted" },
          { label: "Failed",   value: failed.length,  color: "text-red-500",    testId: "stat-failed" },
          { label: "Cancelled", value: cancelled.length, color: "text-gray-500", testId: "stat-cancelled" },
        ].map(({ label, value, color, testId }) => (
          <Card key={label} className="border border-gray-200">
            <CardContent className="p-3 text-center">
              <p className={`text-2xl font-bold ${color}`} data-testid={testId}>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList data-testid="tabs-list">
          <TabsTrigger data-testid="tab-pending" value="pending">
            Pending{pending.length > 0 ? ` (${pending.length})` : ""}
          </TabsTrigger>
          <TabsTrigger data-testid="tab-posted" value="posted">Posted</TabsTrigger>
          <TabsTrigger data-testid="tab-failed" value="failed">
            Failed{failed.length > 0 ? ` (${failed.length})` : ""}
          </TabsTrigger>
          <TabsTrigger data-testid="tab-cancelled" value="cancelled">Cancelled</TabsTrigger>
        </TabsList>

        {/* Pending */}
        <TabsContent value="pending" className="mt-4 space-y-4">
          {pendingQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : pending.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No pending alert requests.</p>
              </CardContent>
            </Card>
          ) : (
            pending.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onApprove={(id) => approveMutation.mutate(id)}
                onCancel={(id) => cancelMutation.mutate(id)}
                isApproving={actioningId === alert.id && actionType === "approve"}
                isCancelling={actioningId === alert.id && actionType === "cancel"}
              />
            ))
          )}
        </TabsContent>

        {/* Posted */}
        <TabsContent value="posted" className="mt-4 space-y-4">
          {allQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : posted.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No alerts have been posted yet.
              </CardContent>
            </Card>
          ) : (
            posted.map((alert) => <AlertCard key={alert.id} alert={alert} />)
          )}
        </TabsContent>

        {/* Failed / Retryable */}
        <TabsContent value="failed" className="mt-4 space-y-4">
          {failed.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No failed alert attempts.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <span className="font-semibold">These requests are retryable.</span>{" "}
                Their status is still "Awaiting Approval". Click "Retry Post" to attempt again.
              </div>
              {failed.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onApprove={(id) => approveMutation.mutate(id)}
                  onCancel={(id) => cancelMutation.mutate(id)}
                  isApproving={actioningId === alert.id && actionType === "approve"}
                  isCancelling={actioningId === alert.id && actionType === "cancel"}
                />
              ))}
            </>
          )}
        </TabsContent>

        {/* Cancelled */}
        <TabsContent value="cancelled" className="mt-4 space-y-4">
          {cancelled.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No cancelled requests.
              </CardContent>
            </Card>
          ) : (
            cancelled.map((alert) => <AlertCard key={alert.id} alert={alert} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
