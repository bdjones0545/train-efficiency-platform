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
  Target, Play, RefreshCw, TrendingUp, AlertTriangle, Clock, CheckCircle,
  Zap, BarChart2, ShieldCheck, Calendar, DollarSign, Activity, ExternalLink,
  ThumbsUp, ThumbsDown, CheckSquare, XCircle, ChevronDown, ChevronUp,
  ArrowUpRight, Inbox, Trophy, Eye,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UrgencyLevel = "critical" | "high" | "medium" | "low";
type RecStatus = "pending_review" | "approved" | "dismissed" | "completed" | "expired";

interface ApexStatus {
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

interface ApexRec {
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
  bySignalType: { signalType: string; count: number; lastSeen: string }[];
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
    totalEstimatedValueCents: number;
    urgencyBreakdown: Record<string, number>;
  };
  newSignals: ApexRec[];
  closedSignals: ApexRec[];
  topOpportunities: ApexRec[];
  ignoredSignals: ApexRec[];
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
  stale_active_deal: "Stale Deal",
  high_value_stale_deal: "High-Value Stale",
  abandoned_deal: "Abandoned Deal",
  overdue_followup: "Overdue Follow-up",
  hot_lead_cooling: "Hot Lead Cooling",
  uncontacted_high_value_prospect: "Uncontacted Prospect",
  new_lead_no_action: "New Lead Idle",
};

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtValue(cents: number | null | undefined): string {
  if (!cents || cents === 0) return "";
  return `$${(cents / 100).toLocaleString()}`;
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

function RecCard({
  rec, rank, showActions = true,
}: {
  rec: ApexRec;
  rank?: number;
  showActions?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [showDismissForm, setShowDismissForm] = useState(false);

  const Icon = URGENCY_ICON[rec.urgency] ?? Activity;
  const value = fmtValue(rec.estimatedValueCents);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/agents/apex/recommendations"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/apex/status"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/apex/audit"] });
    qc.invalidateQueries({ queryKey: ["/api/agents/apex/summary/weekly"] });
  };

  const approveMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/apex/recommendations/${rec.id}/approve`),
    onSuccess: () => { toast({ title: "Approved", description: rec.recommendedAction ?? "" }); invalidate(); },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const dismissMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/apex/recommendations/${rec.id}/dismiss`, { reason: dismissReason }),
    onSuccess: () => {
      toast({ title: "Dismissed" });
      setShowDismissForm(false);
      setDismissReason("");
      invalidate();
    },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  const completeMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agents/apex/recommendations/${rec.id}/complete`),
    onSuccess: () => { toast({ title: "Marked complete" }); invalidate(); },
    onError: () => toast({ title: "Failed to mark complete", variant: "destructive" }),
  });

  const isPending = rec.status === "pending_review";
  const isApproved = rec.status === "approved";

  return (
    <Card
      data-testid={`card-apex-rec-${rec.id}`}
      className={`transition-shadow ${
        rec.urgency === "critical" ? "border-red-200 dark:border-red-800 hover:shadow-md" :
        rec.urgency === "high" ? "border-orange-200 dark:border-orange-800 hover:shadow-md" :
        "hover:shadow-sm"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Urgency icon */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            rec.urgency === "critical" ? "bg-red-100 dark:bg-red-900/30" :
            rec.urgency === "high" ? "bg-orange-100 dark:bg-orange-900/30" :
            rec.urgency === "medium" ? "bg-yellow-100 dark:bg-yellow-900/30" :
            "bg-blue-100 dark:bg-blue-900/30"
          }`}>
            <Icon className={`h-4 w-4 ${
              rec.urgency === "critical" ? "text-red-600 dark:text-red-400" :
              rec.urgency === "high" ? "text-orange-600 dark:text-orange-400" :
              rec.urgency === "medium" ? "text-yellow-600 dark:text-yellow-400" :
              "text-blue-600 dark:text-blue-400"
            }`} />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {rank != null && (
                <span className="text-xs font-medium text-muted-foreground">#{rank}</span>
              )}
              <UrgencyBadge urgency={rec.urgency} />
              <StatusBadge status={rec.status} />
              <Badge variant="outline" className="text-[10px]">
                {SIGNAL_LABEL[rec.signalType] ?? rec.signalType.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{rec.entityType}</Badge>
              {value && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  <DollarSign className="h-3 w-3" />
                  {value}
                </span>
              )}
              {(rec.staleDays ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {rec.staleDays}d stale
                </span>
              )}
            </div>

            {/* Entity name */}
            {rec.entityName && (
              <p className="text-xs font-medium text-muted-foreground mb-0.5">{rec.entityName}</p>
            )}

            {/* Recommended action */}
            <p className="text-sm font-semibold text-foreground mb-1">{rec.recommendedAction}</p>

            {/* Reason text (expandable) */}
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

            {/* Dismiss reason (if dismissed) */}
            {rec.status === "dismissed" && rec.dismissReason && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Dismissed: "{rec.dismissReason}"
              </p>
            )}

            {/* Footer row */}
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">{fmtTs(rec.createdAt)}</span>
              {rec.confidenceScore != null && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(rec.confidenceScore * 100)}% confidence
                </span>
              )}

              {/* Source link */}
              {rec.sourceUrl && (
                <a
                  href={rec.sourceUrl}
                  className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 hover:underline font-medium"
                  data-testid={`link-apex-source-${rec.id}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  View {rec.entityType}
                </a>
              )}

              {/* Admin action buttons */}
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

            {/* Dismiss form */}
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

