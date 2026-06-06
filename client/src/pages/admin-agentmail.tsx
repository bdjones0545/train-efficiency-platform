import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  ArrowDownToLine, Eye, FlaskConical, MailOpen, BarChart3,
  ThumbsUp, ThumbsDown, Edit3, Clock, TrendingUp, CalendarClock,
  Ban, ListOrdered
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentInboxDef { agent: string; inbox: string; description: string; }
interface StatusData {
  configured: boolean; connected: boolean; message: string;
  agentInboxes?: AgentInboxDef[];
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
  // joined
  inbound_body?: string | null; inbound_subject?: string | null;
  inbound_from_email?: string | null; inbound_received_at?: string | null;
  first_reply_body?: string | null; first_reply_edited_body?: string | null;
  priorFollowups?: { id: string; sequence_step: number; status: string; sent_at: string | null; subject: string }[];
}
interface OutcomeRecord { id: string; outcome_type: string; response_time_minutes: number | null; actor: string | null; notes: string | null; created_at: string; }
interface SimCase { index: number; label: string; inbox: string; }
interface AnalyticsData {
  summary: { total_replies: number; pending: number; approved_unsent: number; sent: number; rejected: number; failed: number; sent_today: number; avgApprovalTimeMinutes: number };
  agentMetrics: { agentName: string; draftsGenerated: number; approvals: number; edits: number; rejections: number; sends: number; deliveryFailures: number; avgResponseTimeMinutes: number; approvalRate: number | null; editRate: number | null }[];
  classificationMetrics: { classification: string; total: number; approvalPct: number | null; editPct: number | null; rejectionPct: number | null; sendPct: number | null }[];
}
interface FollowupAnalytics {
  summary: { total: number; scheduled: number; pending_review: number; sent: number; cancelled: number; overdue: number; sent_today: number; mostActiveInbox: string | null; mostPendingAgent: string | null; mostCommonClassification: string | null };
  agentMetrics: { agentName: string; scheduled: number; approved: number; sent: number; cancelled: number; overdue: number; sendRate: number | null }[];
  classificationMetrics: { classification: string; total: number; sent: number; cancelled: number; sendRate: number | null; cancellationRate: number | null; avgHoursToSend: number | null }[];
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

function PctCell({ val }: { val: number | null }) {
  if (val === null) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`text-xs font-semibold ${val >= 80 ? "text-green-600" : val >= 50 ? "text-yellow-600" : "text-red-500"}`}>{val}%</span>;
}

function IsOverdue({ scheduledFor, status }: { scheduledFor: string; status: string }) {
  if (status !== "scheduled" && status !== "pending_review") return null;
  const overdue = new Date(scheduledFor) < new Date();
  if (!overdue) return null;
  return <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ml-1">Overdue</Badge>;
}

// ─── Follow-Up Detail Dialog ─────────────────────────────────────────────────

