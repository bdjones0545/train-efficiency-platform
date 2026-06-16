import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Mail, CheckCircle, XCircle, RefreshCw, Send, Inbox,
  AlertTriangle, Wifi, WifiOff, Loader2, Zap, Settings,
  ArrowDownToLine, Eye, MailOpen, BarChart3,
  ThumbsUp, ThumbsDown, Edit3, Clock, CalendarClock,
  Ban, ListOrdered, ExternalLink, MessageSquare, Users,
  FileText, Activity, Link2, AlertCircle, CheckCheck,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentInboxDef { agent: string; inbox: string; description: string; }
interface StatusData {
  configured: boolean; connected: boolean; message: string;
  agentInboxes?: AgentInboxDef[];
  orgDomain?: string;
  inbound?: { byRoutedStatus: Record<string, number>; byClassification: Record<string, number>; urgentEscalations: number };
}
interface AgentMailMessage {
  id: string; agent_name: string; inbox: string; to_email: string;
  subject: string; status: "sent" | "failed" | "queued"; error_message: string | null; created_at: string;
}
interface InboundMessage {
  id: string; inbox: string; from_email: string; from_name: string | null;
  to_email: string; subject: string; body_text: string | null;
  classification: string | null; confidence: number | null;
  routed_agent: string | null; routed_status: string;
  action_payload: { suggestedReply?: string; intentSignals?: string[] } | null;
  received_at: string;
}
interface ReplyQueueItem {
  id: string; inbound_message_id: string; inbox: string; agent_name: string;
  classification: string; recipient_email: string; recipient_name: string | null;
  subject: string; draft_body: string; edited_body: string | null; final_body: string | null;
  status: string; approval_status: string; approved_by: string | null; approved_at: string | null;
  sent_at: string | null; delivery_status: string | null; rejection_reason: string | null;
  confidence: number | null; created_at: string;
  inbound_body?: string | null; inbound_from_name?: string | null;
  inbound_from_email?: string | null; inbound_subject?: string | null;
  inbound_received_at?: string | null;
  outcomes?: OutcomeRecord[];
}
interface FollowupItem {
  id: string; organization_id: string;
  source_inbound_message_id: string | null; source_reply_queue_id: string | null;
  inbox: string; agent_name: string; classification: string;
  recipient_email: string; recipient_name: string | null;
  subject: string; followup_body: string; edited_body: string | null;
  sequence_name: string; sequence_step: number;
  scheduled_for: string; status: string; approval_status: string;
  approved_by: string | null; approved_at: string | null; sent_at: string | null;
  skipped_reason: string | null; error_message: string | null;
  created_at: string;
  inbound_body?: string | null; inbound_subject?: string | null;
  inbound_from_email?: string | null; inbound_received_at?: string | null;
  first_reply_body?: string | null; first_reply_edited_body?: string | null;
  priorFollowups?: { id: string; sequence_step: number; status: string; sent_at: string | null; subject: string }[];
}
interface OutcomeRecord { id: string; outcome_type: string; response_time_minutes: number | null; actor: string | null; notes: string | null; created_at: string; }
interface GmailConversation {
  id: string; gmailThreadId: string; orgId: string; subject: string | null;
  fromEmail: string | null; fromName: string | null; snippet: string | null;
  status: string | null; lastMessageAt: string | null; updatedAt: string | null;
  messageCount: number | null; hasAttachments: boolean | null; labels: string[] | null;
}
interface GmailSyncStatus {
  lastGmailSyncStatus: string | null; lastGmailSyncAt: string | null;
  lastGmailSyncError: string | null; gmailSyncJobId: string | null;
  syncedConversations?: number;
}
interface AiApproval {
  id: string; orgId: string; actionType: string; communicationDomain: string | null;
  status: string; prospectName: string | null; prospectEmail: string | null;
  subject: string | null; bodyDraft: string | null; createdAt: string;
}
interface ApprovalsMetrics {
  pending: number; pendingLowRisk: number; oldestPendingHours: number | null;
  approvalRate7d: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INBOX_OPTIONS = ["revenue", "hiring", "scheduling", "support", "operations", "ceo"];

const CLS_COLORS: Record<string, string> = {
  new_lead: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  booking_request: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  reschedule_request: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  cancellation_request: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  pricing_question: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  employment_candidate: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  support_issue: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  billing_issue: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  athlete_parent_question: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  coach_partner_inquiry: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  software_bug_report: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  urgent_escalation: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
  general_question: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  spam_or_noise: "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
};

const STATUS_COLORS: Record<string, string> = {
  sent: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  pending_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  drafted: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  skipped: "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-400",
  failed: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
  routed: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  spam_stored: "bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500",
  received: "bg-gray-100 text-gray-600",
  proposed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  pending_approval: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  awaiting_approval: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Micro-components ────────────────────────────────────────────────────────

function ClsBadge({ cls }: { cls: string | null }) {
  if (!cls) return <Badge variant="outline" className="text-xs">—</Badge>;
  return <Badge className={`text-xs font-medium ${CLS_COLORS[cls] ?? "bg-gray-100 text-gray-700"}`}>{cls.replace(/_/g, " ")}</Badge>;
}

function StsBadge({ status }: { status: string }) {
  return <Badge className={`text-xs ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</Badge>;
}

function ConfBadge({ conf }: { conf: number | null }) {
  if (conf === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(conf * 100);
  return <span className={`text-xs font-medium ${pct >= 80 ? "text-green-600" : pct >= 60 ? "text-yellow-600" : "text-red-500"}`}>{pct}%</span>;
}

function IsOverdue({ scheduledFor, status }: { scheduledFor: string; status: string }) {
  if (status !== "scheduled" && status !== "pending_review") return null;
  const overdue = new Date(scheduledFor) < new Date();
  if (!overdue) return null;
  return <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ml-1">Overdue</Badge>;
}

function CountBadge({ n }: { n: number }) {
  if (n === 0) return null;
  return <Badge className="ml-1 text-xs h-4 min-w-[16px] px-1 bg-orange-500 text-white">{n > 99 ? "99+" : n}</Badge>;
}

function EmptyState({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">{body}</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3 text-xs text-red-700 dark:text-red-300">
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{error.message ?? "Failed to load"}</span>
    </div>
  );
}

// ─── Follow-Up Detail Dialog ─────────────────────────────────────────────────

function FollowupDetailDialog({
  followup, onClose, onApprove, onReject, onSend, onSaveEdit, onCancel, isPending, orgDomain,
}: {
  followup: FollowupItem | null; onClose: () => void;
  onApprove: (id: string) => void; onReject: (id: string, reason: string) => void;
  onSend: (id: string) => void; onSaveEdit: (id: string, body: string) => void;
  onCancel: (id: string, reason: string, all: boolean) => void; isPending: boolean;
  orgDomain: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  if (!followup) return null;

  const currentBody = followup.edited_body || followup.followup_body;
  const firstReplyBody = followup.first_reply_edited_body || followup.first_reply_body;
  const canApprove = followup.approval_status !== "approved" && !["sent", "cancelled", "skipped", "failed"].includes(followup.status);
  const canSend = followup.approval_status === "approved" && !["sent", "failed"].includes(followup.status);
  const canEdit = !["sent", "cancelled"].includes(followup.status);
  const isOverdue = new Date(followup.scheduled_for) < new Date() && followup.status === "scheduled";

  return (
    <Dialog open={!!followup} onOpenChange={() => { onClose(); setEditMode(false); setShowReject(false); setShowCancel(false); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" />
            Follow-Up: Step {followup.sequence_step} — {followup.sequence_name}
            {isOverdue && <Badge className="ml-1 text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Overdue</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ArrowDownToLine className="h-3 w-3" /> Original Inbound
            </p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div><span className="text-muted-foreground">From: </span><span className="font-medium">{followup.inbound_from_email ?? followup.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Subject: </span><span>{followup.inbound_subject ?? followup.subject}</span></div>
              {followup.inbound_received_at && <div><span className="text-muted-foreground">Received: </span>{new Date(followup.inbound_received_at).toLocaleString()}</div>}
              <div className="mt-2 whitespace-pre-wrap font-mono max-h-28 overflow-y-auto text-foreground/80">{followup.inbound_body ?? "(no body)"}</div>
            </div>
            {firstReplyBody && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Send className="h-3 w-3 text-green-500" /> First Reply Sent
                </p>
                <div className="bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 rounded-lg p-3 text-xs whitespace-pre-wrap font-mono max-h-28 overflow-y-auto">
                  {firstReplyBody}
                </div>
              </>
            )}
            {(followup.priorFollowups ?? []).length > 0 && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <ListOrdered className="h-3 w-3" /> Prior Follow-Ups
                </p>
                {(followup.priorFollowups ?? []).map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">Step {p.sequence_step}</span>
                    <StsBadge status={p.status} />
                    {p.sent_at && <span className="text-muted-foreground">{new Date(p.sent_at).toLocaleDateString()}</span>}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-blue-500" /> Follow-Up Draft
              </p>
              <div className="flex items-center gap-1.5">
                <ClsBadge cls={followup.classification} />
                <Badge variant="outline" className="text-xs font-mono">{followup.inbox}@{orgDomain}</Badge>
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div><span className="text-muted-foreground">To: </span><span className="font-medium">{followup.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Subject: </span>{followup.subject}</div>
              <div><span className="text-muted-foreground">Scheduled: </span>{new Date(followup.scheduled_for).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Agent: </span>{followup.agent_name}</div>
              <Separator />
              {editMode && canEdit ? (
                <div className="space-y-2 mt-2">
                  <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} className="font-mono text-xs" data-testid="input-edit-followup" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { onSaveEdit(followup.id, editBody); setEditMode(false); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto text-foreground/80">{currentBody}</div>
              )}
              {followup.edited_body && !editMode && (
                <Badge className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Edit3 className="h-2.5 w-2.5 mr-1" /> Edited
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-3 pt-3 border-t">
          <div className="flex flex-wrap gap-2 items-center">
            {canEdit && !editMode && (
              <Button size="sm" variant="outline" onClick={() => { setEditBody(currentBody); setEditMode(true); }}>
                <Edit3 className="h-3 w-3 mr-1" /> Edit
              </Button>
            )}
            {canApprove && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1" data-testid="button-approve-followup"
                disabled={isPending} onClick={() => onApprove(followup.id)}>
                <ThumbsUp className="h-3 w-3" /> Approve
              </Button>
            )}
            {canSend && (
              <Button size="sm" className="gap-1" data-testid="button-send-followup"
                disabled={isPending} onClick={() => onSend(followup.id)}>
                <Send className="h-3 w-3" /> Send Now
              </Button>
            )}
            {!showReject && !["sent","cancelled","skipped"].includes(followup.status) && (
              <Button size="sm" variant="destructive" className="gap-1" onClick={() => setShowReject(true)}>
                <ThumbsDown className="h-3 w-3" /> Skip
              </Button>
            )}
            {!showCancel && !["sent","cancelled"].includes(followup.status) && (
              <Button size="sm" variant="outline" className="gap-1 text-gray-600" onClick={() => setShowCancel(true)}>
                <Ban className="h-3 w-3" /> Cancel Sequence
              </Button>
            )}
            <div className="ml-auto"><StsBadge status={followup.status} /></div>
          </div>
          {showReject && (
            <div className="flex gap-2 items-center">
              <Input className="h-8 text-xs flex-1" placeholder="Skip reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <Button size="sm" variant="destructive" onClick={() => { onReject(followup.id, rejectReason); setShowReject(false); }}>Confirm Skip</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
            </div>
          )}
          {showCancel && (
            <div className="flex gap-2 items-center">
              <Input className="h-8 text-xs flex-1" placeholder="Cancel reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <Button size="sm" variant="outline" className="text-gray-700" onClick={() => { onCancel(followup.id, cancelReason, false); setShowCancel(false); }}>Cancel This Step</Button>
              <Button size="sm" variant="destructive" onClick={() => { onCancel(followup.id, cancelReason, true); setShowCancel(false); }}>Cancel All Remaining</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>Back</Button>
            </div>
          )}
          {followup.skipped_reason && (
            <p className="text-xs text-muted-foreground italic">Reason: {followup.skipped_reason}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reply Detail Dialog ──────────────────────────────────────────────────────

function ReplyDetailDialog({
  reply, onClose, onApprove, onReject, onSend, onSaveEdit, isPending,
}: {
  reply: ReplyQueueItem | null; onClose: () => void;
  onApprove: (id: string) => void; onReject: (id: string, reason: string) => void;
  onSend: (id: string) => void; onSaveEdit: (id: string, body: string) => void;
  isPending: boolean;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  if (!reply) return null;
  const currentDraft = reply.edited_body || reply.draft_body;
  const canApprove = reply.approval_status === "pending_review" || reply.approval_status === "drafted";
  const canSend = reply.approval_status === "approved" && reply.status !== "sent" && reply.status !== "failed";
  const canReject = reply.status !== "sent" && reply.approval_status !== "rejected";
  const canEdit = reply.status !== "sent";

  return (
    <Dialog open={!!reply} onOpenChange={() => { onClose(); setEditMode(false); setShowReject(false); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Reply Queue — {reply.subject}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" /> Original Inbound</p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div><span className="text-muted-foreground">From: </span><span className="font-medium">{reply.inbound_from_name ?? reply.inbound_from_email ?? reply.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Subject: </span>{reply.inbound_subject ?? reply.subject}</div>
              {reply.inbound_received_at && <div><span className="text-muted-foreground">Received: </span>{new Date(reply.inbound_received_at).toLocaleString()}</div>}
              <Separator />
              <div className="whitespace-pre-wrap font-mono max-h-48 overflow-y-auto text-foreground/80">{reply.inbound_body ?? "(no body)"}</div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3 text-blue-500" /> Agent Draft Reply</p>
              <div className="flex gap-1"><ClsBadge cls={reply.classification} /><ConfBadge conf={reply.confidence} /></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div><span className="text-muted-foreground">To: </span><span className="font-medium">{reply.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Agent: </span>{reply.agent_name}</div>
              <Separator />
              {editMode && canEdit ? (
                <div className="space-y-2 mt-2">
                  <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} className="font-mono text-xs" data-testid="input-edit-body" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { onSaveEdit(reply.id, editBody); setEditMode(false); }}>Save Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto text-foreground/80">{currentDraft}</div>
              )}
              {reply.edited_body && !editMode && <Badge className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"><Edit3 className="h-2.5 w-2.5 mr-1" />Edited</Badge>}
            </div>
          </div>
        </div>
        <div className="space-y-3 pt-2 border-t">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Audit Trail</p>
          {(reply.outcomes ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No outcomes recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {(reply.outcomes ?? []).map((o) => (
                <div key={o.id} className="text-xs bg-muted/30 rounded px-3 py-1.5 flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">{o.outcome_type}</Badge>
                  {o.actor && <span className="text-muted-foreground">by {o.actor}</span>}
                  {o.response_time_minutes !== null && <span className="text-muted-foreground">{o.response_time_minutes}m response</span>}
                  {o.notes && <span className="text-muted-foreground italic">{o.notes}</span>}
                  <span className="ml-auto text-muted-foreground">{new Date(o.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pt-2 border-t flex flex-wrap gap-2 items-center">
          {canEdit && !editMode && (
            <Button size="sm" variant="outline" onClick={() => { setEditBody(currentDraft); setEditMode(true); }}>
              <Edit3 className="h-3 w-3 mr-1" /> Edit Draft
            </Button>
          )}
          {canApprove && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1" data-testid="button-approve-reply"
              disabled={isPending} onClick={() => onApprove(reply.id)}>
              <ThumbsUp className="h-3 w-3" /> Approve
            </Button>
          )}
          {canSend && (
            <Button size="sm" className="gap-1" data-testid="button-send-reply"
              disabled={isPending} onClick={() => onSend(reply.id)}>
              <Send className="h-3 w-3" /> Send Now
            </Button>
          )}
          {canReject && !showReject && (
            <Button size="sm" variant="destructive" className="gap-1" onClick={() => setShowReject(true)}>
              <ThumbsDown className="h-3 w-3" /> Reject
            </Button>
          )}
          <div className="ml-auto"><StsBadge status={reply.status} /></div>
        </div>
        {showReject && (
          <div className="flex gap-2 items-center pt-2">
            <Input className="h-8 text-xs flex-1" placeholder="Rejection reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <Button size="sm" variant="destructive" onClick={() => { onReject(reply.id, rejectReason); setShowReject(false); }}>Confirm Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentMailPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog state
  const [selectedReply, setSelectedReply] = useState<ReplyQueueItem | null>(null);
  const [selectedFollowup, setSelectedFollowup] = useState<FollowupItem | null>(null);
  const [selectedInbound, setSelectedInbound] = useState<InboundMessage | null>(null);

  // Verify inbox form
  const [verifyInbox, setVerifyInbox] = useState("revenue");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: statusData } = useQuery<StatusData>({ queryKey: ["/api/agentmail/status"], staleTime: 60_000 });
  const { data: gmailSync, isLoading: loadingSync, error: errorSync } = useQuery<GmailSyncStatus>({ queryKey: ["/api/org/gmail/sync-status"], staleTime: 30_000 });
  const { data: approvalsMetrics } = useQuery<ApprovalsMetrics>({ queryKey: ["/api/ai-approvals/metrics"], staleTime: 60_000 });

  // Tab 1 — Inbox / Conversations
  const { data: gmailConversationsRaw, isLoading: loadingConvos, error: errorConvos } = useQuery<GmailConversation[]>({ queryKey: ["/api/org/gmail/conversations"] });
  const { data: inboundRaw, isLoading: loadingInbound, error: errorInbound } = useQuery<InboundMessage[]>({ queryKey: ["/api/agentmail/inbound"] });

  // Tab 3 — Drafts & Approvals
  const { data: repliesRaw, isLoading: loadingReplies, error: errorReplies } = useQuery<ReplyQueueItem[]>({ queryKey: ["/api/agentmail/replies"] });
  const { data: gmailApprovalsRaw, isLoading: loadingApprovals, error: errorApprovals } = useQuery<AiApproval[]>({ queryKey: ["/api/ai-approvals"] });

  // Tab 4 — Outreach Opportunities
  const { data: outreachData, isLoading: loadingOutreach, error: errorOutreach } = useQuery<Record<string, { count: number; prospects: any[] }>>({ queryKey: ["/api/ai-outreach/opportunities"] });

  // Tab 5 — Follow-Ups
  const { data: followupsRaw, isLoading: loadingFollowups, error: errorFollowups } = useQuery<FollowupItem[]>({ queryKey: ["/api/agentmail/followups"] });

  // Tab 6 — Sync & Integrations
  const { data: inboxesData } = useQuery<{ configured: boolean; inboxes: any[] }>({ queryKey: ["/api/agentmail/inboxes"] });

  // Tab 7 — Activity Log
  const { data: messagesRaw } = useQuery<AgentMailMessage[]>({ queryKey: ["/api/agentmail/messages"] });

  // Derived data
  const gmailConversations = gmailConversationsRaw ?? [];
  const inbound = inboundRaw ?? [];
  const replies = repliesRaw ?? [];
  const gmailApprovals = gmailApprovalsRaw ?? [];
  const followups = followupsRaw ?? [];
  const messages = messagesRaw ?? [];

  const orgDomain = statusData?.orgDomain ?? "trainefficiency.com";
  const needsResponseInbound = inbound.filter(m => ["received", "pending", "routed"].includes(m.routed_status) && !m.action_payload?.suggestedReply);
  const pendingReplies = replies.filter(r => r.approval_status === "pending_review" || r.approval_status === "drafted");
  const pendingGmailApprovals = gmailApprovals.filter(a => ["proposed", "pending_approval", "awaiting_approval"].includes(a.status));
  const pendingFollowups = followups.filter(f => f.approval_status === "pending_review" && !["sent", "cancelled", "skipped"].includes(f.status));
  const totalDraftsPending = pendingReplies.length + pendingGmailApprovals.length;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/gmail/sync-replies"),
    onSuccess: () => {
      toast({ title: "Sync started", description: "Gmail sync is running in the background." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/gmail/conversations"] });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message ?? "Could not start Gmail sync", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/approve`),
    onSuccess: () => { toast({ title: "Reply approved" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] }); setSelectedReply(null); },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/agentmail/replies/${id}/reject`, { reason }),
    onSuccess: () => { toast({ title: "Reply rejected" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] }); setSelectedReply(null); },
    onError: (e: any) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const sendReplyMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/send`),
    onSuccess: () => { toast({ title: "Reply sent" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] }); setSelectedReply(null); },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const editReplyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiRequest("PATCH", `/api/agentmail/replies/${id}/edit`, { body }),
    onSuccess: () => { toast({ title: "Draft saved" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const approveFollowupMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/approve`),
    onSuccess: () => { toast({ title: "Follow-up approved" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); setSelectedFollowup(null); },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectFollowupMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/agentmail/followups/${id}/reject`, { reason }),
    onSuccess: () => { toast({ title: "Follow-up skipped" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); setSelectedFollowup(null); },
    onError: (e: any) => toast({ title: "Skip failed", description: e.message, variant: "destructive" }),
  });

  const sendFollowupMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/send`),
    onSuccess: () => { toast({ title: "Follow-up sent" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); setSelectedFollowup(null); },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const editFollowupMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiRequest("PATCH", `/api/agentmail/followups/${id}/edit`, { body }),
    onSuccess: () => { toast({ title: "Draft saved" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const cancelFollowupMutation = useMutation({
    mutationFn: ({ id, reason, cancelAll }: { id: string; reason: string; cancelAll: boolean }) =>
      apiRequest("POST", `/api/agentmail/followups/${id}/cancel`, { reason, cancelAll }),
    onSuccess: () => { toast({ title: "Follow-up cancelled" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); setSelectedFollowup(null); },
    onError: (e: any) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: (inbox: string) => apiRequest("POST", "/api/agentmail/inboxes/verify", { inbox }),
    onSuccess: (d: any) => { toast({ title: d.created ? "Inbox created" : "Inbox verified" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] }); },
    onError: (e: any) => toast({ title: "Verify failed", description: e.message, variant: "destructive" }),
  });

  const verifyAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agentmail/inboxes/verify-all"),
    onSuccess: (d: any) => {
      const ok = (d.results ?? []).filter((r: any) => r.ok).length;
      const fail = (d.results ?? []).length - ok;
      toast({ title: `Verified ${ok}/${(d.results ?? []).length} inboxes${fail ? ` (${fail} failed)` : ""}` });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] });
    },
    onError: (e: any) => toast({ title: "Verify all failed", description: e.message, variant: "destructive" }),
  });

  const processFollowupsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agentmail/followups/process-due"),
    onSuccess: (d: any) => { toast({ title: "Processed", description: `${d.processed ?? 0} due follow-ups moved to review` }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/followups"] }); },
    onError: (e: any) => toast({ title: "Process failed", description: e.message, variant: "destructive" }),
  });

  // ── Connection status bar ──────────────────────────────────────────────────

  const agentmailOk = statusData?.configured && statusData?.connected;
  const gmailSyncOk = gmailSync?.lastGmailSyncStatus !== "failed";
  const lastSync = gmailSync?.lastGmailSyncAt ? new Date(gmailSync.lastGmailSyncAt).toLocaleString() : null;
  const isSyncing = gmailSync?.lastGmailSyncStatus === "running";

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Messages Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Unified view of all AgentMail and Gmail communication</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || isSyncing} data-testid="button-sync-gmail">
          {(syncMutation.isPending || isSyncing) ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          {isSyncing ? "Syncing…" : "Sync Gmail"}
        </Button>
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
          {agentmailOk ? <Wifi className="h-4 w-4 text-green-500 shrink-0" /> : <WifiOff className="h-4 w-4 text-red-400 shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">AgentMail</p>
            <p className="text-xs font-medium truncate">{agentmailOk ? "Connected" : statusData?.configured ? "Disconnected" : "Not configured"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
          {gmailSync?.lastGmailSyncStatus === "failed" ? <AlertCircle className="h-4 w-4 text-red-400 shrink-0" /> : isSyncing ? <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" /> : <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Gmail Sync</p>
            <p className="text-xs font-medium truncate">{isSyncing ? "Syncing…" : lastSync ? `Last: ${lastSync}` : "Never synced"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
          <FileText className="h-4 w-4 text-orange-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Pending Approvals</p>
            <p className="text-xs font-medium">{totalDraftsPending} draft{totalDraftsPending !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
          <MailOpen className="h-4 w-4 text-blue-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Need Response</p>
            <p className="text-xs font-medium">{needsResponseInbound.length} message{needsResponseInbound.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {/* Gmail sync error */}
      {gmailSync?.lastGmailSyncError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Gmail sync error: </span>
            {gmailSync.lastGmailSyncError}
          </div>
        </div>
      )}

      {/* Main tabs */}
      <Tabs defaultValue="inbox">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="inbox" className="text-xs flex items-center" data-testid="tab-inbox">
            <Inbox className="h-3.5 w-3.5 mr-1.5" />
            Inbox
            <CountBadge n={gmailConversations.length + inbound.length} />
          </TabsTrigger>
          <TabsTrigger value="needs-response" className="text-xs flex items-center" data-testid="tab-needs-response">
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
            Needs Response
            <CountBadge n={needsResponseInbound.length} />
          </TabsTrigger>
          <TabsTrigger value="drafts" className="text-xs flex items-center" data-testid="tab-drafts">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Drafts & Approvals
            <CountBadge n={totalDraftsPending} />
          </TabsTrigger>
          <TabsTrigger value="outreach" className="text-xs flex items-center" data-testid="tab-outreach">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Outreach
          </TabsTrigger>
          <TabsTrigger value="follow-ups" className="text-xs flex items-center" data-testid="tab-follow-ups">
            <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
            Follow-Ups
            <CountBadge n={pendingFollowups.length} />
          </TabsTrigger>
          <TabsTrigger value="sync" className="text-xs flex items-center" data-testid="tab-sync">
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Sync & Integrations
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs flex items-center" data-testid="tab-activity">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Activity Log
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Inbox / Conversations ──────────────────────────────────── */}
        <TabsContent value="inbox" className="mt-4 space-y-4">
          {/* Gmail conversations */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" /> Gmail Conversations
                  {gmailConversations.length > 0 && <Badge variant="outline" className="text-xs ml-1">{gmailConversations.length}</Badge>}
                </CardTitle>
                <Link href="/admin/gmail-conversations">
                  <Button size="sm" variant="ghost" className="text-xs gap-1" data-testid="link-gmail-conversations">
                    Full view <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
              <CardDescription>Synced Gmail threads for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingConvos ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…</div>
              ) : errorConvos ? (
                <ErrorState error={errorConvos as Error} />
              ) : gmailConversations.length === 0 ? (
                <EmptyState icon={Mail} title="No Gmail conversations" body="Sync Gmail to pull in threads, or check that OAuth is connected in Sync & Integrations." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>From</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Message</TableHead>
                        <TableHead>Messages</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gmailConversations.slice(0, 50).map((c) => (
                        <TableRow key={c.id} data-testid={`row-convo-${c.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-sm max-w-[160px]">
                            <div className="truncate font-medium">{c.fromName ?? c.fromEmail ?? "Unknown"}</div>
                            <div className="truncate text-xs text-muted-foreground">{c.fromEmail}</div>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px]">
                            <div className="truncate">{c.subject ?? "(no subject)"}</div>
                            {c.snippet && <div className="truncate text-xs text-muted-foreground">{c.snippet}</div>}
                          </TableCell>
                          <TableCell>
                            {c.status ? <StsBadge status={c.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-center">{c.messageCount ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {gmailConversations.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">Showing 50 of {gmailConversations.length} — <Link href="/admin/gmail-conversations"><span className="underline cursor-pointer">view all</span></Link></p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AgentMail inbound */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4" /> AgentMail Inbound
                {inbound.length > 0 && <Badge variant="outline" className="text-xs ml-1">{inbound.length}</Badge>}
              </CardTitle>
              <CardDescription>Messages received via AgentMail inboxes</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingInbound ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading inbound…</div>
              ) : errorInbound ? (
                <ErrorState error={errorInbound as Error} />
              ) : inbound.length === 0 ? (
                <EmptyState icon={Inbox} title="No inbound messages" body="Messages arrive when contacts email your AgentMail inboxes. Configure AgentMail in Sync & Integrations to get started." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Received</TableHead>
                        <TableHead>Inbox</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inbound.slice(0, 50).map((m) => (
                        <TableRow key={m.id} data-testid={`row-inbound-${m.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.received_at).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-xs">{m.inbox}@{orgDomain}</Badge></TableCell>
                          <TableCell className="text-sm max-w-[140px]">
                            <div className="truncate font-medium">{m.from_name ?? m.from_email}</div>
                            <div className="truncate text-xs text-muted-foreground">{m.from_email}</div>
                          </TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">{m.subject}</TableCell>
                          <TableCell><ClsBadge cls={m.classification} /></TableCell>
                          <TableCell><StsBadge status={m.routed_status} /></TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedInbound(m)} data-testid={`button-view-${m.id}`}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Needs Response ──────────────────────────────────────────── */}
        <TabsContent value="needs-response" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-orange-500" /> Needs Response
                {needsResponseInbound.length > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs">{needsResponseInbound.length}</Badge>}
              </CardTitle>
              <CardDescription>Inbound messages that have not yet received a reply draft</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingInbound ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : errorInbound ? (
                <ErrorState error={errorInbound as Error} />
              ) : needsResponseInbound.length === 0 ? (
                <EmptyState icon={CheckCheck} title="All caught up" body="No inbound messages are waiting for a response. New messages will appear here when they arrive." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Received</TableHead>
                        <TableHead>Inbox</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {needsResponseInbound.map((m) => (
                        <TableRow key={m.id} data-testid={`row-needs-response-${m.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.received_at).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-xs">{m.inbox}@{orgDomain}</Badge></TableCell>
                          <TableCell className="text-sm max-w-[160px]">
                            <div className="truncate font-medium">{m.from_name ?? m.from_email}</div>
                            <div className="truncate text-xs text-muted-foreground">{m.from_email}</div>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px]">
                            <div className="truncate">{m.subject}</div>
                            {m.body_text && <div className="truncate text-xs text-muted-foreground">{m.body_text.slice(0, 80)}</div>}
                          </TableCell>
                          <TableCell><ClsBadge cls={m.classification} /></TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setSelectedInbound(m)} data-testid={`button-view-needs-${m.id}`}>
                              <Eye className="h-3 w-3" /> View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Gmail approvals that need action */}
          {pendingGmailApprovals.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-blue-500" /> Pending Gmail Outreach Approvals
                    <Badge className="ml-1 bg-blue-500 text-white text-xs">{pendingGmailApprovals.length}</Badge>
                  </CardTitle>
                  <Link href="/admin/gmail-draft-review">
                    <Button size="sm" variant="ghost" className="text-xs gap-1" data-testid="link-gmail-drafts">
                      Review all <ExternalLink className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
                <CardDescription>AI-drafted Gmail outreach proposals waiting for your approval</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingGmailApprovals.slice(0, 20).map((a) => (
                        <TableRow key={a.id} data-testid={`row-gmail-approval-${a.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{(a.communicationDomain ?? "unknown").replace(/_/g, " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{a.prospectEmail ?? a.prospectName ?? "—"}</TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate">{a.subject ?? "—"}</TableCell>
                          <TableCell><StsBadge status={a.status} /></TableCell>
                          <TableCell>
                            <Link href="/admin/gmail-draft-review">
                              <Button size="sm" variant="ghost" className="text-xs" data-testid={`button-review-approval-${a.id}`}>
                                <Eye className="h-3 w-3" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab 3: Drafts & Approvals ─────────────────────────────────────── */}
        <TabsContent value="drafts" className="mt-4 space-y-4">
          {/* AgentMail Reply Queue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" /> AgentMail Reply Queue
                {pendingReplies.length > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs">{pendingReplies.length} pending</Badge>}
              </CardTitle>
              <CardDescription>AI-drafted replies to inbound AgentMail messages</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingReplies ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading replies…</div>
              ) : errorReplies ? (
                <ErrorState error={errorReplies as Error} />
              ) : replies.length === 0 ? (
                <EmptyState icon={FileText} title="No reply drafts" body="When AgentMail processes an inbound message, it generates a reply draft here for your review." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Inbox</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {replies.map((r) => (
                        <TableRow key={r.id} data-testid={`row-reply-${r.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-xs">{r.inbox}@{orgDomain}</Badge></TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{r.recipient_email}</TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">{r.subject}</TableCell>
                          <TableCell><ClsBadge cls={r.classification} /></TableCell>
                          <TableCell><StsBadge status={r.approval_status} /></TableCell>
                          <TableCell><StsBadge status={r.status} /></TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedReply(r)} data-testid={`button-view-reply-${r.id}`}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gmail Outreach Approvals */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-blue-500" /> Gmail Outreach Proposals
                  {pendingGmailApprovals.length > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs">{pendingGmailApprovals.length} pending</Badge>}
                </CardTitle>
                <Link href="/admin/gmail-draft-review">
                  <Button size="sm" variant="ghost" className="text-xs gap-1" data-testid="link-draft-review-full">
                    Full review page <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
              <CardDescription>AI-generated outreach drafts pending your approval before sending</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingApprovals ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : errorApprovals ? (
                <ErrorState error={errorApprovals as Error} />
              ) : gmailApprovals.length === 0 ? (
                <EmptyState icon={CheckCheck} title="No pending outreach proposals" body="AI-generated outreach proposals from the Outreach Agent will appear here for your approval." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Prospect</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gmailApprovals.slice(0, 30).map((a) => (
                        <TableRow key={a.id} data-testid={`row-approval-${a.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{(a.communicationDomain ?? "unknown").replace(/_/g, " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[160px]">
                            <div className="truncate font-medium">{a.prospectName ?? "—"}</div>
                            <div className="truncate text-xs text-muted-foreground">{a.prospectEmail}</div>
                          </TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate">{a.subject ?? "—"}</TableCell>
                          <TableCell><StsBadge status={a.status} /></TableCell>
                          <TableCell>
                            <Link href="/admin/gmail-draft-review">
                              <Button size="sm" variant="ghost" className="text-xs" data-testid={`button-review-${a.id}`}>
                                Review
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Outreach Opportunities ─────────────────────────────────── */}
        <TabsContent value="outreach" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">AI-identified outreach targets by domain, drawn from your lead database.</p>
            <Link href="/admin/ai-outreach-opportunities">
              <Button size="sm" variant="outline" className="gap-1.5" data-testid="link-outreach-full">
                <ExternalLink className="h-3.5 w-3.5" /> Full Outreach Page
              </Button>
            </Link>
          </div>

          {loadingOutreach ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading opportunities…</div>
          ) : errorOutreach ? (
            <ErrorState error={errorOutreach as Error} />
          ) : !outreachData || Object.keys(outreachData).length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState icon={Users} title="No outreach opportunities" body="Add prospects to your lead database and run the Outreach Agent to generate AI-targeted opportunities." />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(outreachData).map(([domain, { count, prospects }]) => (
                <Card key={domain} className="hover:shadow-md transition-shadow" data-testid={`card-outreach-${domain}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span>{domain.replace(/_/g, " ")}</span>
                      <Badge className="text-xs">{count}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {prospects.slice(0, 3).map((p: any) => (
                      <div key={p.id} className="text-xs py-1 border-b last:border-0">
                        <div className="font-medium truncate">{p.organizationName ?? p.contactName ?? "Unknown"}</div>
                        <div className="text-muted-foreground truncate">{p.city ?? p.state ?? p.contactEmail ?? "—"}</div>
                      </div>
                    ))}
                    {count > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">+{count - 3} more</p>
                    )}
                    <Link href="/admin/ai-outreach-opportunities">
                      <Button size="sm" variant="outline" className="w-full text-xs mt-2" data-testid={`button-outreach-${domain}`}>
                        View & Generate
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 5: Follow-Ups ──────────────────────────────────────────────── */}
        <TabsContent value="follow-ups" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4" /> Follow-Up Queue
                  {pendingFollowups.length > 0 && <Badge className="ml-1 bg-orange-500 text-white text-xs">{pendingFollowups.length} pending</Badge>}
                </CardTitle>
                <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => processFollowupsMutation.mutate()} disabled={processFollowupsMutation.isPending} data-testid="button-process-followups">
                  {processFollowupsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Process Due
                </Button>
              </div>
              <CardDescription>Scheduled follow-up emails in the AgentMail sequence pipeline</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFollowups ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading follow-ups…</div>
              ) : errorFollowups ? (
                <ErrorState error={errorFollowups as Error} />
              ) : followups.length === 0 ? (
                <EmptyState icon={CalendarClock} title="No follow-ups scheduled" body="Follow-up steps are created automatically after replies are sent. Approve and send replies in Drafts & Approvals to trigger sequences." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scheduled</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Step</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {followups.map((f) => (
                        <TableRow key={f.id} data-testid={`row-followup-${f.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(f.scheduled_for).toLocaleString()}
                            <IsOverdue scheduledFor={f.scheduled_for} status={f.status} />
                          </TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{f.recipient_email}</TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">{f.subject}</TableCell>
                          <TableCell className="text-xs font-medium">{f.sequence_step}</TableCell>
                          <TableCell><ClsBadge cls={f.classification} /></TableCell>
                          <TableCell><StsBadge status={f.approval_status} /></TableCell>
                          <TableCell><StsBadge status={f.status} /></TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedFollowup(f)} data-testid={`button-view-followup-${f.id}`}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 6: Sync & Integrations ─────────────────────────────────────── */}
        <TabsContent value="sync" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gmail connection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" /> Gmail Connection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingSync ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking status…</div>
                ) : errorSync ? (
                  <ErrorState error={errorSync as Error} />
                ) : (
                  <>
                    {[
                      ["Sync Status", gmailSync?.lastGmailSyncStatus ?? "Never synced"],
                      ["Last Synced", gmailSync?.lastGmailSyncAt ? new Date(gmailSync.lastGmailSyncAt).toLocaleString() : "—"],
                      ["Conversations Synced", String(gmailSync?.syncedConversations ?? "—")],
                    ].map(([label, val]) => (
                      <div key={label} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{val}</span>
                      </div>
                    ))}
                    {gmailSync?.lastGmailSyncError && (
                      <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        <span className="font-medium">Last error: </span>{gmailSync.lastGmailSyncError}
                      </div>
                    )}
                    <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || isSyncing} className="w-full gap-2" data-testid="button-sync-now">
                      {(syncMutation.isPending || isSyncing) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {isSyncing ? "Syncing…" : "Sync Now"}
                    </Button>
                  </>
                )}
                <div className="pt-2">
                  <Link href="/admin/gmail-conversations">
                    <Button size="sm" variant="ghost" className="w-full text-xs gap-1" data-testid="link-sync-conversations">
                      <ExternalLink className="h-3 w-3" /> View Gmail Conversations
                    </Button>
                  </Link>
                </div>
                {/* Advanced: OAuth debug */}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground select-none">Advanced: OAuth & debug</summary>
                  <div className="mt-2 space-y-1.5 bg-muted/40 rounded-lg p-3">
                    <p>To connect Gmail OAuth, visit <strong>Settings → Integrations → Gmail OAuth</strong>.</p>
                    <p>OAuth debug endpoint: <code>/api/integrations/gmail/oauth/debug</code></p>
                    <p>OAuth start URL endpoint: <code>/api/integrations/gmail/oauth/start-url</code></p>
                  </div>
                </details>
              </CardContent>
            </Card>

            {/* AgentMail connection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Inbox className="h-4 w-4" /> AgentMail Connection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Configured", statusData?.configured ? "✓ API key present" : "✗ Not configured"],
                  ["Connected", statusData?.connected ? "✓ Live" : statusData?.configured ? "✗ Cannot reach API" : "—"],
                  ["Status", statusData?.message ?? "—"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-medium text-sm ${(val as string).startsWith("✓") ? "text-green-600" : (val as string).startsWith("✗") ? "text-red-500" : ""}`}>{val as string}</span>
                  </div>
                ))}

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent → Inbox Mapping</p>
                  {(statusData?.agentInboxes ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No inboxes configured.</p>
                  ) : (
                    (statusData?.agentInboxes ?? []).map((a) => (
                      <div key={a.inbox} className="flex items-center justify-between px-2 py-1.5 bg-muted/30 rounded text-xs">
                        <div>
                          <span className="font-medium">{a.agent}</span>
                          <span className="text-muted-foreground ml-2">{a.description}</span>
                        </div>
                        <Badge variant="outline" className="font-mono text-xs">{a.inbox}@{orgDomain}</Badge>
                      </div>
                    ))
                  )}
                </div>

                <Separator />

                {/* Inbox verify */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Verify / Create Inbox</p>
                  <div className="flex gap-2 items-center">
                    <Select value={verifyInbox} onValueChange={setVerifyInbox}>
                      <SelectTrigger className="flex-1 h-8 text-xs" data-testid="select-verify-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@{orgDomain}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => verifyMutation.mutate(verifyInbox)} disabled={verifyMutation.isPending || !statusData?.configured} data-testid="button-verify-inbox">
                      {verifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => verifyAllMutation.mutate()} disabled={verifyAllMutation.isPending || !statusData?.configured} data-testid="button-verify-all-inboxes">
                    {verifyAllMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCheck className="h-3 w-3 mr-1" />}
                    Verify All 6 Inboxes
                  </Button>
                </div>

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground select-none">Required secrets</summary>
                  <div className="mt-2 space-y-1.5 bg-muted/40 rounded-lg p-3">
                    {[
                      { key: "AGENTMAIL_API_KEY", req: true },
                      { key: "AGENTMAIL_ORG_DOMAIN", req: true },
                      { key: "AGENTMAIL_WEBHOOK_SECRET", req: false },
                      { key: "AGENTMAIL_BASE_URL", req: false },
                    ].map(({ key, req }) => (
                      <div key={key} className="flex items-center gap-2">
                        <code className="font-bold">{key}</code>
                        {req ? <Badge variant="destructive" className="text-xs">Required</Badge> : <Badge variant="outline" className="text-xs">Optional</Badge>}
                      </div>
                    ))}
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>

          {/* Configured inboxes */}
          {inboxesData?.configured && (inboxesData.inboxes ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Configured Inboxes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {inboxesData.inboxes.map((ib: any, i: number) => (
                    <Badge key={i} variant="outline" className="font-mono text-xs px-3 py-1">
                      {ib.address ?? ib.username ?? JSON.stringify(ib)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick links */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {[
                { label: "Gmail Conversations", href: "/admin/gmail-conversations" },
                { label: "Draft Review", href: "/admin/gmail-draft-review" },
                { label: "Outreach Opportunities", href: "/admin/ai-outreach-opportunities" },
                { label: "Email Audit", href: "/admin/email-audit" },
                { label: "Communication Intelligence", href: "/admin/communication-intelligence" },
              ].map(({ label, href }) => (
                <Link key={href} href={href}>
                  <Button size="sm" variant="outline" className="text-xs gap-1" data-testid={`link-quick-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <ExternalLink className="h-3 w-3" /> {label}
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 7: Activity Log ────────────────────────────────────────────── */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" /> Outbound Activity Log
                  {messages.length > 0 && <Badge variant="outline" className="text-xs ml-1">{messages.length}</Badge>}
                </CardTitle>
                <Link href="/admin/email-audit">
                  <Button size="sm" variant="ghost" className="text-xs gap-1" data-testid="link-email-audit">
                    Full audit <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
              <CardDescription>All outbound emails dispatched through AgentMail</CardDescription>
            </CardHeader>
            <CardContent>
              {messages.length === 0 ? (
                <EmptyState icon={Activity} title="No activity yet" body="Outbound emails sent through AgentMail inboxes will appear here. Use Drafts & Approvals to approve and send replies." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Inbox</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {messages.slice(0, 100).map((m) => (
                        <TableRow key={m.id} data-testid={`row-activity-${m.id}`} className="hover:bg-muted/40">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                          <TableCell className="text-sm">{m.agent_name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@{orgDomain}</Badge></TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{m.to_email}</TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate">{m.subject}</TableCell>
                          <TableCell>
                            <StsBadge status={m.status} />
                            {m.error_message && (
                              <p className="text-xs text-red-500 mt-0.5 max-w-[200px] truncate">{m.error_message}</p>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {messages.length > 100 && (
                    <p className="text-xs text-muted-foreground text-center py-2">Showing 100 of {messages.length} entries</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="h-4 w-4" /> Delivery Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Sent", val: messages.filter(m => m.status === "sent").length, color: "text-green-600" },
                  { label: "Failed", val: messages.filter(m => m.status === "failed").length, color: "text-red-500" },
                  { label: "Queued", val: messages.filter(m => m.status === "queued").length, color: "text-yellow-600" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="text-center">
                    <p className={`text-2xl font-bold ${color}`}>{val}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Inbound detail (simple inline view) */}
      {selectedInbound && (
        <Dialog open={!!selectedInbound} onOpenChange={() => setSelectedInbound(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <ArrowDownToLine className="h-4 w-4" /> {selectedInbound.subject}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">From: </span><span className="font-medium">{selectedInbound.from_name ?? selectedInbound.from_email}</span></div>
                <div><span className="text-muted-foreground">Email: </span>{selectedInbound.from_email}</div>
                <div><span className="text-muted-foreground">Inbox: </span><Badge variant="outline" className="font-mono text-xs">{selectedInbound.inbox}@{orgDomain}</Badge></div>
                <div><span className="text-muted-foreground">Received: </span>{new Date(selectedInbound.received_at).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Classification: </span><ClsBadge cls={selectedInbound.classification} /></div>
                <div><span className="text-muted-foreground">Confidence: </span><ConfBadge conf={selectedInbound.confidence} /></div>
                <div><span className="text-muted-foreground">Status: </span><StsBadge status={selectedInbound.routed_status} /></div>
                <div><span className="text-muted-foreground">Routed to: </span>{selectedInbound.routed_agent ?? "—"}</div>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Message Body</p>
                <div className="bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs max-h-64 overflow-y-auto text-foreground/80">
                  {selectedInbound.body_text ?? "(no body)"}
                </div>
              </div>
              {selectedInbound.action_payload?.intentSignals && selectedInbound.action_payload.intentSignals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Intent Signals</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedInbound.action_payload.intentSignals.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ReplyDetailDialog
        reply={selectedReply}
        onClose={() => setSelectedReply(null)}
        onApprove={(id) => approveMutation.mutate(id)}
        onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
        onSend={(id) => sendReplyMutation.mutate(id)}
        onSaveEdit={(id, body) => editReplyMutation.mutate({ id, body })}
        isPending={approveMutation.isPending || sendReplyMutation.isPending || rejectMutation.isPending}
      />

      <FollowupDetailDialog
        followup={selectedFollowup}
        onClose={() => setSelectedFollowup(null)}
        onApprove={(id) => approveFollowupMutation.mutate(id)}
        onReject={(id, reason) => rejectFollowupMutation.mutate({ id, reason })}
        onSend={(id) => sendFollowupMutation.mutate(id)}
        onSaveEdit={(id, body) => editFollowupMutation.mutate({ id, body })}
        onCancel={(id, reason, all) => cancelFollowupMutation.mutate({ id, reason, cancelAll: all })}
        isPending={approveFollowupMutation.isPending || sendFollowupMutation.isPending || rejectFollowupMutation.isPending || cancelFollowupMutation.isPending}
        orgDomain={orgDomain}
      />
    </div>
  );
}