export default function AdminApexAgentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("recommendations");
  const [statusFilter, setStatusFilter] = useState<RecStatus | "all">("pending_review");

  const statusQ = useQuery<ApexStatus>({
    queryKey: ["/api/agents/apex/status"],
    refetchInterval: 30_000,
  });

  const recsQ = useQuery<{ recommendations: ApexRec[]; total: number }>({
    queryKey: ["/api/agents/apex/recommendations", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/agents/apex/recommendations?status=${statusFilter}&limit=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const auditQ = useQuery<AuditData>({
    queryKey: ["/api/agents/apex/audit"],
  });

  const historyQ = useQuery<{ entries: HistoryEntry[]; total: number }>({
    queryKey: ["/api/agents/apex/history"],
  });

  const weeklyQ = useQuery<WeeklySummary>({
    queryKey: ["/api/agents/apex/summary/weekly"],
    enabled: activeTab === "weekly",
  });

  const runMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agents/apex/run"),
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Apex run complete" : "Apex run finished with error",
        description: data.success
          ? `${data.newRecommendations} new recommendation${data.newRecommendations !== 1 ? "s" : ""}, ${data.skippedDuplicates} deduplicated — ${fmtMs(data.durationMs)}`
          : data.error ?? "Check logs for details",
      });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/status"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/recommendations"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/audit"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/history"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/summary/weekly"] });
    },
    onError: () => toast({ title: "Run failed", description: "Could not trigger Apex", variant: "destructive" }),
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
          <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Target className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Apex — Growth Agent</h1>
            <p className="text-sm text-muted-foreground">
              Scores leads, detects stale deals, and surfaces ranked follow-up recommendations daily
            </p>
          </div>
        </div>
        <Button
          data-testid="button-apex-run"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="gap-2"
        >
          {runMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runMut.isPending ? "Running…" : "Run Now"}
        </Button>
      </div>

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
              <span className="text-sm font-semibold capitalize" data-testid="text-apex-status">
                {statusQ.isLoading ? "…" : status?.status === "never_run" ? "Ready" : (status?.status ?? "—")}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Pending Review</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-apex-pending">
              {statusQ.isLoading ? "…" : (status?.pendingRecommendations ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Actions</p>
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400" data-testid="text-apex-total-actions">
              {statusQ.isLoading ? "…" : (status?.totalActions ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last 30 Days</p>
            <p className="text-2xl font-bold text-foreground" data-testid="text-apex-30d-actions">
              {statusQ.isLoading ? "…" : (status?.actionsLast30Days ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last Run</p>
            <p className="text-xs font-medium text-foreground" data-testid="text-apex-last-run">
              {statusQ.isLoading ? "…" : fmtTs(status?.lastRunAt)}
            </p>
            {status?.lastRunNew != null && (
              <p className="text-[10px] text-muted-foreground">
                {status.lastRunNew} new · {status.lastRunDeduped ?? 0} deduped
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Urgent alerts */}
      {(criticalCount > 0 || highCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              {criticalCount} critical signal{criticalCount !== 1 ? "s" : ""} need immediate attention
            </div>
          )}
          {highCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 text-sm font-medium">
              <Zap className="h-4 w-4" />
              {highCount} high-priority signal{highCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="recommendations" data-testid="tab-apex-recommendations">
            Recommendations
            {(status?.pendingRecommendations ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {status!.pendingRecommendations}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="weekly" data-testid="tab-apex-weekly">Weekly Summary</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-apex-audit">Audit</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-apex-history">Action Log</TabsTrigger>
        </TabsList>

        {/* ── Recommendations tab ─────────────────────────────────────────── */}
        <TabsContent value="recommendations" className="space-y-3 mt-4">
          {/* Status filter pills */}
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                data-testid={`filter-${opt.value}`}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === opt.value
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-background text-muted-foreground border-border hover:border-violet-400"
                }`}
              >
                {opt.label}
                {opt.value === "pending_review" && (status?.pendingRecommendations ?? 0) > 0 && (
                  <span className="ml-1.5 font-bold">{status!.pendingRecommendations}</span>
                )}
              </button>
            ))}
          </div>

          {recsQ.isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading recommendations…</div>
          )}
          {!recsQ.isLoading && recs.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {statusFilter === "pending_review"
                    ? "No pending recommendations"
                    : `No ${STATUS_LABEL[statusFilter as RecStatus] ?? statusFilter} recommendations`}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {statusFilter === "pending_review"
                    ? "Run Apex to scan your pipeline for stale deals, cooling leads, and overdue follow-ups."
                    : "Switch filters to see other recommendation states."}
                </p>
                {statusFilter === "pending_review" && (
                  <Button
                    variant="outline" size="sm" className="mt-4 gap-2"
                    onClick={() => runMut.mutate()} disabled={runMut.isPending}
                    data-testid="button-apex-run-empty"
                  >
                    <Play className="h-3 w-3" />
                    Run Apex Now
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          {recs.map((rec, i) => (
            <RecCard key={rec.id} rec={rec} rank={statusFilter === "pending_review" ? i + 1 : undefined} />
          ))}
        </TabsContent>

        {/* ── Weekly Summary tab ──────────────────────────────────────────── */}
        <TabsContent value="weekly" className="space-y-4 mt-4">
          {weeklyQ.isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading weekly summary…</div>
          )}
          {weekly && (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "New Signals", value: weekly.summary.newSignals, icon: ArrowUpRight, color: "text-violet-600 dark:text-violet-400" },
                  { label: "Closed", value: weekly.summary.closedSignals, icon: CheckCircle, color: "text-green-600 dark:text-green-400" },
                  { label: "Pending", value: weekly.summary.pendingCount, icon: Inbox, color: "text-amber-600 dark:text-amber-400" },
                  { label: "Ignored", value: weekly.summary.ignoredSignals, icon: Eye, color: "text-muted-foreground" },
                ].map(kpi => {
                  const KpiIcon = kpi.icon;
                  return (
                    <Card key={kpi.label}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <KpiIcon className={`h-4 w-4 ${kpi.color}`} />
                          <p className="text-xs text-muted-foreground">{kpi.label}</p>
                        </div>
                        <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Pipeline value */}
              {weekly.summary.totalEstimatedValueCents > 0 && (
                <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                          {fmtValue(weekly.summary.totalEstimatedValueCents)} estimated pipeline value in pending recommendations
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">
                          Across {weekly.summary.pendingCount} pending opportunities
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Urgency breakdown */}
              {Object.keys(weekly.summary.urgencyBreakdown).length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Urgency Breakdown (Pending)</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    {(["critical", "high", "medium", "low"] as UrgencyLevel[]).map(u => {
                      const count = weekly.summary.urgencyBreakdown[u] ?? 0;
                      if (count === 0) return null;
                      return (
                        <div key={u} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${URGENCY_COLOR[u]}`}>
                          {u.toUpperCase()} <span className="font-bold">{count}</span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Top revenue opportunities */}
              {weekly.topOpportunities.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-emerald-500" /> Top Revenue Opportunities
                  </h3>
                  <div className="space-y-2">
                    {weekly.topOpportunities.map((rec, i) => (
                      <RecCard key={rec.id} rec={rec} rank={i + 1} />
                    ))}
                  </div>
                </div>
              )}

              {/* New signals this week */}
              {weekly.newSignals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <ArrowUpRight className="h-4 w-4 text-violet-500" /> New This Week ({weekly.summary.newSignals})
                  </h3>
                  <div className="space-y-2">
                    {weekly.newSignals.slice(0, 5).map(rec => (
                      <RecCard key={rec.id} rec={rec} />
                    ))}
                    {weekly.newSignals.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        +{weekly.newSignals.length - 5} more — see Recommendations tab
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Closed signals */}
              {weekly.closedSignals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" /> Closed This Week ({weekly.summary.closedSignals})
                  </h3>
                  <div className="space-y-2">
                    {weekly.closedSignals.slice(0, 5).map(rec => (
                      <RecCard key={rec.id} rec={rec} showActions={false} />
                    ))}
                  </div>
                </div>
              )}

              {/* Ignored signals */}
              {weekly.ignoredSignals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Eye className="h-4 w-4 text-muted-foreground" /> Ignored ({weekly.summary.ignoredSignals})
                  </h3>
                  <div className="space-y-2">
                    {weekly.ignoredSignals.slice(0, 5).map(rec => (
                      <RecCard key={rec.id} rec={rec} showActions={false} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Audit tab ───────────────────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          {auditQ.isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading audit data…</div>
          )}
          {audit && (
            <>
              <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Audit Proof</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{audit.auditNote}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Action log counts */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Action Log (unified_agent_action_log)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Total Actions", value: audit.totals.allTime, color: "text-violet-600 dark:text-violet-400", testId: "text-audit-total" },
                    { label: "Last 30 Days", value: audit.totals.last30Days, color: "text-foreground", testId: "text-audit-30d" },
                    { label: "Pending Review", value: audit.totals.pendingReview, color: "text-amber-600 dark:text-amber-400", testId: "text-audit-pending" },
                    { label: "Completed", value: audit.totals.completed, color: "text-emerald-600 dark:text-emerald-400", testId: "text-audit-completed" },
                    { label: "Failed", value: audit.totals.failed, color: "text-red-600 dark:text-red-400", testId: "text-audit-failed" },
                  ].map(kpi => (
                    <Card key={kpi.label}>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                        <p className={`text-2xl font-bold ${kpi.color}`} data-testid={kpi.testId}>{kpi.value.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Recommendation status counts */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recommendation Lifecycle (apex_recommendations)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Total", value: audit.recommendations.total, color: "text-foreground" },
                    { label: "Pending Review", value: audit.recommendations.pending, color: "text-amber-600 dark:text-amber-400" },
                    { label: "Approved", value: audit.recommendations.approved, color: "text-blue-600 dark:text-blue-400" },
                    { label: "Completed", value: audit.recommendations.completed, color: "text-green-600 dark:text-green-400" },
                    { label: "Dismissed", value: audit.recommendations.dismissed, color: "text-gray-600 dark:text-gray-400" },
                    { label: "Expired", value: audit.recommendations.expired, color: "text-red-500 dark:text-red-400" },
                  ].map(kpi => (
                    <Card key={kpi.label}>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                        <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Signal type breakdown */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Breakdown by Signal Type</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {audit.bySignalType.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-4 py-6 text-center">No actions recorded yet</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left py-2 px-4 font-medium">Signal Type</th>
                          <th className="text-right py-2 px-4 font-medium">Count</th>
                          <th className="text-right py-2 px-4 font-medium">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.bySignalType.map(row => (
                          <tr key={row.signalType} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 px-4 font-mono text-xs">{row.signalType}</td>
                            <td className="py-2 px-4 text-right font-semibold">{row.count}</td>
                            <td className="py-2 px-4 text-right text-muted-foreground text-xs">{fmtTs(row.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Table: </span><code className="font-mono">{audit.table}</code></div>
                  <div><span className="font-medium text-foreground">actor_type: </span><code className="font-mono">'{audit.actorType}'</code></div>
                  <div><span className="font-medium text-foreground">First action: </span>{fmtTs(audit.totals.firstActionAt)}</div>
                  <div><span className="font-medium text-foreground">Latest action: </span>{fmtTs(audit.totals.lastActionAt)}</div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── History tab ─────────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-violet-500" />
                unified_agent_action_log — actor_type = 'growth_agent'
                <Badge variant="outline" className="text-[10px]">{history.length} entries</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historyQ.isLoading && (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">Loading…</p>
              )}
              {!historyQ.isLoading && history.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">No entries yet</p>
              )}
              {history.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Action Type</th>
                        <th className="text-left py-2 px-3 font-medium">Entity</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Risk</th>
                        <th className="text-left py-2 px-3 font-medium">Confidence</th>
                        <th className="text-left py-2 px-3 font-medium">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(entry => (
                        <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-apex-log-${entry.id}`}>
                          <td className="py-2 px-3 font-mono">{entry.actionType}</td>
                          <td className="py-2 px-3 text-muted-foreground">{entry.entityType ?? "—"}</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              entry.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                              entry.status === "requires_approval" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                              entry.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
                              "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            }`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground capitalize">{entry.riskLevel ?? "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {entry.confidenceScore != null ? `${Math.round(entry.confidenceScore * 100)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{fmtTs(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
