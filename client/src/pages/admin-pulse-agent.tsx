import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Heart, Play, RefreshCw, AlertTriangle, Clock, CheckCircle,
  Zap, BarChart2, ShieldCheck, Calendar, Activity, ExternalLink,
  ThumbsUp, ThumbsDown, CheckSquare, XCircle, ChevronDown, ChevronUp,
  Users, TrendingDown, CreditCard, UserX, SkipForward, Inbox, Eye,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UrgencyLevel = "critical" | "high" | "medium" | "low";
type RecStatus = "pending_review" | "approved" | "dismissed" | "completed" | "expired";

interface PulseStatus {
  agentType: string;
  agentName: string;
  status: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunSignals: number | null;
  lastRunNew: number | null;
  lastRunDeduped: number | null;
  lastRunExpired: number | null;
  lastRunError: string | null;
  totalActions: number;
  actionsLast30Days: number;
  pendingRecommendations: number;
  scheduledInterval: string;
  triggeredBy: string | null;
}

interface PulseRec {
  id: string;
  orgId: string;
  signalType: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  urgency: UrgencyLevel;
  estimatedValueCents: number | null;
  reasonText: string | null;
  recommendedAction: string | null;
  confidenceScore: number | null;
  staleDays: number | null;
  sourceUrl: string | null;
  status: RecStatus;
  statusUpdatedAt: string | null;
  statusUpdatedBy: string | null;
  dismissReason: string | null;
  runId: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

interface AuditData {
  table: string;
  actorType: string;
  agentName: string;
  totals: {
    allTime: number; last30Days: number; completed: number; pendingReview: number;
    failed: number; firstActionAt: string | null; lastActionAt: string | null;
  };
  recommendations: {
    total: number; pending: number; approved: number; dismissed: number;
    completed: number; expired: number;
  };
  signalBreakdown: Record<string, number>;
  byActionType: { actionType: string; count: number; lastSeen: string }[];
  auditNote: string;
}

interface HistoryEntry {
  id: string; actionType: string; entityType: string | null; entityId: string | null;
  status: string; confidenceScore: number | null; riskLevel: string | null;
  reasoningSummary: string | null; createdAt: string | null; workflowRunId: string | null;
}

interface WeeklySummary {
  period: { from: string; to: string };
  summary: {
    newSignals: number; closedSignals: number; ignoredSignals: number; pendingCount: number;
    urgencyBreakdown: Record<string, number>;
    signalTypeBreakdown: Record<string, number>;
  };
  newSignals: PulseRec[];
  closedSignals: PulseRec[];
  ignoredSignals: PulseRec[];
  topRisks: PulseRec[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800",
  high:     "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  medium:   "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
  low:      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
};

const URGENCY_ICON: Record<UrgencyLevel, typeof AlertTriangle> = {
  critical: AlertTriangle, high: Zap, medium: Clock, low: Activity,
};

const STATUS_STYLE: Record<RecStatus, string> = {
  pending_review: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  approved:       "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  dismissed:      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  completed:      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  expired:        "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400",
};

const STATUS_LABEL: Record<RecStatus, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  dismissed: "Dismissed",
  completed: "Completed",
  expired: "Expired",
};

const SIGNAL_LABEL: Record<string, string> = {
  inactive_client: "Inactive Client",
  high_churn_risk: "High Churn Risk",
  expiring_subscription: "Expiring Subscription",
  cancelled_subscription: "Cancelled Subscription",
  no_show_pattern: "No-Show Pattern",
  declining_frequency: "Declining Frequency",
  lapsed_client: "Lapsed Client",
  low_session_remaining: "Low Sessions Left",
};

const SIGNAL_ICON: Record<string, typeof Users> = {
  inactive_client: UserX,
  high_churn_risk: AlertTriangle,
  expiring_subscription: CreditCard,
  cancelled_subscription: XCircle,
  no_show_pattern: SkipForward,
  declining_frequency: TrendingDown,
  lapsed_client: UserX,
  low_session_remaining: CreditCard,
};

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function UrgencyBadge({ urgency }: { urgency: UrgencyLevel }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${URGENCY_COLOR[urgency]}`}>
      {urgency.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: RecStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────

function RecCard({ rec, rank, showActions = true }: { rec: PulseRec; rank?: number; showActions?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [showDismissForm, setShowDismissForm] = useState(false);

  const SignalIcon = SIGNAL_ICON[rec.signalType] ?? Activity;
  const UrgIcon = URGENCY_ICON[rec.urgency] ?? Activity;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/agents/pulse/recommendations"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/pulse/status"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/pulse/audit"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/pulse/summary/weekly"] });
  };

  const approveMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/pulse/recommendations/${rec.id}/approve`),
    onSuccess: () => { toast({ title: "Approved", description: rec.recommendedAction ?? "" }); invalidate(); },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const dismissMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/pulse/recommendations/${rec.id}/dismiss`, { reason: dismissReason }),
    onSuccess: () => { toast({ title: "Dismissed" }); setShowDismissForm(false); setDismissReason(""); invalidate(); },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  const completeMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/pulse/recommendations/${rec.id}/complete`),
    onSuccess: () => { toast({ title: "Marked complete" }); invalidate(); },
    onError: () => toast({ title: "Failed to mark complete", variant: "destructive" }),
  });

  const isPending = rec.status === "pending_review";
  const isApproved = rec.status === "approved";

  return (
    <Card
      data-testid={`card-pulse-rec-${rec.id}`}
      className={`transition-shadow ${
        rec.urgency === "critical" ? "border-red-200 dark:border-red-800 hover:shadow-md" :
        rec.urgency === "high" ? "border-orange-200 dark:border-orange-800 hover:shadow-md" :
        "hover:shadow-sm"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            rec.urgency === "critical" ? "bg-red-100 dark:bg-red-900/30" :
            rec.urgency === "high" ? "bg-orange-100 dark:bg-orange-900/30" :
            rec.urgency === "medium" ? "bg-yellow-100 dark:bg-yellow-900/30" :
            "bg-blue-100 dark:bg-blue-900/30"
          }`}>
            <UrgIcon className={`h-4 w-4 ${
              rec.urgency === "critical" ? "text-red-600 dark:text-red-400" :
              rec.urgency === "high" ? "text-orange-600 dark:text-orange-400" :
              rec.urgency === "medium" ? "text-yellow-600 dark:text-yellow-400" :
              "text-blue-600 dark:text-blue-400"
            }`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {rank != null && (
                <span className="text-xs font-medium text-muted-foreground">#{rank}</span>
              )}
              <UrgencyBadge urgency={rec.urgency} />
              <StatusBadge status={rec.status} />
              <Badge variant="outline" className="text-[10px] gap-1">
                <SignalIcon className="h-2.5 w-2.5" />
                {SIGNAL_LABEL[rec.signalType] ?? rec.signalType.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{rec.entityType}</Badge>
              {(rec.staleDays ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {rec.staleDays}d inactive
                </span>
              )}
            </div>

            {rec.entityName && (
              <p className="text-xs font-medium text-muted-foreground mb-0.5">{rec.entityName}</p>
            )}

            <p className="text-sm font-semibold text-foreground mb-1">{rec.recommendedAction}</p>

            {rec.reasonText && (
              <div>
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-expand-reason-${rec.id}`}
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Why this was flagged
                </button>
                {expanded && (
                  <p className="text-xs text-muted-foreground mt-1.5 pl-4 border-l-2 border-muted">
                    {rec.reasonText}
                  </p>
                )}
              </div>
            )}

            {rec.status === "dismissed" && rec.dismissReason && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Dismissed: "{rec.dismissReason}"
              </p>
            )}

            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">{fmtTs(rec.createdAt)}</span>
              {rec.confidenceScore != null && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(rec.confidenceScore * 100)}% confidence
                </span>
              )}

              {rec.sourceUrl && (
                <a
                  href={rec.sourceUrl}
                  className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 hover:underline font-medium"
                  data-testid={`link-pulse-source-${rec.id}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  View {rec.entityType}
                </a>
              )}

              {showActions && isPending && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
                    onClick={() => approveMut.mutate()}
                    disabled={approveMut.isPending}
                    data-testid={`button-approve-${rec.id}`}
                  >
                    <ThumbsUp className="h-3 w-3" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400"
                    onClick={() => completeMut.mutate()}
                    disabled={completeMut.isPending}
                    data-testid={`button-complete-${rec.id}`}
                  >
                    <CheckSquare className="h-3 w-3" />
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setShowDismissForm(v => !v)}
                    data-testid={`button-dismiss-${rec.id}`}
                  >
                    <XCircle className="h-3 w-3" />
                    Dismiss
                  </Button>
                </div>
              )}
              {showActions && isApproved && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
                    onClick={() => completeMut.mutate()}
                    disabled={completeMut.isPending}
                    data-testid={`button-complete-approved-${rec.id}`}
                  >
                    <CheckSquare className="h-3 w-3" />
                    Mark Complete
                  </Button>
                </div>
              )}
            </div>

            {showDismissForm && (
              <div className="mt-2 space-y-2">
                <Textarea
                  placeholder="Why are you dismissing this? (optional)"
                  value={dismissReason}
                  onChange={e => setDismissReason(e.target.value)}
                  className="text-xs h-16 resize-none"
                  data-testid={`input-dismiss-reason-${rec.id}`}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 text-xs px-3"
                    onClick={() => dismissMut.mutate()}
                    disabled={dismissMut.isPending}
                    data-testid={`button-confirm-dismiss-${rec.id}`}
                  >
                    Confirm Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-3"
                    onClick={() => { setShowDismissForm(false); setDismissReason(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPulseAgentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("recommendations");
  const [statusFilter, setStatusFilter] = useState<RecStatus | "all">("pending_review");

  const statusQ = useQuery<PulseStatus>({
    queryKey: ["/api/agents/pulse/status"],
    refetchInterval: 30_000,
  });

  const recsQ = useQuery<{ recommendations: PulseRec[]; total: number }>({
    queryKey: ["/api/agents/pulse/recommendations", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/agents/pulse/recommendations?status=${statusFilter}&limit=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const auditQ = useQuery<AuditData>({
    queryKey: ["/api/agents/pulse/audit"],
    enabled: activeTab === "audit",
  });

  const historyQ = useQuery<{ entries: HistoryEntry[]; total: number }>({
    queryKey: ["/api/agents/pulse/history"],
    enabled: activeTab === "history",
  });

  const weeklyQ = useQuery<WeeklySummary>({
    queryKey: ["/api/agents/pulse/summary/weekly"],
    enabled: activeTab === "weekly",
  });

  const runMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agents/pulse/run"),
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Pulse run complete" : "Pulse run finished with error",
        description: data.success
          ? `${data.newRecommendations} new recommendation${data.newRecommendations !== 1 ? "s" : ""}, ${data.skippedDuplicates} deduplicated — ${fmtMs(data.durationMs)}`
          : data.error ?? "Check logs for details",
      });
      qc.invalidateQueries({ queryKey: ["/api/agents/pulse/status"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/pulse/recommendations"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/pulse/audit"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/pulse/history"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/pulse/summary/weekly"] });
    },
    onError: () => toast({ title: "Run failed", description: "Could not trigger Pulse", variant: "destructive" }),
  });

  const status = statusQ.data;
  const recs = recsQ.data?.recommendations ?? [];
  const audit = auditQ.data;
  const history = historyQ.data?.entries ?? [];
  const weekly = weeklyQ.data;

  const criticalCount = recs.filter(r => r.urgency === "critical" && r.status === "pending_review").length;
  const highCount = recs.filter(r => r.urgency === "high" && r.status === "pending_review").length;

  const STATUS_FILTER_OPTIONS: { value: RecStatus | "all"; label: string }[] = [
    { value: "pending_review", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "completed", label: "Completed" },
    { value: "dismissed", label: "Dismissed" },
    { value: "expired", label: "Expired" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            <Heart className="h-6 w-6 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pulse — Retention Agent</h1>
            <p className="text-sm text-muted-foreground">
              Detects churn signals, monitors client health, and surfaces ranked retention recommendations daily
            </p>
          </div>
        </div>
        <Button
          data-testid="button-pulse-run"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
        >
          {runMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runMut.isPending ? "Running…" : "Run Now"}
        </Button>
      </div>

      {/* Alert banner for critical signals */}
      {(criticalCount > 0 || highCount > 0) && (
        <div className={`rounded-lg p-3 flex items-center gap-3 ${
          criticalCount > 0
            ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
            : "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800"
        }`}>
          <AlertTriangle className={`h-4 w-4 shrink-0 ${criticalCount > 0 ? "text-red-600" : "text-orange-600"}`} />
          <p className={`text-sm font-medium ${criticalCount > 0 ? "text-red-800 dark:text-red-300" : "text-orange-800 dark:text-orange-300"}`}>
            {criticalCount > 0
              ? `${criticalCount} critical churn risk${criticalCount !== 1 ? "s" : ""} require immediate attention`
              : `${highCount} high-priority retention signal${highCount !== 1 ? "s" : ""} need review`
            }
          </p>
        </div>
      )}

      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Status</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                status?.status === "idle" ? "bg-green-500" :
                status?.status === "error" ? "bg-red-500" : "bg-gray-400"
              }`} />
              <span className="text-sm font-semibold capitalize" data-testid="text-pulse-status">
                {statusQ.isLoading ? "…" : status?.status === "never_run" ? "Ready" : (status?.status ?? "—")}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Pending Review</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pulse-pending">
              {statusQ.isLoading ? "…" : (status?.pendingRecommendations ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Actions</p>
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400" data-testid="text-pulse-total-actions">
              {statusQ.isLoading ? "…" : (status?.totalActions ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last 30 Days</p>
            <p className="text-2xl font-bold text-foreground" data-testid="text-pulse-30d">
              {statusQ.isLoading ? "…" : (status?.actionsLast30Days ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last Run</p>
            <p className="text-xs font-medium text-foreground" data-testid="text-pulse-last-run">
              {statusQ.isLoading ? "…" : fmtTs(status?.lastRunAt)}
            </p>
            {status?.lastRunNew != null && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {status.lastRunNew} new · {status.lastRunDeduped} deduped
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last run detail */}
      {status && status.status !== "never_run" && (
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-6 flex-wrap text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {fmtTs(status.lastRunAt)}
              </span>
              {status.lastRunDurationMs != null && (
                <span>Completed in {fmtMs(status.lastRunDurationMs)}</span>
              )}
              {status.lastRunSignals != null && (
                <span>{status.lastRunSignals} signal{status.lastRunSignals !== 1 ? "s" : ""} detected</span>
              )}
              {status.lastRunNew != null && (
                <span className="text-teal-600 dark:text-teal-400 font-medium">
                  {status.lastRunNew} new recommendation{status.lastRunNew !== 1 ? "s" : ""}
                </span>
              )}
              {status.lastRunExpired != null && status.lastRunExpired > 0 && (
                <span>{status.lastRunExpired} expired</span>
              )}
              {status.triggeredBy && (
                <span className="capitalize">Triggered by: {status.triggeredBy}</span>
              )}
              {status.lastRunError && (
                <span className="text-red-500">Error: {status.lastRunError}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">
            <Inbox className="h-3.5 w-3.5 mr-1" />
            Recommendations
            {(status?.pendingRecommendations ?? 0) > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                {status?.pendingRecommendations}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="weekly" data-testid="tab-weekly">
            <BarChart2 className="h-3.5 w-3.5 mr-1" />
            Weekly
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Audit
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <Eye className="h-3.5 w-3.5 mr-1" />
            History
          </TabsTrigger>
        </TabsList>

        {/* ── Recommendations ──────────────────────────────────────────────── */}
        <TabsContent value="recommendations" className="space-y-4 mt-4">
          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Filter:</span>
            {STATUS_FILTER_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                size="sm"
                variant={statusFilter === opt.value ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setStatusFilter(opt.value)}
                data-testid={`button-filter-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {recsQ.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : recs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Heart className="h-10 w-10 mx-auto text-teal-400 mb-3 opacity-60" />
                <p className="text-sm font-medium text-muted-foreground">
                  {statusFilter === "pending_review"
                    ? "No pending retention recommendations. Clients are healthy!"
                    : `No ${STATUS_LABEL[statusFilter as RecStatus] ?? statusFilter} recommendations found.`}
                </p>
                {statusFilter === "pending_review" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 gap-2"
                    onClick={() => runMut.mutate()}
                    disabled={runMut.isPending}
                    data-testid="button-run-from-empty"
                  >
                    <Play className="h-3 w-3" />
                    Run Pulse to detect signals
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {recs.map((rec, i) => (
                <RecCard key={rec.id} rec={rec} rank={i + 1} showActions />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Weekly Summary ────────────────────────────────────────────────── */}
        <TabsContent value="weekly" className="space-y-4 mt-4">
          {weeklyQ.isLoading ? (
            <div className="h-40 rounded-lg bg-muted animate-pulse" />
          ) : !weekly ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No weekly data yet</CardContent></Card>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">New Signals (7d)</p>
                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{weekly.summary.newSignals}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Actioned (7d)</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{weekly.summary.closedSignals}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Ignored/Expired</p>
                    <p className="text-2xl font-bold text-gray-500">{weekly.summary.ignoredSignals}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Still Pending</p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{weekly.summary.pendingCount}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Urgency breakdown */}
              {Object.keys(weekly.summary.urgencyBreakdown).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Urgency Breakdown (Pending)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 flex items-center gap-4 flex-wrap">
                    {Object.entries(weekly.summary.urgencyBreakdown).map(([urg, count]) => (
                      <div key={urg} className="flex items-center gap-2">
                        <UrgencyBadge urgency={urg as UrgencyLevel} />
                        <span className="text-sm font-bold">{count}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Signal type breakdown */}
              {Object.keys(weekly.summary.signalTypeBreakdown).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Signal Types (Pending)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="space-y-1.5">
                      {Object.entries(weekly.summary.signalTypeBreakdown)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{SIGNAL_LABEL[type] ?? type}</span>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top risks */}
              {weekly.topRisks.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Top At-Risk Clients
                  </h3>
                  <div className="space-y-3">
                    {weekly.topRisks.map((rec, i) => (
                      <RecCard key={rec.id} rec={rec} rank={i + 1} showActions />
                    ))}
                  </div>
                </div>
              )}

              {/* New signals this week */}
              {weekly.newSignals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">New This Week</h3>
                  <div className="space-y-2">
                    {weekly.newSignals.map(rec => (
                      <RecCard key={rec.id} rec={rec} showActions={false} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Audit ─────────────────────────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          {auditQ.isLoading ? (
            <div className="h-40 rounded-lg bg-muted animate-pulse" />
          ) : !audit ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No audit data yet — run Pulse first</CardContent></Card>
          ) : (
            <>
              {/* Totals */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">All-Time Actions</p>
                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400" data-testid="text-audit-total">{audit.totals.allTime.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Last 30 Days</p>
                    <p className="text-2xl font-bold">{audit.totals.last30Days.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">First Action</p>
                    <p className="text-xs font-medium">{fmtTs(audit.totals.firstActionAt)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Last Action</p>
                    <p className="text-xs font-medium">{fmtTs(audit.totals.lastActionAt)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Recommendations totals */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-teal-500" />
                    Recommendation Lifecycle (All Time)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[
                    { label: "Total", value: audit.recommendations.total, color: "text-foreground" },
                    { label: "Pending", value: audit.recommendations.pending, color: "text-amber-600" },
                    { label: "Approved", value: audit.recommendations.approved, color: "text-blue-600" },
                    { label: "Completed", value: audit.recommendations.completed, color: "text-green-600" },
                    { label: "Dismissed", value: audit.recommendations.dismissed, color: "text-gray-500" },
                    { label: "Expired", value: audit.recommendations.expired, color: "text-red-400" },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-xs text-muted-foreground mb-0.5">{item.label}</p>
                      <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Signal breakdown */}
              {Object.keys(audit.signalBreakdown ?? {}).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Signal Type Breakdown (All Time)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-2">
                    {Object.entries(audit.signalBreakdown)
                      .filter(([, v]) => v > 0)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-xs border-b last:border-0 pb-1.5 last:pb-0">
                          <span className="text-muted-foreground font-medium">{SIGNAL_LABEL[type] ?? type}</span>
                          <span className="font-bold">{count}</span>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}

              <p className="text-[10px] text-muted-foreground italic">{audit.auditNote}</p>
            </>
          )}
        </TabsContent>

        {/* ── History ───────────────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-3 mt-4">
          {historyQ.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 rounded bg-muted animate-pulse" />)}
            </div>
          ) : history.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground text-sm">
                No history yet — run Pulse to generate entries
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map(entry => (
                <Card key={entry.id} data-testid={`card-history-${entry.id}`} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            entry.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                            entry.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {entry.status}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">{entry.actionType}</span>
                        </div>
                        {entry.reasoningSummary && (
                          <p className="text-xs text-muted-foreground truncate">{entry.reasoningSummary}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {fmtTs(entry.createdAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
