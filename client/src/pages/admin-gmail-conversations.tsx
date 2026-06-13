import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Inbox,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  User,
  Tag,
  AlertTriangle,
  Zap,
  FlaskConical,
  ChevronRight,
  Activity,
  WifiOff,
} from "lucide-react";

type GmailConversation = {
  id: string;
  orgId: string;
  leadId?: string;
  dealId?: string;
  clientId?: string;
  gmailThreadId: string;
  lastMessageId?: string;
  subject?: string;
  participantEmail?: string;
  participantName?: string;
  status: string;
  intent?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastSnippet?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type GmailAgentAction = {
  id: string;
  orgId: string;
  actionType: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  leadId?: string;
  dealId?: string;
  recipientEmail?: string;
  subject?: string;
  riskLevel: string;
  approvalRequired: boolean;
  status: string;
  result?: any;
  errorMessage?: string;
  createdByAgent?: string;
  approvedBy?: string;
  createdAt: string;
  executedAt?: string;
};

type GmailSyncStatus = {
  lastGmailSyncAt: string | null;
  nextGmailSyncAt: string | null;
  lastGmailSyncStatus: "idle" | "running" | "success" | "failed" | "skipped";
  lastGmailSyncError: string | null;
};

const INTENT_LABELS: Record<string, { label: string; color: string }> = {
  interested: { label: "Interested", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  wants_more_info: { label: "Wants Info", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  wants_schedule: { label: "Wants to Schedule", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  objection: { label: "Has Objection", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  not_interested: { label: "Not Interested", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  wrong_person: { label: "Wrong Person", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  unsubscribe: { label: "Unsubscribe", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  spam: { label: "Spam", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  unknown: { label: "Unknown", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  needs_response: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  processed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  suppressed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const ACTION_STATUS_COLORS: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  awaiting_approval: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  executed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  critical: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200",
};

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function timeUntil(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "any moment";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h`;
}

function suggestNextAction(convo: GmailConversation): string {
  switch (convo.intent) {
    case "wants_schedule": return "Send scheduling link or propose a call time";
    case "interested": return "Send follow-up with more details or a proposal";
    case "objection": return "Draft objection-handling response";
    case "wants_more_info": return "Draft informational reply";
    case "not_interested":
    case "unsubscribe": return "Mark as suppressed — no further outreach";
    default: return "Review and classify reply";
  }
}

function SyncStatusRow({
  syncStatus,
  isSyncing,
}: {
  syncStatus: GmailSyncStatus | undefined;
  isSyncing: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const status = isSyncing ? "running" : (syncStatus?.lastGmailSyncStatus ?? "idle");

  const statusConfig: Record<string, { label: string; className: string; Icon: typeof Activity }> = {
    idle: { label: "Idle", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", Icon: Clock },
    running: { label: "Running", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Icon: RefreshCw },
    success: { label: "Healthy", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300", Icon: CheckCircle },
    failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", Icon: WifiOff },
    skipped: { label: "Skipped", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", Icon: Clock },
  };

  const cfg = statusConfig[status] ?? statusConfig.idle;
  const { Icon } = cfg;

  return (
    <div
      className="flex items-center gap-4 px-3 py-2 rounded-lg bg-muted/50 border text-xs flex-wrap"
      data-testid="sync-status-row"
    >
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground font-medium">Auto-sync</span>
      </div>

      <div className="flex items-center gap-1 text-muted-foreground" data-testid="sync-last-synced">
        <Clock className="h-3 w-3" />
        <span>Last synced: <span className="font-medium text-foreground">{timeAgo(syncStatus?.lastGmailSyncAt)}</span></span>
      </div>

      <div className="flex items-center gap-1 text-muted-foreground" data-testid="sync-next-sync">
        <RefreshCw className="h-3 w-3" />
        <span>Next sync: <span className="font-medium text-foreground">{timeUntil(syncStatus?.nextGmailSyncAt)}</span></span>
      </div>

      <div className="flex items-center gap-1.5" data-testid="sync-status-badge">
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
          <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
          {cfg.label}
        </span>
      </div>

      {syncStatus?.lastGmailSyncError && status === "failed" && (
        <span className="text-red-600 dark:text-red-400 truncate max-w-xs" data-testid="sync-error-msg">
          {syncStatus.lastGmailSyncError}
        </span>
      )}
    </div>
  );
}

export default function AdminGmailConversationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<GmailConversation | null>(null);
  const [syncLog, setSyncLog] = useState<string[]>([]);

  const conversationsQuery = useQuery<GmailConversation[]>({
    queryKey: ["/api/org/gmail/conversations"],
    refetchInterval: 60 * 60 * 1000,
  });

  const actionsQuery = useQuery<GmailAgentAction[]>({
    queryKey: ["/api/org/gmail/actions"],
    refetchInterval: 60 * 60 * 1000,
  });

  const syncStatusQuery = useQuery<GmailSyncStatus>({
    queryKey: ["/api/org/gmail/sync-status"],
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/gmail/sync-replies"),
    onSuccess: (data: any) => {
      if (data?.message === "Sync already in progress") {
        toast({ title: "Sync already in progress", description: "An hourly sync is running — try again shortly.", variant: "destructive" });
        return;
      }
      toast({ title: "Sync complete", description: `${data.synced ?? 0} replies synced, ${data.classified ?? 0} classified, ${data.actionsQueued ?? 0} actions queued` });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/sync-status"] });
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        toast({ title: "Sync already in progress", description: "An hourly sync is running — try again shortly." });
        return;
      }
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/sync-status"] });
    },
  });

  const testSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/gmail/test-sync"),
    onSuccess: (data: any) => {
      setSyncLog(data.logs ?? []);
      toast({ title: "Test sync complete", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
    },
    onError: (err: any) => {
      toast({ title: "Test sync failed", description: err.message, variant: "destructive" });
    },
  });

  const markProcessedMutation = useMutation({
    mutationFn: (threadId: string) => apiRequest("POST", `/api/org/gmail/conversations/${threadId}/mark-processed`),
    onSuccess: () => {
      toast({ title: "Marked as processed" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/conversations"] });
      setSelectedConvo(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const approveActionMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/gmail/actions/${id}/approve`),
    onSuccess: () => {
      toast({ title: "Action approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const cancelActionMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/gmail/actions/${id}/cancel`),
    onSuccess: () => {
      toast({ title: "Action cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];

  const unprocessed = conversations.filter((c) => c.status !== "processed" && c.status !== "suppressed");
  const pendingActions = actions.filter((a) => a.status === "proposed" || a.status === "awaiting_approval");

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-blue-600" />
            Gmail Conversations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-tracked inbound replies, intent classification, and suggested next actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => testSyncMutation.mutate()}
            disabled={testSyncMutation.isPending}
            data-testid="button-test-sync"
          >
            <FlaskConical className="h-4 w-4 mr-1" />
            Test Sync
          </Button>
          <Button
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || syncStatusQuery.data?.lastGmailSyncStatus === "running"}
            data-testid="button-sync-replies"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync Replies"}
          </Button>
        </div>
      </div>

      {/* Sync Status Row */}
      <SyncStatusRow
        syncStatus={syncStatusQuery.data}
        isSyncing={syncMutation.isPending}
      />

      {/* Phase 8 — Gmail Draft-Only Safety Notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-sm" data-testid="banner-gmail-safety">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-purple-500" />
        <span>
          <strong>Draft-Only Agent Mode:</strong> Gmail agent tool sends are routed to Drafts only — no direct auto-send from agent workflows.
          Review and send drafts manually from your Gmail inbox.
          {" "}<a href="/admin/email-audit" className="underline font-medium">View Email Audit Log →</a>
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Conversations", value: conversations.length, icon: Inbox, color: "text-blue-600" },
          { label: "Needs Response", value: unprocessed.length, icon: AlertTriangle, color: "text-amber-600" },
          { label: "Pending Actions", value: pendingActions.length, icon: Clock, color: "text-purple-600" },
          { label: "Processed", value: conversations.filter((c) => c.status === "processed").length, icon: CheckCircle, color: "text-green-600" },
        ].map((stat) => (
          <Card key={stat.label} data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Test sync logs */}
      {syncLog.length > 0 && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-blue-600" />
              Test Sync Logs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {syncLog.map((line, i) => (
                <li key={i} className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="conversations">
        <TabsList data-testid="tabs-gmail">
          <TabsTrigger value="conversations" data-testid="tab-conversations">
            Conversations {unprocessed.length > 0 && <span className="ml-1 text-xs bg-amber-500 text-white rounded-full px-1.5">{unprocessed.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-actions">
            Action Queue {pendingActions.length > 0 && <span className="ml-1 text-xs bg-purple-500 text-white rounded-full px-1.5">{pendingActions.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* ── Conversations Tab ── */}
        <TabsContent value="conversations" className="space-y-3 mt-4">
          {conversationsQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : conversations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No conversations yet</p>
              <p className="text-sm">Click "Sync Replies" to pull recent inbound emails, or use "Test Sync" to inject sample data.</p>
            </div>
          ) : (
            conversations.map((convo) => {
              const intentInfo = INTENT_LABELS[convo.intent ?? "unknown"] ?? INTENT_LABELS.unknown;
              return (
                <Card
                  key={convo.id}
                  className="cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => setSelectedConvo(convo)}
                  data-testid={`card-conversation-${convo.id}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">{convo.participantName || convo.participantEmail || "Unknown"}</span>
                            {convo.participantEmail && convo.participantName && (
                              <span className="text-xs text-muted-foreground truncate">&lt;{convo.participantEmail}&gt;</span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate mt-0.5">{convo.subject || "(no subject)"}</p>
                          {convo.lastSnippet && (
                            <p className="text-xs text-muted-foreground truncate mt-1 italic">{convo.lastSnippet}</p>
                          )}
                          {convo.intent && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                              Suggested: {suggestNextAction(convo)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">{timeAgo(convo.lastInboundAt ?? convo.updatedAt)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${intentInfo.color}`}>{intentInfo.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[convo.status] ?? "bg-gray-100 text-gray-600"}`}>{convo.status}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ── Action Queue Tab ── */}
        <TabsContent value="actions" className="space-y-3 mt-4">
          {actionsQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : actions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No actions in queue</p>
              <p className="text-sm">Actions appear here when the agent proposes drafts or follow-ups.</p>
            </div>
          ) : (
            actions.map((action) => (
              <Card key={action.id} data-testid={`card-action-${action.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{action.actionType.replace(/_/g, " ")}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_STATUS_COLORS[action.status] ?? "bg-gray-100 text-gray-600"}`}>{action.status}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_COLORS[action.riskLevel] ?? "bg-gray-100"}`}>
                          {action.riskLevel} risk
                        </span>
                        {action.approvalRequired && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                            needs approval
                          </span>
                        )}
                      </div>
                      {action.recipientEmail && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {action.recipientEmail}
                        </p>
                      )}
                      {action.subject && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{action.subject}</p>
                      )}
                      {action.createdByAgent && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Tag className="h-3 w-3" /> {action.createdByAgent}
                        </p>
                      )}
                      {action.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">{action.errorMessage}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">{timeAgo(action.createdAt)}</span>
                      {(action.status === "proposed" || action.status === "awaiting_approval") && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs px-2.5"
                            onClick={() => approveActionMutation.mutate(action.id)}
                            disabled={approveActionMutation.isPending}
                            data-testid={`button-approve-action-${action.id}`}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2.5"
                            onClick={() => cancelActionMutation.mutate(action.id)}
                            disabled={cancelActionMutation.isPending}
                            data-testid={`button-cancel-action-${action.id}`}
                          >
                            <XCircle className="h-3 w-3 mr-1" /> Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Conversation Detail Dialog */}
      <Dialog open={!!selectedConvo} onOpenChange={() => setSelectedConvo(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blue-600" />
              Conversation Detail
            </DialogTitle>
          </DialogHeader>
          {selectedConvo && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{selectedConvo.participantName || "Unknown"}</span>
                  {selectedConvo.participantEmail && (
                    <span className="text-sm text-muted-foreground">&lt;{selectedConvo.participantEmail}&gt;</span>
                  )}
                </div>
                <p className="text-sm font-medium">{selectedConvo.subject || "(no subject)"}</p>
                {selectedConvo.lastSnippet && (
                  <p className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{selectedConvo.lastSnippet}</p>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Intent</p>
                  {selectedConvo.intent ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTENT_LABELS[selectedConvo.intent]?.color ?? ""}`}>
                      {INTENT_LABELS[selectedConvo.intent]?.label ?? selectedConvo.intent}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selectedConvo.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {selectedConvo.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Last inbound</p>
                  <span>{timeAgo(selectedConvo.lastInboundAt)}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Last outbound</p>
                  <span>{timeAgo(selectedConvo.lastOutboundAt)}</span>
                </div>
                {selectedConvo.leadId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Lead ID</p>
                    <span className="font-mono text-xs">{selectedConvo.leadId.slice(0, 8)}…</span>
                  </div>
                )}
                {selectedConvo.dealId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Deal ID</p>
                    <span className="font-mono text-xs">{selectedConvo.dealId.slice(0, 8)}…</span>
                  </div>
                )}
              </div>

              {selectedConvo.intent && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Suggested Next Action</p>
                    <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <Zap className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-blue-800 dark:text-blue-200">{suggestNextAction(selectedConvo)}</p>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedConvo(null)}
                  data-testid="button-close-convo-dialog"
                >
                  Close
                </Button>
                {selectedConvo.status !== "processed" && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => markProcessedMutation.mutate(selectedConvo.gmailThreadId)}
                    disabled={markProcessedMutation.isPending}
                    data-testid="button-mark-processed"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Mark Processed
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
