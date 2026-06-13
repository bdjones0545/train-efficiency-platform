import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Eye,
  ShieldCheck,
  ShieldX,
  Pencil,
  MessageSquare,
  Bot,
  GitBranch,
  Info,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  bodyPreview?: string;
  riskLevel: string;
  approvalRequired: boolean;
  status: string;
  result?: {
    draftBody?: string;
    reasoning?: string;
    confidence?: number;
    schedulingSlots?: string[];
    [key: string]: any;
  };
  errorMessage?: string;
  createdByAgent?: string;
  approvedBy?: string;
  createdAt: string;
  executedAt?: string;
  communicationDomain?: string;
};

type ActionDetail = {
  action: GmailAgentAction;
  conversation: GmailConversation | null;
};

type GmailSyncStatus = {
  lastGmailSyncAt: string | null;
  nextGmailSyncAt: string | null;
  lastGmailSyncStatus: "idle" | "running" | "success" | "failed" | "skipped";
  lastGmailSyncError: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

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
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  critical: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeUntil(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "any moment";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.floor(mins / 60)}h`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

function deriveReasoning(actionType: string, result?: GmailAgentAction["result"]): string {
  if (result?.reasoning) return result.reasoning;
  const map: Record<string, string> = {
    "propose_draft:scheduling_response": "Scheduling request detected in inbound reply — agent drafted a response with available time slots.",
    "propose_draft:followup": "Follow-up triggered after no response period — lead recovery workflow initiated.",
    "propose_draft:lead_recovery": "Lead recovery workflow triggered — prospect went silent after initial contact.",
    "propose_draft:objection_handling": "Objection detected in reply — agent drafted a handling response.",
    "propose_draft:info_response": "Information request detected — agent drafted an informational reply.",
    "propose_draft:scheduling": "Scheduling intent classified from reply — agent drafted a booking response.",
    "send_draft": "Approved draft queued for send.",
    "classify_reply": "Inbound reply classification requested.",
  };
  const lower = actionType.toLowerCase();
  for (const [key, label] of Object.entries(map)) {
    if (lower.includes(key.split(":")[1] ?? key) || lower === key) return label;
  }
  if (lower.includes("schedule")) return "Scheduling request detected in inbound reply.";
  if (lower.includes("followup") || lower.includes("follow")) return "Follow-up triggered after no response period.";
  if (lower.includes("recovery")) return "Lead recovery workflow triggered.";
  return `Agent action: ${actionType.replace(/_/g, " ").replace(/:/g, " — ")}`;
}

function deriveConfidence(action: GmailAgentAction): number {
  if (action.result?.confidence != null) return Math.round(action.result.confidence);
  const map: Record<string, number> = { low: 88, medium: 65, high: 42, critical: 25 };
  return map[action.riskLevel] ?? 65;
}

function friendlyActionType(actionType: string): string {
  return actionType
    .replace(/propose_draft:/i, "Draft: ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

// ─── Sync Status Row ─────────────────────────────────────────────────────────

function SyncStatusRow({ syncStatus, isSyncing }: { syncStatus?: GmailSyncStatus; isSyncing: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const status = isSyncing ? "running" : (syncStatus?.lastGmailSyncStatus ?? "idle");
  const cfgMap = {
    idle: { label: "Idle", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", Icon: Clock },
    running: { label: "Running", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Icon: RefreshCw },
    success: { label: "Healthy", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300", Icon: CheckCircle },
    failed: { label: "Failed", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", Icon: WifiOff },
    skipped: { label: "Skipped", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", Icon: Clock },
  };
  const cfg = cfgMap[status as keyof typeof cfgMap] ?? cfgMap.idle;
  const { Icon } = cfg;

  return (
    <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-muted/50 border text-xs flex-wrap" data-testid="sync-status-row">
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
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
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

// ─── Draft Review Modal ───────────────────────────────────────────────────────

type ModalMode = "view" | "edit" | "reject";

function DraftReviewModal({
  actionId,
  onClose,
  onApproved,
  onRejected,
}: {
  actionId: string | null;
  onClose: () => void;
  onApproved: () => void;
  onRejected: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ModalMode>("view");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const detailQuery = useQuery<ActionDetail>({
    queryKey: ["/api/org/gmail/actions", actionId, "detail"],
    queryFn: () => apiRequest("GET", `/api/org/gmail/actions/${actionId}/detail`).then(r => r.json()),
    enabled: !!actionId,
  });

  // Record "viewed" audit event once detail loads
  const viewMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/gmail/actions/${actionId}/view`),
  });
  useEffect(() => {
    if (detailQuery.data && actionId) {
      viewMutation.mutate();
    }
  }, [detailQuery.data?.action?.id]);

  // Seed edit fields when data loads
  useEffect(() => {
    if (detailQuery.data?.action) {
      const a = detailQuery.data.action;
      setEditSubject(a.subject ?? "");
      setEditBody(a.result?.draftBody ?? a.bodyPreview ?? "");
    }
  }, [detailQuery.data?.action?.id]);

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/gmail/actions/${actionId}/approve`),
    onSuccess: () => {
      toast({ title: "Draft approved", description: "Action moved to approved status." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/sync-status"] });
      onApproved();
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const editApproveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/gmail/actions/${actionId}/edit-approve`, {
      subject: editSubject,
      body: editBody,
    }),
    onSuccess: () => {
      toast({ title: "Draft edited & approved", description: "Your edits have been saved and the action approved." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
      onApproved();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/gmail/actions/${actionId}/reject`, {
      reason: rejectReason || "Rejected by reviewer",
    }),
    onSuccess: () => {
      toast({ title: "Draft rejected", description: "Action marked as rejected." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
      onRejected();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const isOpen = !!actionId;
  const action = detailQuery.data?.action;
  const conversation = detailQuery.data?.conversation;
  const isPending = action?.status === "proposed" || action?.status === "awaiting_approval";
  const draftBody = action?.result?.draftBody ?? action?.bodyPreview ?? "";
  const confidence = action ? deriveConfidence(action) : 0;
  const reasoning = action ? deriveReasoning(action.actionType, action.result) : "";

  const handleClose = () => {
    setMode("view");
    setRejectReason("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-full max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b sticky top-0 bg-background z-10">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="h-5 w-5 text-blue-600 shrink-0" />
            {mode === "edit" ? "Edit Draft" : mode === "reject" ? "Reject Action" : "Draft Review"}
          </DialogTitle>
          {action && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_STATUS_COLORS[action.status] ?? ""}`}>
                {action.status}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_COLORS[action.riskLevel] ?? ""}`}>
                {action.riskLevel} risk
              </span>
              {action.approvalRequired && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  needs approval
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          {detailQuery.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}

          {action && (
            <>
              {/* ── Section 1: Metadata ── */}
              <section data-testid="modal-section-metadata">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" /> Recipient & Details
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "Recipient", value: action.recipientEmail ?? "—", icon: Mail },
                    { label: "Subject", value: action.subject ?? "—", icon: MessageSquare },
                    { label: "Created", value: formatDate(action.createdAt), icon: Clock },
                    { label: "Agent", value: action.createdByAgent?.replace(/_/g, " ") ?? "—", icon: Bot },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">{label}</p>
                        <p className="text-sm font-medium truncate">{value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <Separator />

              {/* ── Section 2: Draft Body ── */}
              <section data-testid="modal-section-draft">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Draft Body
                </h3>
                {mode === "edit" ? (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Subject</Label>
                      <Input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="mt-1"
                        data-testid="input-edit-subject"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Body</Label>
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="mt-1 min-h-[200px] font-mono text-sm resize-y"
                        data-testid="textarea-edit-body"
                      />
                    </div>
                  </div>
                ) : draftBody ? (
                  <div className="p-4 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 whitespace-pre-wrap text-sm leading-relaxed font-mono" data-testid="draft-body-text">
                    {draftBody}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/30 border text-sm text-muted-foreground italic text-center" data-testid="draft-body-empty">
                    No draft body stored — agent queued this action without generating body text yet.
                  </div>
                )}
              </section>

              <Separator />

              {/* ── Section 3: AI Reasoning ── */}
              <section data-testid="modal-section-reasoning">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5" /> AI Reasoning
                </h3>
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 flex items-start gap-2">
                  <Zap className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-purple-900 dark:text-purple-200">{reasoning}</p>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">
                    Action type: <code className="bg-muted px-1 rounded text-xs">{action.actionType}</code>
                    {action.communicationDomain && (
                      <> · Domain: <code className="bg-muted px-1 rounded text-xs">{action.communicationDomain}</code></>
                    )}
                  </p>
                </div>
              </section>

              <Separator />

              {/* ── Section 4: Risk Assessment ── */}
              <section data-testid="modal-section-risk">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Risk Assessment
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Risk Level</p>
                    <span className={`text-sm px-2 py-0.5 rounded-full font-semibold ${RISK_COLORS[action.riskLevel] ?? ""}`}>
                      {action.riskLevel.charAt(0).toUpperCase() + action.riskLevel.slice(1)}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${confidence >= 80 ? "bg-green-500" : confidence >= 55 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${confidence}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{confidence}%</span>
                    </div>
                  </div>
                </div>
              </section>

              <Separator />

              {/* ── Section 5: Source Context ── */}
              <section data-testid="modal-section-context">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" /> Source Context
                </h3>
                {conversation ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-0.5">Original Thread Subject</p>
                        <p className="font-medium truncate">{conversation.subject ?? "—"}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-0.5">Participant</p>
                        <p className="font-medium truncate">{conversation.participantName ?? conversation.participantEmail ?? "—"}</p>
                        {conversation.participantEmail && conversation.participantName && (
                          <p className="text-xs text-muted-foreground truncate">{conversation.participantEmail}</p>
                        )}
                      </div>
                    </div>
                    {conversation.lastSnippet && (
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-1">Most Recent Inbound Message</p>
                        <p className="text-sm italic text-muted-foreground">"{conversation.lastSnippet}"</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-0.5">Classification</p>
                        {conversation.intent ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTENT_LABELS[conversation.intent]?.color ?? ""}`}>
                            {INTENT_LABELS[conversation.intent]?.label ?? conversation.intent}
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-0.5">Workflow</p>
                        <p className="text-sm font-medium">{action.createdByAgent?.replace(/_/g, " ") ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-muted/30 border text-sm text-muted-foreground">
                    {action.gmailThreadId
                      ? "Conversation context not found for this thread."
                      : "No thread linked to this action."}
                  </div>
                )}
              </section>

              {/* ── Reject Mode: Reason Input ── */}
              {mode === "reject" && (
                <>
                  <Separator />
                  <section data-testid="modal-section-reject">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                      <ShieldX className="h-3.5 w-3.5 text-red-500" /> Rejection Reason
                    </h3>
                    <Textarea
                      placeholder="Optional: explain why this draft is being rejected…"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="min-h-[80px] resize-none"
                      data-testid="textarea-reject-reason"
                    />
                  </section>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer Actions ── */}
        <DialogFooter className="px-6 py-4 border-t sticky bottom-0 bg-background z-10 flex flex-col sm:flex-row gap-2">
          {action && isPending && mode === "view" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("edit")} data-testid="button-edit-draft" className="w-full sm:w-auto order-3 sm:order-1">
                <Pencil className="h-4 w-4 mr-1.5" /> Edit Draft
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setMode("reject")}
                data-testid="button-reject-draft"
                className="w-full sm:w-auto order-2"
              >
                <ShieldX className="h-4 w-4 mr-1.5" /> Reject
              </Button>
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                data-testid="button-approve-draft"
                className="w-full sm:w-auto order-1"
              >
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {approveMutation.isPending ? "Approving…" : "Approve"}
              </Button>
            </>
          )}

          {action && isPending && mode === "edit" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("view")} className="w-full sm:w-auto order-2">
                Cancel Edit
              </Button>
              <Button
                size="sm"
                onClick={() => editApproveMutation.mutate()}
                disabled={editApproveMutation.isPending || !editBody.trim()}
                data-testid="button-approve-with-edits"
                className="w-full sm:w-auto order-1"
              >
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {editApproveMutation.isPending ? "Saving…" : "Approve with Edits"}
              </Button>
            </>
          )}

          {action && isPending && mode === "reject" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("view")} className="w-full sm:w-auto order-2">
                Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                data-testid="button-confirm-reject"
                className="w-full sm:w-auto order-1"
              >
                <ShieldX className="h-4 w-4 mr-1.5" />
                {rejectMutation.isPending ? "Rejecting…" : "Confirm Rejection"}
              </Button>
            </>
          )}

          {(!action || !isPending) && (
            <Button variant="outline" size="sm" onClick={handleClose} className="w-full sm:w-auto" data-testid="button-close-draft-modal">
              Close
            </Button>
          )}

          {action && isPending && mode === "view" && (
            <Button variant="ghost" size="sm" onClick={handleClose} className="w-full sm:w-auto order-4 sm:mr-auto sm:order-0">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminGmailConversationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<GmailConversation | null>(null);
  const [draftActionId, setDraftActionId] = useState<string | null>(null);
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

  const quickApproveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/gmail/actions/${id}/approve`),
    onSuccess: () => {
      toast({ title: "Action approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const quickRejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/gmail/actions/${id}/reject`),
    onSuccess: () => {
      toast({ title: "Action rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/actions"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const unprocessed = conversations.filter((c) => c.status !== "processed" && c.status !== "suppressed");
  const pendingActions = actions.filter((a) => a.status === "proposed" || a.status === "awaiting_approval");

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
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
        <div className="flex items-center gap-2 flex-wrap">
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
      <SyncStatusRow syncStatus={syncStatusQuery.data} isSyncing={syncMutation.isPending} />

      {/* Draft-Only Safety Notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-sm" data-testid="banner-gmail-safety">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-purple-500" />
        <span>
          <strong>Draft-Only Agent Mode:</strong> Gmail agent tool sends are routed to Drafts only — no direct auto-send from agent workflows.
          Review and send drafts manually from your Gmail inbox.
          {" "}<a href="/admin/email-audit" className="underline font-medium">View Email Audit Log →</a>
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            Conversations {unprocessed.length > 0 && (
              <span className="ml-1 text-xs bg-amber-500 text-white rounded-full px-1.5">{unprocessed.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-actions">
            Action Queue {pendingActions.length > 0 && (
              <span className="ml-1 text-xs bg-purple-500 text-white rounded-full px-1.5">{pendingActions.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Conversations Tab ── */}
        <TabsContent value="conversations" className="space-y-3 mt-4">
          {conversationsQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)
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
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
          ) : actions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No actions in queue</p>
              <p className="text-sm">Actions appear here when the agent proposes drafts or follow-ups.</p>
            </div>
          ) : (
            actions.map((action) => {
              const isPending = action.status === "proposed" || action.status === "awaiting_approval";
              const displaySubject = action.subject ?? friendlyActionType(action.actionType);
              const displayPreview = action.result?.draftBody
                ? action.result.draftBody.slice(0, 120)
                : action.bodyPreview
                  ? action.bodyPreview.slice(0, 120)
                  : null;

              return (
                <Card key={action.id} data-testid={`card-action-${action.id}`}>
                  <CardContent className="py-4">
                    <div className="flex flex-col gap-3">
                      {/* Top row: labels + time */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_STATUS_COLORS[action.status] ?? "bg-gray-100 text-gray-600"}`}>
                              {action.status}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_COLORS[action.riskLevel] ?? "bg-gray-100"}`}>
                              {action.riskLevel} risk
                            </span>
                            {action.approvalRequired && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                needs approval
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{timeAgo(action.createdAt)}</span>
                      </div>

                      {/* Subject + preview */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {displaySubject}
                        </p>
                        {displayPreview && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 italic">
                            {displayPreview}{displayPreview.length >= 120 ? "…" : ""}
                          </p>
                        )}
                        {action.recipientEmail && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <User className="h-3 w-3" /> {action.recipientEmail}
                          </p>
                        )}
                        {action.createdByAgent && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Tag className="h-3 w-3" /> {action.createdByAgent.replace(/_/g, " ")}
                          </p>
                        )}
                        {action.errorMessage && action.status === "rejected" && (
                          <p className="text-xs text-rose-600 mt-1 flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> {action.errorMessage}
                          </p>
                        )}
                        {action.errorMessage && action.status === "failed" && (
                          <p className="text-xs text-red-600 mt-1">{action.errorMessage}</p>
                        )}
                      </div>

                      {/* Action buttons */}
                      {isPending && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs flex-1 sm:flex-none"
                            onClick={() => setDraftActionId(action.id)}
                            data-testid={`button-view-draft-${action.id}`}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1.5" /> View Draft
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 text-xs flex-1 sm:flex-none"
                            onClick={() => quickApproveMutation.mutate(action.id)}
                            disabled={quickApproveMutation.isPending}
                            data-testid={`button-approve-action-${action.id}`}
                          >
                            <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                            {quickApproveMutation.isPending ? "…" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs flex-1 sm:flex-none text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                            onClick={() => quickRejectMutation.mutate(action.id)}
                            disabled={quickRejectMutation.isPending}
                            data-testid={`button-reject-action-${action.id}`}
                          >
                            <ShieldX className="h-3.5 w-3.5 mr-1.5" />
                            {quickRejectMutation.isPending ? "…" : "Reject"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* ── Conversation Detail Dialog ── */}
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
                <Button variant="outline" size="sm" onClick={() => setSelectedConvo(null)} data-testid="button-close-convo-dialog">
                  Close
                </Button>
                {selectedConvo.status !== "processed" && (
                  <Button
                    size="sm"
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

      {/* ── Draft Review Modal ── */}
      <DraftReviewModal
        actionId={draftActionId}
        onClose={() => setDraftActionId(null)}
        onApproved={() => setDraftActionId(null)}
        onRejected={() => setDraftActionId(null)}
      />
    </div>
  );
}