function FollowupDetailDialog({
  followup, onClose, onApprove, onReject, onSend, onSaveEdit, onCancel, isPending,
}: {
  followup: FollowupItem | null; onClose: () => void;
  onApprove: (id: string) => void; onReject: (id: string, reason: string) => void;
  onSend: (id: string) => void; onSaveEdit: (id: string, body: string) => void;
  onCancel: (id: string, reason: string, all: boolean) => void; isPending: boolean;
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

        {/* Three panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* LEFT: Thread context */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ArrowDownToLine className="h-3 w-3" /> Original Inbound
            </p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div><span className="text-muted-foreground">From: </span><span className="font-medium">{followup.inbound_from_email ?? followup.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Subject: </span><span>{followup.inbound_subject ?? followup.subject}</span></div>
              {followup.inbound_received_at && <div><span className="text-muted-foreground">Received: </span>{new Date(followup.inbound_received_at).toLocaleString()}</div>}
              <div className="mt-2 whitespace-pre-wrap font-mono max-h-28 overflow-y-auto text-foreground/80">
                {followup.inbound_body ?? "(no body)"}
              </div>
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

          {/* RIGHT: Follow-up draft */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-blue-500" /> Follow-Up Draft
              </p>
              <div className="flex items-center gap-1.5">
                <ClsBadge cls={followup.classification} />
                <Badge variant="outline" className="text-xs font-mono">{followup.inbox}@</Badge>
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

        {/* Actions */}
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
            <div className="ml-auto">
              <StsBadge status={followup.status} />
            </div>
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

// ─── Reply detail dialog ──────────────────────────────────────────────────────

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
          {(reply.outcomes ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">No events yet.</p>
            : (reply.outcomes ?? []).map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleString()}</span>
                  <StsBadge status={o.outcome_type} />
                  {o.actor && <span className="text-muted-foreground">by {o.actor}</span>}
                  {o.response_time_minutes != null && <span className="text-muted-foreground">({o.response_time_minutes}m)</span>}
                  {o.notes && <span className="text-muted-foreground italic truncate max-w-xs">{o.notes}</span>}
                </div>
              ))
          }
          <Separator />
          <div className="flex flex-wrap gap-2 items-center">
            {canEdit && !editMode && <Button size="sm" variant="outline" onClick={() => { setEditBody(currentDraft); setEditMode(true); }}><Edit3 className="h-3 w-3 mr-1" />Edit Draft</Button>}
            {canApprove && <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1" data-testid="button-approve" disabled={isPending} onClick={() => onApprove(reply.id)}><ThumbsUp className="h-3 w-3" />Approve</Button>}
            {canSend && <Button size="sm" className="gap-1" data-testid="button-send" disabled={isPending} onClick={() => onSend(reply.id)}><Send className="h-3 w-3" />Send Now</Button>}
            {canReject && !showReject && <Button size="sm" variant="destructive" className="gap-1" onClick={() => setShowReject(true)}><ThumbsDown className="h-3 w-3" />Reject</Button>}
            {showReject && (
              <div className="flex gap-2 items-center w-full">
                <Input className="h-8 text-xs flex-1" placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <Button size="sm" variant="destructive" onClick={() => { onReject(reply.id, rejectReason); setShowReject(false); }}>Confirm</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
              </div>
            )}
            <div className="ml-auto"><StsBadge status={reply.status} /></div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inbound detail dialog ────────────────────────────────────────────────────

function InboundDetailDialog({ message, onClose, onReply }: { message: InboundMessage | null; onClose: () => void; onReply: (m: InboundMessage) => void }) {
  if (!message) return null;
  return (
    <Dialog open={!!message} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><MailOpen className="h-4 w-4" />{message.subject}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3 text-xs">
            <div><span className="text-muted-foreground">From: </span><span className="font-medium">{message.from_name ?? ""} &lt;{message.from_email}&gt;</span></div>
            <div><span className="text-muted-foreground">Inbox: </span><Badge variant="outline" className="font-mono text-xs">{message.inbox}@</Badge></div>
            <div><span className="text-muted-foreground">Classification: </span><ClsBadge cls={message.classification} /></div>
            <div><span className="text-muted-foreground">Status: </span><StsBadge status={message.routed_status} /></div>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">{message.body_text ?? "(no body)"}</div>
          {message.action_payload?.suggestedReply && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1"><Zap className="h-3 w-3" />AI Draft</p>
              <p className="text-sm text-blue-900 dark:text-blue-200 whitespace-pre-wrap">{message.action_payload.suggestedReply}</p>
            </div>
          )}
          {message.routed_status !== "spam_stored" && <Button size="sm" onClick={() => onReply(message)} className="gap-1"><Send className="h-3 w-3" />Compose Reply</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminAgentMailPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [testTo, setTestTo] = useState("");
  const [sendForm, setSendForm] = useState({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" });
  const [verifyInbox, setVerifyInbox] = useState("revenue");
  const [selectedInbound, setSelectedInbound] = useState<InboundMessage | null>(null);
  const [selectedReply, setSelectedReply] = useState<ReplyQueueItem | null>(null);
  const [selectedFollowup, setSelectedFollowup] = useState<FollowupItem | null>(null);
  const [inboundFilter, setInboundFilter] = useState({ inbox: "", classification: "", routed_status: "" });
  const [replyFilter, setReplyFilter] = useState({ inbox: "", status: "", approval_status: "" });
  const [followupFilter, setFollowupFilter] = useState({ inbox: "", status: "", classification: "", overdue: false, dueToday: false });
  const [replyDraft, setReplyDraft] = useState<{ to: string; subject: string; body: string; fromInbox: string } | null>(null);
  const [activeTab, setActiveTab] = useState("followups");

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({ queryKey: ["/api/agentmail/status"] });
  const { data: inboxesData } = useQuery<{ configured: boolean; inboxes: any[]; agentInboxes: AgentInboxDef[] }>({ queryKey: ["/api/agentmail/inboxes"] });
  const { data: messagesData } = useQuery<{ messages: AgentMailMessage[]; byStatus: Record<string, number> }>({ queryKey: ["/api/agentmail/messages"] });
  const { data: inboundData, refetch: refetchInbound } = useQuery<{ messages: InboundMessage[]; byClassification: Record<string, number>; byStatus: Record<string, number>; total: number }>({ queryKey: ["/api/agentmail/inbound"] });
  const { data: repliesData, refetch: refetchReplies } = useQuery<{ replies: ReplyQueueItem[]; byApprovalStatus: Record<string, number>; total: number }>({ queryKey: ["/api/agentmail/replies"] });
  const { data: followupsData, refetch: refetchFollowups } = useQuery<{ followups: FollowupItem[]; byStatus: Record<string, number>; pendingReview: number; overdueCount: number; dueTodayCount: number; total: number }>({ queryKey: ["/api/agentmail/followups"] });
  const { data: analytics, refetch: refetchAnalytics } = useQuery<AnalyticsData>({ queryKey: ["/api/agentmail/analytics"] });
  const { data: followupAnalytics, refetch: refetchFuAnalytics } = useQuery<FollowupAnalytics>({ queryKey: ["/api/agentmail/followup-analytics"] });
  const { data: simCases } = useQuery<SimCase[]>({ queryKey: ["/api/agentmail/simulate-inbound/cases"] });

  const { data: replyDetail } = useQuery<ReplyQueueItem>({
    queryKey: ["/api/agentmail/replies", selectedReply?.id],
    enabled: !!selectedReply?.id,
  });
  const { data: followupDetail } = useQuery<FollowupItem>({
    queryKey: ["/api/agentmail/followups", selectedFollowup?.id],
    enabled: !!selectedFollowup?.id,
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const refreshAll = () => {
    refetchStatus(); refetchInbound(); refetchReplies(); refetchFollowups(); refetchAnalytics(); refetchFuAnalytics();
  };
  const invalidateReplies = () => {
    qc.invalidateQueries({ queryKey: ["/api/agentmail/replies"] });
    qc.invalidateQueries({ queryKey: ["/api/agentmail/analytics"] });
    if (selectedReply) qc.invalidateQueries({ queryKey: ["/api/agentmail/replies", selectedReply.id] });
  };
  const invalidateFollowups = () => {
    qc.invalidateQueries({ queryKey: ["/api/agentmail/followups"] });
    qc.invalidateQueries({ queryKey: ["/api/agentmail/followup-analytics"] });
    if (selectedFollowup) qc.invalidateQueries({ queryKey: ["/api/agentmail/followups", selectedFollowup.id] });
  };

  const testMutation = useMutation({ mutationFn: (to: string) => apiRequest("POST", "/api/agentmail/test", { to }), onSuccess: () => { toast({ title: "Test sent" }); qc.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); }, onError: (e: any) => toast({ title: "Test failed", description: e?.message, variant: "destructive" }) });
  const sendMutation = useMutation({ mutationFn: (d: typeof sendForm) => apiRequest("POST", "/api/agentmail/send", d), onSuccess: () => { toast({ title: "Sent" }); qc.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); setSendForm({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" }); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const verifyMutation = useMutation({ mutationFn: (inbox: string) => apiRequest("POST", "/api/agentmail/inboxes/verify", { inbox }), onSuccess: (d: any) => { toast({ title: d?.created ? "Created" : "Verified" }); qc.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] }); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const simulateMutation = useMutation({
    mutationFn: (testCaseIndex: number) => apiRequest("POST", "/api/agentmail/simulate-inbound", { testCaseIndex }),
    onSuccess: (d: any) => { toast({ title: "Simulated", description: `Classified: ${d?.classification ?? "unknown"}` }); qc.invalidateQueries({ queryKey: ["/api/agentmail/inbound"] }); qc.invalidateQueries({ queryKey: ["/api/agentmail/replies"] }); refetchInbound(); refetchReplies(); },
    onError: (e: any) => toast({ title: "Simulation failed", description: e?.message, variant: "destructive" }),
  });
  const approveMutation = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/approve`, {}), onSuccess: () => { toast({ title: "Approved" }); invalidateReplies(); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const rejectMutation = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/agentmail/replies/${id}/reject`, { reason }), onSuccess: () => { toast({ title: "Rejected" }); invalidateReplies(); setSelectedReply(null); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const sendReplyMutation = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/send`, {}), onSuccess: () => { toast({ title: "Reply sent" }); invalidateReplies(); invalidateFollowups(); setSelectedReply(null); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const editReplyMutation = useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => apiRequest("PATCH", `/api/agentmail/replies/${id}`, { edited_body: body }), onSuccess: () => { toast({ title: "Draft updated" }); invalidateReplies(); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const approveFollowupMutation = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/approve`, {}), onSuccess: () => { toast({ title: "Follow-up approved" }); invalidateFollowups(); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const rejectFollowupMutation = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/agentmail/followups/${id}/reject`, { reason }), onSuccess: () => { toast({ title: "Follow-up skipped" }); invalidateFollowups(); setSelectedFollowup(null); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const sendFollowupMutation = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/send`, {}), onSuccess: () => { toast({ title: "Follow-up sent" }); invalidateFollowups(); setSelectedFollowup(null); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const editFollowupMutation = useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => apiRequest("PATCH", `/api/agentmail/followups/${id}`, { edited_body: body }), onSuccess: () => { toast({ title: "Draft updated" }); invalidateFollowups(); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const cancelFollowupMutation = useMutation({ mutationFn: ({ id, reason, cancelAll }: { id: string; reason: string; cancelAll: boolean }) => apiRequest("POST", `/api/agentmail/followups/${id}/cancel`, { reason, cancelAll }), onSuccess: (d: any) => { toast({ title: `Cancelled ${d?.cancelled ?? 1} step(s)` }); invalidateFollowups(); setSelectedFollowup(null); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const processDueMutation = useMutation({ mutationFn: () => apiRequest("POST", "/api/agentmail/followups/process-due", {}), onSuccess: (d: any) => { toast({ title: `Processed ${d?.processed ?? 0} due follow-ups` }); invalidateFollowups(); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });
  const replyMutation = useMutation({ mutationFn: (data: any) => apiRequest("POST", "/api/agentmail/reply", { ...data, agentName: "Manual Reply" }), onSuccess: () => { toast({ title: "Sent" }); setReplyDraft(null); qc.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); }, onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }) });

  // ─── Derived ─────────────────────────────────────────────────────────────

  const messages = messagesData?.messages ?? [];
  const sentCount = messagesData?.byStatus?.sent ?? 0;
  const failedCount = messagesData?.byStatus?.failed ?? 0;
  const agentInboxes = statusData?.agentInboxes ?? inboxesData?.agentInboxes ?? [];
  const totalInbound = inboundData?.total ?? 0;
  const pendingReplies = repliesData?.byApprovalStatus?.pending_review ?? 0;
  const sentReplies = analytics?.summary?.sent ?? 0;
  const pendingFollowups = followupsData?.pendingReview ?? 0;
  const overdueFollowups = followupsData?.overdueCount ?? 0;

  const filteredInbound = (inboundData?.messages ?? []).filter((m) =>
    (!inboundFilter.inbox || m.inbox === inboundFilter.inbox) &&
    (!inboundFilter.classification || m.classification === inboundFilter.classification) &&
    (!inboundFilter.routed_status || m.routed_status === inboundFilter.routed_status));

  const filteredReplies = (repliesData?.replies ?? []).filter((r) =>
    (!replyFilter.inbox || r.inbox === replyFilter.inbox) &&
    (!replyFilter.status || r.status === replyFilter.status) &&
    (!replyFilter.approval_status || r.approval_status === replyFilter.approval_status));

  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const filteredFollowups = (followupsData?.followups ?? []).filter((f) => {
    if (followupFilter.inbox && f.inbox !== followupFilter.inbox) return false;
    if (followupFilter.status && f.status !== followupFilter.status) return false;
    if (followupFilter.classification && f.classification !== followupFilter.classification) return false;
    if (followupFilter.overdue && !(new Date(f.scheduled_for) < now && f.status === "scheduled")) return false;
    if (followupFilter.dueToday && !(new Date(f.scheduled_for) <= todayEnd)) return false;
    return true;
  });

  const replyForDialog = selectedReply ? (replyDetail ?? selectedReply) : null;
  const followupForDialog = selectedFollowup ? (followupDetail ?? selectedFollowup) : null;

  function handleOpenReply(msg: InboundMessage) {
    setSelectedInbound(null);
    setReplyDraft({ to: msg.from_email, subject: `Re: ${msg.subject}`, body: msg.action_payload?.suggestedReply ?? "", fromInbox: msg.inbox });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Mail className="h-6 w-6 text-primary" />AgentMail</h1>
            <p className="text-muted-foreground text-sm mt-1">Inbound routing · Reply approval · Follow-up sequencing — all human-supervised</p>
          </div>
          <div className="flex items-center gap-3">
            {statusLoading ? <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Checking…</Badge>
              : statusData?.connected ? <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"><Wifi className="h-3 w-3" />Connected</Badge>
                : statusData?.configured ? <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" />Disconnected</Badge>
                  : <Badge variant="outline" className="gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />Not Configured</Badge>}
            <Button variant="outline" size="sm" data-testid="button-refresh" onClick={refreshAll}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          </div>
        </div>

        {!statusLoading && !statusData?.configured && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <CardContent className="pt-4 pb-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div><p className="font-semibold text-amber-800 dark:text-amber-300">AgentMail Not Configured</p><p className="text-sm text-amber-700 dark:text-amber-400">{statusData?.message}</p></div>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
          {[
            { label: "Outbound Sent", value: sentCount, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
            { label: "Inbound", value: totalInbound, icon: <ArrowDownToLine className="h-4 w-4 text-blue-500" /> },
            { label: "Reply Queue", value: pendingReplies, icon: <Clock className="h-4 w-4 text-yellow-500" /> },
            { label: "Replies Sent", value: sentReplies, icon: <Send className="h-4 w-4 text-purple-500" /> },
            { label: "Follow-Ups Due", value: pendingFollowups, icon: <CalendarClock className="h-4 w-4 text-orange-500" /> },
            { label: "Overdue", value: overdueFollowups, icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
            { label: "Errors", value: failedCount, icon: <XCircle className="h-4 w-4 text-red-400" /> },
          ].map((s) => (
            <Card key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between">
                <div><p className="text-xs text-muted-foreground leading-none">{s.label}</p><p className="text-xl font-bold mt-1">{s.value}</p></div>
                {s.icon}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="followups" data-testid="tab-followups">
              Follow-Up Queue {(pendingFollowups + overdueFollowups) > 0 && <Badge className="ml-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">{pendingFollowups + overdueFollowups}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="replies" data-testid="tab-replies">
              Reply Queue {pendingReplies > 0 && <Badge className="ml-1 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">{pendingReplies}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics">Analytics</TabsTrigger>
            <TabsTrigger value="inbound" data-testid="tab-inbound">
              Inbound {totalInbound > 0 && <Badge className="ml-1 text-xs bg-primary/20 text-primary">{totalInbound}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="simulate" data-testid="tab-simulate">Simulate</TabsTrigger>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="inboxes" data-testid="tab-inboxes">Inboxes</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages">Outbound Log</TabsTrigger>
            <TabsTrigger value="send" data-testid="tab-send">Send</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          {/* ── Follow-Up Queue ────────────────────────────────────────────── */}
          <TabsContent value="followups" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />Follow-Up Queue</CardTitle>
                    <CardDescription>AI-drafted follow-up sequences — approve and send manually. Never sent automatically.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => processDueMutation.mutate()} disabled={processDueMutation.isPending} data-testid="button-process-due">
                      {processDueMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}Process Due
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => refetchFollowups()} data-testid="button-refresh-followups">
                      <RefreshCw className="h-3 w-3 mr-1" />Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-2 items-center">
                  <Select value={followupFilter.inbox || "all"} onValueChange={(v) => setFollowupFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-32" data-testid="filter-fu-inbox"><SelectValue placeholder="All inboxes" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All inboxes</SelectItem>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={followupFilter.status || "all"} onValueChange={(v) => setFollowupFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-fu-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All statuses</SelectItem>{["scheduled","pending_review","approved","sent","skipped","cancelled","failed"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant={followupFilter.overdue ? "default" : "outline"} size="sm" onClick={() => setFollowupFilter(f => ({ ...f, overdue: !f.overdue, dueToday: false }))}>
                    Overdue {overdueFollowups > 0 && <Badge className="ml-1 text-xs">{overdueFollowups}</Badge>}
                  </Button>
                  <Button variant={followupFilter.dueToday ? "default" : "outline"} size="sm" onClick={() => setFollowupFilter(f => ({ ...f, dueToday: !f.dueToday, overdue: false }))}>
                    Due Today {(followupsData?.dueTodayCount ?? 0) > 0 && <Badge className="ml-1 text-xs">{followupsData?.dueTodayCount}</Badge>}
                  </Button>
                  {(followupFilter.inbox || followupFilter.status || followupFilter.overdue || followupFilter.dueToday || followupFilter.classification) && (
                    <Button variant="ghost" size="sm" onClick={() => setFollowupFilter({ inbox: "", status: "", classification: "", overdue: false, dueToday: false })}>Clear</Button>
                  )}
                </div>

                {filteredFollowups.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No follow-ups yet.</p>
                    <p className="text-xs mt-1">Follow-ups are created automatically after a reply is sent. Run a simulation → approve a reply → send it to see the sequence appear here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scheduled</TableHead>
                          <TableHead>Inbox</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Sequence</TableHead>
                          <TableHead>Step</TableHead>
                          <TableHead>Classification</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredFollowups.map((f) => (
                          <TableRow key={f.id} data-testid={`row-followup-${f.id}`} className="hover:bg-muted/30">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(f.scheduled_for).toLocaleString()}
                              <IsOverdue scheduledFor={f.scheduled_for} status={f.status} />
                            </TableCell>
                            <TableCell><Badge variant="outline" className="font-mono text-xs">{f.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[130px]">
                              <div className="truncate font-medium">{f.recipient_name ?? f.recipient_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{f.recipient_email}</div>
                            </TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate">{f.sequence_name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">Step {f.sequence_step}</Badge></TableCell>
                            <TableCell><ClsBadge cls={f.classification} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{f.agent_name}</TableCell>
                            <TableCell><StsBadge status={f.status} /></TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => { setSelectedFollowup(f); qc.invalidateQueries({ queryKey: ["/api/agentmail/followups", f.id] }); }} data-testid={`button-view-followup-${f.id}`}><Eye className="h-3 w-3" /></Button>
                                {f.approval_status !== "approved" && !["sent","cancelled","skipped","failed"].includes(f.status) && (
                                  <Button size="sm" variant="ghost" className="text-green-600" data-testid={`button-approve-fu-${f.id}`}
                                    disabled={approveFollowupMutation.isPending}
                                    onClick={() => approveFollowupMutation.mutate(f.id)}><ThumbsUp className="h-3 w-3" /></Button>
                                )}
                                {f.approval_status === "approved" && !["sent","failed"].includes(f.status) && (
                                  <Button size="sm" variant="ghost" className="text-primary" data-testid={`button-send-fu-${f.id}`}
                                    disabled={sendFollowupMutation.isPending}
                                    onClick={() => sendFollowupMutation.mutate(f.id)}><Send className="h-3 w-3" /></Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Status breakdown */}
                {Object.keys(followupsData?.byStatus ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {Object.entries(followupsData!.byStatus).map(([s, cnt]) => (
                      <div key={s} className="flex items-center gap-1.5 bg-muted/40 rounded px-2 py-1">
                        <StsBadge status={s} /><span className="text-sm font-bold">{cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Reply Queue ────────────────────────────────────────────────── */}
          <TabsContent value="replies" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />Reply Queue</CardTitle>
                    <CardDescription>Agent-drafted first replies — approve then send. No email sends automatically.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchReplies()} data-testid="button-refresh-replies"><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Select value={replyFilter.inbox || "all"} onValueChange={(v) => setReplyFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-32" data-testid="filter-reply-inbox"><SelectValue placeholder="All inboxes" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All inboxes</SelectItem>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={replyFilter.approval_status || "all"} onValueChange={(v) => setReplyFilter(f => ({ ...f, approval_status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-40" data-testid="filter-approval"><SelectValue placeholder="All approvals" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All</SelectItem>{["pending_review","approved","rejected"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}</SelectContent>
                  </Select>
                  {Object.values(replyFilter).some(Boolean) && <Button variant="ghost" size="sm" onClick={() => setReplyFilter({ inbox: "", status: "", approval_status: "" })}>Clear</Button>}
                </div>

                {filteredReplies.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Mail className="h-8 w-8 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No replies yet. Simulate an inbound email to generate a draft.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Created</TableHead><TableHead>Inbox</TableHead><TableHead>Recipient</TableHead>
                          <TableHead>Classification</TableHead><TableHead>Agent</TableHead><TableHead>Conf.</TableHead>
                          <TableHead>Approval</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredReplies.map((r) => (
                          <TableRow key={r.id} data-testid={`row-reply-${r.id}`} className="hover:bg-muted/30">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                            <TableCell><Badge variant="outline" className="font-mono text-xs">{r.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[130px]">
                              <div className="truncate font-medium">{r.recipient_name ?? r.recipient_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{r.recipient_email}</div>
                            </TableCell>
                            <TableCell><ClsBadge cls={r.classification} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.agent_name}</TableCell>
                            <TableCell><ConfBadge conf={r.confidence} /></TableCell>
                            <TableCell><StsBadge status={r.approval_status} /></TableCell>
                            <TableCell><StsBadge status={r.status} /></TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => { setSelectedReply(r); qc.invalidateQueries({ queryKey: ["/api/agentmail/replies", r.id] }); }} data-testid={`button-view-reply-${r.id}`}><Eye className="h-3 w-3" /></Button>
                                {(r.approval_status === "pending_review") && (
                                  <Button size="sm" variant="ghost" className="text-green-600" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(r.id)} data-testid={`button-approve-${r.id}`}><ThumbsUp className="h-3 w-3" /></Button>
                                )}
                                {r.approval_status === "approved" && r.status !== "sent" && (
                                  <Button size="sm" variant="ghost" className="text-primary" disabled={sendReplyMutation.isPending} onClick={() => sendReplyMutation.mutate(r.id)} data-testid={`button-send-${r.id}`}><Send className="h-3 w-3" /></Button>
                                )}
                              </div>
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

          {/* ── Analytics ─────────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-4 space-y-4">
            {/* Reply analytics */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" />Reply Performance</CardTitle></CardHeader>
              <CardContent>
                {!analytics ? <p className="text-sm text-muted-foreground py-4">No data yet.</p> : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "Total Drafts", value: analytics.summary.total_replies },
                      { label: "Sent", value: analytics.summary.sent },
                      { label: "Pending", value: analytics.summary.pending },
                      { label: "Avg Approval Time", value: analytics.summary.avgApprovalTimeMinutes ? `${analytics.summary.avgApprovalTimeMinutes}m` : "—" },
                    ].map((s) => (
                      <div key={s.label} className="bg-muted/40 rounded-lg px-3 py-2">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-xl font-bold mt-0.5">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                {(analytics?.agentMetrics?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Agent</TableHead><TableHead>Drafts</TableHead><TableHead>Approvals</TableHead><TableHead>Edits</TableHead><TableHead>Sends</TableHead><TableHead>Approval %</TableHead><TableHead>Edit %</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics!.agentMetrics.map((a) => (
                          <TableRow key={a.agentName}>
                            <TableCell className="font-medium text-sm">{a.agentName}</TableCell>
                            <TableCell>{a.draftsGenerated}</TableCell><TableCell>{a.approvals}</TableCell><TableCell>{a.edits}</TableCell><TableCell>{a.sends}</TableCell>
                            <TableCell><PctCell val={a.approvalRate} /></TableCell><TableCell><PctCell val={a.editRate} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Follow-up analytics */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" />Follow-Up Performance</CardTitle></CardHeader>
              <CardContent>
                {!followupAnalytics ? <p className="text-sm text-muted-foreground py-4">No follow-up data yet.</p> : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: "Total Scheduled", value: followupAnalytics.summary.total },
                        { label: "Sent", value: followupAnalytics.summary.sent },
                        { label: "Pending Review", value: followupAnalytics.summary.pending_review },
                        { label: "Overdue", value: followupAnalytics.summary.overdue },
                        { label: "Sent Today", value: followupAnalytics.summary.sent_today },
                        { label: "Cancelled", value: followupAnalytics.summary.cancelled },
                        { label: "Most Active Inbox", value: followupAnalytics.summary.mostActiveInbox ?? "—" },
                        { label: "Top Classification", value: followupAnalytics.summary.mostCommonClassification?.replace(/_/g," ") ?? "—" },
                      ].map((s) => (
                        <div key={s.label} className="bg-muted/40 rounded-lg px-3 py-2">
                          <p className="text-xs text-muted-foreground">{s.label}</p>
                          <p className="text-lg font-bold mt-0.5">{s.value}</p>
                        </div>
                      ))}
                    </div>
                    {followupAnalytics.agentMetrics.length > 0 && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow><TableHead>Agent</TableHead><TableHead>Scheduled</TableHead><TableHead>Approved</TableHead><TableHead>Sent</TableHead><TableHead>Cancelled</TableHead><TableHead>Overdue</TableHead><TableHead>Send Rate</TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {followupAnalytics.agentMetrics.map((a) => (
                              <TableRow key={a.agentName}>
                                <TableCell className="font-medium text-sm">{a.agentName}</TableCell>
                                <TableCell>{a.scheduled}</TableCell><TableCell>{a.approved}</TableCell><TableCell>{a.sent}</TableCell><TableCell>{a.cancelled}</TableCell><TableCell>{a.overdue}</TableCell>
                                <TableCell><PctCell val={a.sendRate} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    {followupAnalytics.classificationMetrics.length > 0 && (
                      <div className="overflow-x-auto mt-4">
                        <Table>
                          <TableHeader>
                            <TableRow><TableHead>Classification</TableHead><TableHead>Total</TableHead><TableHead>Sent</TableHead><TableHead>Send Rate</TableHead><TableHead>Cancel Rate</TableHead><TableHead>Avg Time (h)</TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {followupAnalytics.classificationMetrics.map((c) => (
                              <TableRow key={c.classification}>
                                <TableCell><ClsBadge cls={c.classification} /></TableCell>
                                <TableCell>{c.total}</TableCell><TableCell>{c.sent}</TableCell>
                                <TableCell><PctCell val={c.sendRate} /></TableCell><TableCell><PctCell val={c.cancellationRate} /></TableCell>
                                <TableCell className="text-xs text-muted-foreground">{c.avgHoursToSend ? `${c.avgHoursToSend}h` : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {(analytics?.classificationMetrics?.length ?? 0) > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" />Per-Classification Reply Metrics</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Classification</TableHead><TableHead>Total</TableHead><TableHead>Approval %</TableHead><TableHead>Edit %</TableHead><TableHead>Rejection %</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics!.classificationMetrics.map((c) => (
                          <TableRow key={c.classification}>
                            <TableCell><ClsBadge cls={c.classification} /></TableCell>
                            <TableCell>{c.total}</TableCell><TableCell><PctCell val={c.approvalPct} /></TableCell><TableCell><PctCell val={c.editPct} /></TableCell><TableCell><PctCell val={c.rejectionPct} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Inbound ───────────────────────────────────────────────────── */}
          <TabsContent value="inbound" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div><CardTitle className="flex items-center gap-2"><ArrowDownToLine className="h-4 w-4" />Inbound Messages</CardTitle><CardDescription>Classified and routed to agents</CardDescription></div>
                  <Button variant="outline" size="sm" onClick={() => refetchInbound()}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Select value={inboundFilter.inbox || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-32" data-testid="filter-inbox"><SelectValue placeholder="All inboxes" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All</SelectItem>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={inboundFilter.routed_status || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, routed_status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All</SelectItem>{["received","routed","spam_stored","failed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  {(inboundFilter.inbox || inboundFilter.routed_status) && <Button variant="ghost" size="sm" onClick={() => setInboundFilter({ inbox: "", classification: "", routed_status: "" })}>Clear</Button>}
                </div>

                {filteredInbound.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ArrowDownToLine className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No inbound messages. Use the <strong>Simulate</strong> tab to test.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Received</TableHead><TableHead>Inbox</TableHead><TableHead>From</TableHead><TableHead>Subject</TableHead><TableHead>Classification</TableHead><TableHead>Status</TableHead><TableHead>Draft</TableHead><TableHead></TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInbound.map((m) => (
                          <TableRow key={m.id} data-testid={`row-inbound-${m.id}`} className="hover:bg-muted/40">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.received_at).toLocaleString()}</TableCell>
                            <TableCell><Badge variant="outline" className="font-mono text-xs">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[140px]">
                              <div className="truncate font-medium">{m.from_name ?? m.from_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{m.from_email}</div>
                            </TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">{m.subject}</TableCell>
                            <TableCell><ClsBadge cls={m.classification} /></TableCell>
                            <TableCell><StsBadge status={m.routed_status} /></TableCell>
                            <TableCell>
                              {m.action_payload?.suggestedReply
                                ? <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 gap-1"><Zap className="h-2.5 w-2.5" />In Queue</Badge>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => setSelectedInbound(m)} data-testid={`button-view-${m.id}`}><Eye className="h-3 w-3" /></Button>
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

          {/* ── Simulate ──────────────────────────────────────────────────── */}
          <TabsContent value="simulate" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />Simulate Inbound Email</CardTitle>
                <CardDescription>Full pipeline: classify → draft reply → add to Reply Queue. After you approve + send the reply, follow-up steps appear in Follow-Up Queue.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(simCases ?? []).map((tc) => (
                    <div key={tc.index} className="border rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{tc.label}</p>
                        <Badge variant="outline" className="font-mono text-xs mt-1">{tc.inbox}@</Badge>
                      </div>
                      <Button size="sm" variant="outline" data-testid={`button-simulate-${tc.index}`}
                        disabled={simulateMutation.isPending} onClick={() => simulateMutation.mutate(tc.index)}>
                        {simulateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                        <span className="ml-1">Run</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">End-to-end test flow:</p>
                  <p>1. Run a simulation → inbound message classified + draft reply created</p>
                  <p>2. Go to <strong>Reply Queue</strong> → view the draft → approve → send</p>
                  <p>3. Go to <strong>Follow-Up Queue</strong> → sequence steps appear (scheduled in future)</p>
                  <p>4. Click <strong>Process Due</strong> to move due steps to pending_review status</p>
                  <p>5. Approve + send follow-up steps one by one</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Overview ──────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" />Connection</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  ["Configuration", statusData?.configured ? "✓ Credentials present" : "✗ Not configured"],
                  ["API Connection", statusData?.connected ? "✓ Live" : "–"],
                  ["Status", statusData?.message ?? "–"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground">{val}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Agent → Inbox Mapping</CardTitle></CardHeader>
              <CardContent>
                {agentInboxes.map((a) => (
                  <div key={a.inbox} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div><p className="text-sm font-medium">{a.agent}</p><p className="text-xs text-muted-foreground">{a.description}</p></div>
                    <Badge variant="outline" className="font-mono text-xs">{a.inbox}@</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Inboxes ───────────────────────────────────────────────────── */}
          <TabsContent value="inboxes" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Inbox className="h-4 w-4" />Configured Inboxes</CardTitle></CardHeader>
              <CardContent>
                {!inboxesData?.configured ? <p className="text-sm text-muted-foreground py-4">Not configured.</p>
                  : inboxesData.inboxes.length === 0 ? <p className="text-sm text-muted-foreground py-4">No inboxes found.</p>
                    : <div className="space-y-2">{inboxesData.inboxes.map((ib: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md">
                          <span className="text-sm font-mono">{ib.address ?? ib.username ?? JSON.stringify(ib)}</span>
                          <Badge variant="outline" className="text-xs">Active</Badge>
                        </div>
                      ))}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Verify / Create Inbox</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Inbox local-part</Label>
                    <Select value={verifyInbox} onValueChange={setVerifyInbox}>
                      <SelectTrigger data-testid="select-verify-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => verifyMutation.mutate(verifyInbox)} disabled={verifyMutation.isPending || !statusData?.configured} data-testid="button-verify-inbox">
                    {verifyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Verify / Create
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Outbound Log ──────────────────────────────────────────────── */}
          <TabsContent value="messages" className="mt-4">
            <Card>
              <CardHeader><CardTitle>Outbound Log</CardTitle><CardDescription>All emails dispatched via AgentMail</CardDescription></CardHeader>
              <CardContent>
                {messages.length === 0 ? <p className="text-sm text-muted-foreground py-4">No messages yet.</p> : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>Inbox</TableHead><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {messages.slice(0, 100).map((m) => (
                          <TableRow key={m.id} data-testid={`row-message-${m.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                            <TableCell className="text-sm">{m.agent_name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[140px] truncate">{m.to_email}</TableCell>
                            <TableCell className="text-sm max-w-[180px] truncate">{m.subject}</TableCell>
                            <TableCell><StsBadge status={m.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Send Email ────────────────────────────────────────────────── */}
          <TabsContent value="send" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" />Send Email from Agent Inbox</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>From Inbox</Label>
                    <Select value={sendForm.fromInbox} onValueChange={(v) => setSendForm(f => ({ ...f, fromInbox: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Agent Name</Label><Input data-testid="input-agent-name" value={sendForm.agentName} onChange={(e) => setSendForm(f => ({ ...f, agentName: e.target.value }))} /></div>
                </div>
                <div className="space-y-1"><Label>To</Label><Input data-testid="input-send-to" type="email" value={sendForm.to} onChange={(e) => setSendForm(f => ({ ...f, to: e.target.value }))} placeholder="recipient@example.com" /></div>
                <div className="space-y-1"><Label>Subject</Label><Input data-testid="input-send-subject" value={sendForm.subject} onChange={(e) => setSendForm(f => ({ ...f, subject: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Body</Label><Textarea data-testid="input-send-body" value={sendForm.body} onChange={(e) => setSendForm(f => ({ ...f, body: e.target.value }))} rows={6} /></div>
                <Button data-testid="button-send-email" onClick={() => sendMutation.mutate(sendForm)}
                  disabled={sendMutation.isPending || !statusData?.configured || !sendForm.to || !sendForm.subject || !sendForm.body}>
                  {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Send Email
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Settings ──────────────────────────────────────────────────── */}
          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" />Connection Settings</CardTitle><CardDescription>Credentials stored as Replit Secrets.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { key: "AGENTMAIL_API_KEY", required: true, example: "am_live_xxxx" },
                    { key: "AGENTMAIL_BASE_URL", required: false, example: "https://api.agentmail.to/v0" },
                    { key: "AGENTMAIL_WEBHOOK_SECRET", required: false, example: "whsec_xxxx" },
                    { key: "AGENTMAIL_ORG_DOMAIN", required: false, example: "yourco.com" },
                  ].map(({ key, required, example }) => (
                    <div key={key} className="bg-muted/40 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2"><code className="text-sm font-bold">{key}</code>{required ? <Badge variant="destructive" className="text-xs">Required</Badge> : <Badge variant="outline" className="text-xs">Optional</Badge>}</div>
                      <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">Example: {example}</p>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Send test email to</Label>
                  <div className="flex gap-3">
                    <Input data-testid="input-test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="flex-1" />
                    <Button variant="outline" onClick={() => testMutation.mutate(testTo)} disabled={testMutation.isPending || !statusData?.configured || !testTo} data-testid="button-test-connection">
                      {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Send Test
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <InboundDetailDialog message={selectedInbound} onClose={() => setSelectedInbound(null)} onReply={handleOpenReply} />

      <ReplyDetailDialog
        reply={replyDetail ?? selectedReply}
        onClose={() => setSelectedReply(null)}
        onApprove={(id) => approveMutation.mutate(id)}
        onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
        onSend={(id) => sendReplyMutation.mutate(id)}
        onSaveEdit={(id, body) => editReplyMutation.mutate({ id, body })}
        isPending={approveMutation.isPending || sendReplyMutation.isPending || rejectMutation.isPending}
      />

      <FollowupDetailDialog
        followup={followupDetail ?? selectedFollowup}
        onClose={() => setSelectedFollowup(null)}
        onApprove={(id) => approveFollowupMutation.mutate(id)}
        onReject={(id, reason) => rejectFollowupMutation.mutate({ id, reason })}
        onSend={(id) => sendFollowupMutation.mutate(id)}
        onSaveEdit={(id, body) => editFollowupMutation.mutate({ id, body })}
        onCancel={(id, reason, all) => cancelFollowupMutation.mutate({ id, reason, cancelAll: all })}
        isPending={approveFollowupMutation.isPending || sendFollowupMutation.isPending || rejectFollowupMutation.isPending || cancelFollowupMutation.isPending}
      />

      {replyDraft && (
        <Dialog open={!!replyDraft} onOpenChange={() => setReplyDraft(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" />Compose Reply</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>From Inbox</Label>
                <Select value={replyDraft.fromInbox} onValueChange={(v) => setReplyDraft(d => d ? { ...d, fromInbox: v } : d)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>To</Label><Input value={replyDraft.to} onChange={(e) => setReplyDraft(d => d ? { ...d, to: e.target.value } : d)} /></div>
              <div className="space-y-1"><Label>Subject</Label><Input value={replyDraft.subject} onChange={(e) => setReplyDraft(d => d ? { ...d, subject: e.target.value } : d)} /></div>
              <div className="space-y-1"><Label>Body</Label><Textarea value={replyDraft.body} rows={6} onChange={(e) => setReplyDraft(d => d ? { ...d, body: e.target.value } : d)} /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setReplyDraft(null)}>Cancel</Button>
                <Button data-testid="button-send-reply" disabled={replyMutation.isPending || !statusData?.configured}
                  onClick={() => { if (!replyDraft) return; replyMutation.mutate({ fromInbox: replyDraft.fromInbox, to: replyDraft.to, subject: replyDraft.subject, body: replyDraft.body, threadId: "manual" }); }}>
                  {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Send
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
