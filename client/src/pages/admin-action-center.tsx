import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Inbox,
  Zap,
  Brain,
  Mail,
  Activity,
  Clock,
  Shield,
  ChevronRight,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ActionItem {
  id: string;
  sourceSystem: "hermes" | "autonomous_queue" | "agentmail" | "gmail_agent";
  actionType: string;
  title: string;
  description?: string;
  confidence: number;
  riskLevel: string;
  status: string;
  sourceAgent?: string;
  gmailThreadId?: string;
  sourceConversationId?: string;
  draftPreview?: string;
  workflowSource?: string;
  auditHistory?: any[];
  createdAt: string;
}

interface ActionCenterSummary {
  pending: {
    total: number;
    hermes: number;
    autonomousQueue: number;
    agentmail: number;
    gmailAgent: number;
  };
  executions: {
    totalExecutions: number;
    completed: number;
    failed: number;
    successRate: number;
    avgLatencyMs: number;
  };
  conflicts: { open: number; total: number };
  hermes: {
    totalRecommendations: number;
    pendingReview: number;
    approvalRate: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sourceLabel(s: string) {
  const m: Record<string, string> = {
    hermes: "Hermes",
    autonomous_queue: "Auto Queue",
    agentmail: "AgentMail",
    gmail_agent: "Gmail Agent",
  };
  return m[s] ?? s;
}

function sourceIcon(s: string) {
  const m: Record<string, any> = {
    hermes: Brain,
    autonomous_queue: Zap,
    agentmail: Mail,
    gmail_agent: Mail,
  };
  const Icon = m[s] ?? Activity;
  return <Icon className="h-3.5 w-3.5" />;
}

function riskBadge(risk: string) {
  const colors: Record<string, string> = {
    low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[risk] ?? colors.medium}`}>
      {risk}
    </span>
  );
}

function confidenceBadge(confidence: number) {
  const pct = confidence > 1 ? confidence : Math.round(confidence * 100);
  const color =
    pct >= 80 ? "text-green-600 dark:text-green-400" :
    pct >= 60 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-600 dark:text-red-400";
  return <span className={`text-sm font-bold ${color}`}>{pct}%</span>;
}

// ─── Action Card Component ─────────────────────────────────────────────────────
function ActionCard({
  item,
  onApprove,
  onReject,
  onEscalate,
  onDetail,
  loading,
}: {
  item: ActionItem;
  onApprove: (item: ActionItem) => void;
  onReject: (item: ActionItem) => void;
  onEscalate: (item: ActionItem) => void;
  onDetail: (item: ActionItem) => void;
  loading?: boolean;
}) {
  return (
    <Card
      className="border border-border/60 hover:border-border transition-all"
      data-testid={`action-card-${item.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Source + Risk row */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                {sourceIcon(item.sourceSystem)}
                {sourceLabel(item.sourceSystem)}
              </span>
              <span className="text-muted-foreground/40">·</span>
              {riskBadge(item.riskLevel ?? "medium")}
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground">{item.actionType}</span>
            </div>

            {/* Title */}
            <p className="font-medium text-sm leading-snug mb-1 truncate" title={item.title}>
              {item.title}
            </p>

            {/* Description */}
            {item.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {item.description}
              </p>
            )}

            {/* Draft preview */}
            {item.draftPreview && (
              <div className="bg-muted/40 rounded p-2 text-xs text-muted-foreground line-clamp-2 mb-2 border-l-2 border-primary/40">
                {item.draftPreview}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
              {item.sourceAgent && <span>Agent: {item.sourceAgent}</span>}
              <span className="flex items-center gap-1">
                Confidence: {confidenceBadge(item.confidence)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onApprove(item)}
              disabled={loading}
              data-testid={`btn-approve-${item.id}`}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20"
              onClick={() => onReject(item)}
              disabled={loading}
              data-testid={`btn-reject-${item.id}`}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              onClick={() => onEscalate(item)}
              disabled={loading}
              data-testid={`btn-escalate-${item.id}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> Escalate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onDetail(item)}
              data-testid={`btn-detail-${item.id}`}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminActionCenterPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; item: ActionItem | null }>({
    open: false,
    item: null,
  });
  const [rejectReason, setRejectReason] = useState("");
  const [detailDialog, setDetailDialog] = useState<{ open: boolean; item: ActionItem | null }>({
    open: false,
    item: null,
  });
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useQuery<ActionCenterSummary>({
    queryKey: ["/api/action-center/summary"],
    refetchInterval: 30000,
  });

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<{
    items: ActionItem[];
    total: number;
  }>({
    queryKey: ["/api/hermes/queue"],
    refetchInterval: 30000,
  });

  const { data: execData } = useQuery<{ events: any[]; total: number }>({
    queryKey: ["/api/executions"],
    refetchInterval: 30000,
  });

  const { data: conflictData } = useQuery<{ conflicts: any[]; stats: any }>({
    queryKey: ["/api/conflicts"],
    refetchInterval: 30000,
  });

  // ─── Mutations ────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/actions/approve", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hermes/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/action-center/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/executions"] });
      toast({ title: "Action approved", description: "Execution has been triggered." });
      setLoadingId(null);
    },
    onError: (e: any) => {
      toast({ title: "Approval failed", description: e?.message, variant: "destructive" });
      setLoadingId(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/actions/reject", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hermes/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/action-center/summary"] });
      toast({ title: "Action rejected" });
      setRejectDialog({ open: false, item: null });
      setRejectReason("");
      setLoadingId(null);
    },
    onError: (e: any) => {
      toast({ title: "Rejection failed", description: e?.message, variant: "destructive" });
      setLoadingId(null);
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/actions/escalate", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/action-center/summary"] });
      toast({ title: "Escalated", description: "Item sent to escalation queue." });
      setLoadingId(null);
    },
    onError: (e: any) => {
      toast({ title: "Escalation failed", description: e?.message, variant: "destructive" });
      setLoadingId(null);
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleApprove = (item: ActionItem) => {
    setLoadingId(item.id);
    approveMutation.mutate({ actionId: item.id, sourceSystem: item.sourceSystem });
  };

  const handleReject = (item: ActionItem) => {
    setRejectDialog({ open: true, item });
  };

  const handleRejectConfirm = () => {
    if (!rejectDialog.item) return;
    setLoadingId(rejectDialog.item.id);
    rejectMutation.mutate({
      actionId: rejectDialog.item.id,
      sourceSystem: rejectDialog.item.sourceSystem,
      reason: rejectReason || "Rejected by admin",
    });
  };

  const handleEscalate = (item: ActionItem) => {
    setLoadingId(item.id);
    escalateMutation.mutate({
      actionId: item.id,
      sourceSystem: item.sourceSystem,
      title: `Escalated: ${item.title}`,
      reason: item.description,
    });
  };

  // ─── Filter items by tab ─────────────────────────────────────────────────
  const allItems: ActionItem[] = (queueData?.items ?? []) as ActionItem[];
  const filteredItems =
    activeTab === "all"
      ? allItems
      : allItems.filter((i) => i.sourceSystem === activeTab);

  const isLoading = queueLoading || summaryLoading;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Action Center</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Unified approval hub — Hermes, Gmail, Autonomous Queue, AgentMail
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchQueue()}
          data-testid="btn-refresh-queue"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Pending Actions",
            value: summary?.pending.total ?? "—",
            icon: Inbox,
            color: "text-blue-600 dark:text-blue-400",
            testId: "stat-pending-total",
          },
          {
            label: "Executed Today",
            value: summary?.executions.totalExecutions ?? "—",
            icon: Zap,
            color: "text-green-600 dark:text-green-400",
            testId: "stat-executions-total",
          },
          {
            label: "Success Rate",
            value: summary?.executions.successRate != null ? `${summary.executions.successRate}%` : "—",
            icon: CheckCircle,
            color: "text-emerald-600 dark:text-emerald-400",
            testId: "stat-success-rate",
          },
          {
            label: "Open Conflicts",
            value: summary?.conflicts.open ?? "—",
            icon: AlertTriangle,
            color: summary?.conflicts.open ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground",
            testId: "stat-conflicts-open",
          },
        ].map((s) => (
          <Card key={s.label} className="border border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold" data-testid={s.testId}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Source Breakdown */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: "Hermes", key: "hermes" as const, icon: Brain },
            { label: "Auto Queue", key: "autonomousQueue" as const, icon: Zap },
            { label: "AgentMail", key: "agentmail" as const, icon: Mail },
            { label: "Gmail Agent", key: "gmailAgent" as const, icon: Mail },
          ].map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 border border-border/50 text-sm"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </span>
              <span className="font-semibold" data-testid={`stat-pending-${s.key}`}>
                {(summary.pending as any)[s.key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action Queue */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            All ({allItems.length})
          </TabsTrigger>
          <TabsTrigger value="hermes" data-testid="tab-hermes">
            Hermes ({allItems.filter((i) => i.sourceSystem === "hermes").length})
          </TabsTrigger>
          <TabsTrigger value="autonomous_queue" data-testid="tab-auto-queue">
            Auto Queue ({allItems.filter((i) => i.sourceSystem === "autonomous_queue").length})
          </TabsTrigger>
          <TabsTrigger value="agentmail" data-testid="tab-agentmail">
            AgentMail ({allItems.filter((i) => i.sourceSystem === "agentmail").length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-28 rounded-lg bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-10 text-center">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 text-green-500" />
                <p className="font-medium text-sm">All clear — no pending actions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Hermes, AgentMail, and all queues are empty.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <ActionCard
                  key={item.id}
                  item={item}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEscalate={handleEscalate}
                  onDetail={(i) => setDetailDialog({ open: true, item: i })}
                  loading={loadingId === item.id}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Conflicts Panel */}
      {(conflictData?.conflicts?.length ?? 0) > 0 && (
        <Card className="border-orange-200 dark:border-orange-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-4 w-4" />
              Open Conflicts ({conflictData?.conflicts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(conflictData?.conflicts ?? []).map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/10 text-sm"
                  data-testid={`conflict-card-${c.id}`}
                >
                  <div>
                    <p className="font-medium">{c.conflictType?.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.agentActions?.length ?? 0} agents involved · Severity: {c.severity}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                    {c.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Executions */}
      {(execData?.events?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Executions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(execData?.events ?? []).slice(0, 8).map((e: any) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
                  data-testid={`exec-row-${e.id}`}
                >
                  <div className="flex items-center gap-2">
                    {e.status === "completed" ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : e.status === "failed" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                    )}
                    <span className="font-medium">{e.execution_type}</span>
                    <span className="text-muted-foreground text-xs">{e.source_system}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {e.latency_ms && <span>{e.latency_ms}ms</span>}
                    <span>{new Date(e.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Safety banner */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 border border-border/40">
        <Shield className="h-4 w-4 shrink-0 text-primary" />
        Human override always wins. Every approval is logged to the execution audit trail.
        Conflicts require explicit human resolution before actions proceed.
      </div>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(o) => !o && setRejectDialog({ open: false, item: null })}
      >
        <DialogContent data-testid="dialog-reject">
          <DialogHeader>
            <DialogTitle>Reject Action</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Rejecting: <strong>{rejectDialog.item?.title}</strong>
          </p>
          <Textarea
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="mt-2"
            data-testid="input-reject-reason"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRejectDialog({ open: false, item: null })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending}
              data-testid="btn-confirm-reject"
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog
        open={detailDialog.open}
        onOpenChange={(o) => !o && setDetailDialog({ open: false, item: null })}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-detail">
          <DialogHeader>
            <DialogTitle>Action Details</DialogTitle>
          </DialogHeader>
          {detailDialog.item && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="font-medium">{sourceLabel(detailDialog.item.sourceSystem)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="font-medium">{detailDialog.item.actionType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Risk</p>
                  {riskBadge(detailDialog.item.riskLevel ?? "medium")}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  {confidenceBadge(detailDialog.item.confidence)}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Title</p>
                <p className="font-medium">{detailDialog.item.title}</p>
              </div>
              {detailDialog.item.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-muted-foreground">{detailDialog.item.description}</p>
                </div>
              )}
              {detailDialog.item.draftPreview && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Draft Preview</p>
                  <div className="bg-muted/40 rounded p-2 text-xs border-l-2 border-primary/40">
                    {detailDialog.item.draftPreview}
                  </div>
                </div>
              )}
              {detailDialog.item.gmailThreadId && (
                <div>
                  <p className="text-xs text-muted-foreground">Thread ID</p>
                  <p className="text-xs font-mono">{detailDialog.item.gmailThreadId}</p>
                </div>
              )}
              {detailDialog.item.workflowSource && (
                <div>
                  <p className="text-xs text-muted-foreground">Workflow Source</p>
                  <p>{detailDialog.item.workflowSource}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDetailDialog({ open: false, item: null })}>
              Close
            </Button>
            {detailDialog.item && (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  handleApprove(detailDialog.item!);
                  setDetailDialog({ open: false, item: null });
                }}
                data-testid="btn-approve-from-detail"
              >
                <CheckCircle className="h-4 w-4 mr-2" /> Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
