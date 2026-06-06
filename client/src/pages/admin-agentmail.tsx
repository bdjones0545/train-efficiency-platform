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
  ThumbsUp, ThumbsDown, Edit3, Clock, TrendingUp
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

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
  confidence: number | null; created_at: string; updated_at: string;
  // joined from inbound
  inbound_body?: string | null; inbound_from_name?: string | null;
  inbound_from_email?: string | null; inbound_subject?: string | null;
  inbound_received_at?: string | null;
  outcomes?: OutcomeRecord[];
}
interface OutcomeRecord {
  id: string; outcome_type: string; response_time_minutes: number | null;
  actor: string | null; notes: string | null; created_at: string;
}
interface SimCase { index: number; label: string; inbox: string; }
interface AnalyticsData {
  summary: { total_replies: number; pending: number; approved_unsent: number; sent: number; rejected: number; failed: number; sent_today: number; avgApprovalTimeMinutes: number };
  agentMetrics: { agentName: string; draftsGenerated: number; approvals: number; edits: number; rejections: number; sends: number; deliveryFailures: number; avgResponseTimeMinutes: number; approvalRate: number | null; editRate: number | null }[];
  classificationMetrics: { classification: string; total: number; approvalPct: number | null; editPct: number | null; rejectionPct: number | null; sendPct: number | null }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INBOX_OPTIONS = ["revenue", "hiring", "scheduling", "support", "operations", "ceo"];

const CLASSIFICATION_COLORS: Record<string, string> = {
  new_lead:              "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  booking_request:       "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  reschedule_request:    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  cancellation_request:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  pricing_question:      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  employment_candidate:  "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  support_issue:         "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  billing_issue:         "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  athlete_parent_question:"bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  coach_partner_inquiry: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  software_bug_report:   "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  urgent_escalation:     "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
  general_question:      "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  spam_or_noise:         "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
};

// ─── Small components ────────────────────────────────────────────────────────

function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return <Badge variant="outline" className="text-xs">—</Badge>;
  return <Badge className={`text-xs font-medium ${CLASSIFICATION_COLORS[cls] ?? "bg-gray-100 text-gray-700"}`}>{cls.replace(/_/g, " ")}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:            "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    approved:        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    pending_review:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    drafted:         "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    rejected:        "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    failed:          "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
    routed:          "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    spam_stored:     "bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500",
    received:        "bg-gray-100 text-gray-600",
  };
  return <Badge className={`text-xs ${map[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</Badge>;
}

function ConfBadge({ conf }: { conf: number | null }) {
  if (conf === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(conf * 100);
  const color = pct >= 80 ? "text-green-600" : pct >= 60 ? "text-yellow-600" : "text-red-500";
  return <span className={`text-xs font-medium ${color}`}>{pct}%</span>;
}

function PctCell({ val }: { val: number | null }) {
  if (val === null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = val >= 80 ? "text-green-600" : val >= 50 ? "text-yellow-600" : "text-red-500";
  return <span className={`text-xs font-semibold ${color}`}>{val}%</span>;
}

// ─── Reply Queue Detail Dialog ───────────────────────────────────────────────

function ReplyDetailDialog({
  reply,
  onClose,
  onApprove,
  onReject,
  onSend,
  onSaveEdit,
  isPending,
}: {
  reply: ReplyQueueItem | null;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onSend: (id: string) => void;
  onSaveEdit: (id: string, body: string) => void;
  isPending: boolean;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  if (!reply) return null;

  const currentDraft = reply.edited_body || reply.draft_body;
  const canApprove = reply.approval_status === "pending_review" || reply.approval_status === "drafted";
  const canSend = reply.approval_status === "approved" && reply.status !== "sent" && reply.status !== "failed";
  const canReject = reply.status !== "sent" && reply.approval_status !== "rejected";
  const canEdit = reply.status !== "sent";

  return (
    <Dialog open={!!reply} onOpenChange={() => { onClose(); setEditMode(false); setShowRejectBox(false); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Reply Queue — {reply.subject}
          </DialogTitle>
        </DialogHeader>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* LEFT: original inbound */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ArrowDownToLine className="h-3 w-3" /> Original Inbound Email
            </p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
              <div><span className="text-muted-foreground">From: </span>
                <span className="font-medium">{reply.inbound_from_name ?? reply.inbound_from_email ?? reply.recipient_email}</span></div>
              <div><span className="text-muted-foreground">Subject: </span>
                <span>{reply.inbound_subject ?? reply.subject}</span></div>
              <div><span className="text-muted-foreground">Inbox: </span>
                <Badge variant="outline" className="font-mono text-xs">{reply.inbox}@</Badge></div>
              {reply.inbound_received_at && (
                <div><span className="text-muted-foreground">Received: </span>
                  <span>{new Date(reply.inbound_received_at).toLocaleString()}</span></div>
              )}
              <Separator />
              <div className="mt-2 whitespace-pre-wrap font-mono text-xs max-h-40 overflow-y-auto text-foreground/80">
                {reply.inbound_body ?? "(no body)"}
              </div>
            </div>
          </div>

          {/* RIGHT: draft reply */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-blue-500" /> Agent Draft Reply
              </p>
              <div className="flex items-center gap-2">
                <ClassBadge cls={reply.classification} />
                <ConfBadge conf={reply.confidence} />
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
              <div><span className="text-muted-foreground">To: </span>
                <span className="font-medium">{reply.recipient_email}</span>
                {reply.recipient_name && <span className="text-muted-foreground"> ({reply.recipient_name})</span>}
              </div>
              <div><span className="text-muted-foreground">Subject: </span><span>{reply.subject}</span></div>
              <div><span className="text-muted-foreground">Agent: </span><span>{reply.agent_name}</span></div>
              <Separator />
              {editMode && canEdit ? (
                <div className="space-y-2 mt-2">
                  <Textarea
                    data-testid="input-edit-body"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={8}
                    className="font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { onSaveEdit(reply.id, editBody); setEditMode(false); }}>
                      Save Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 whitespace-pre-wrap font-mono text-xs max-h-40 overflow-y-auto text-foreground/80">
                  {currentDraft}
                </div>
              )}
              {reply.edited_body && !editMode && (
                <Badge className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Edit3 className="h-2.5 w-2.5 mr-1" /> Edited by reviewer
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM: approval history + actions */}
        <div className="space-y-3 pt-2 border-t">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> Audit Trail
          </p>
          {(reply.outcomes ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No audit events yet.</p>
          ) : (
            <div className="space-y-1">
              {(reply.outcomes ?? []).map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleString()}</span>
                  <StatusBadge status={o.outcome_type} />
                  {o.actor && <span className="text-muted-foreground">by {o.actor}</span>}
                  {o.response_time_minutes != null && <span className="text-muted-foreground">({o.response_time_minutes}m response)</span>}
                  {o.notes && <span className="text-muted-foreground italic truncate max-w-xs">{o.notes}</span>}
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Action row */}
          <div className="flex flex-wrap gap-2 items-center">
            {canEdit && !editMode && (
              <Button size="sm" variant="outline" data-testid="button-edit-draft"
                onClick={() => { setEditBody(currentDraft); setEditMode(true); }}>
                <Edit3 className="h-3 w-3 mr-1" /> Edit Draft
              </Button>
            )}
            {canApprove && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1"
                data-testid="button-approve"
                disabled={isPending}
                onClick={() => onApprove(reply.id)}>
                <ThumbsUp className="h-3 w-3" /> Approve
              </Button>
            )}
            {canSend && (
              <Button size="sm" className="gap-1" data-testid="button-send"
                disabled={isPending}
                onClick={() => onSend(reply.id)}>
                <Send className="h-3 w-3" /> Send Now
              </Button>
            )}
            {canReject && !showRejectBox && (
              <Button size="sm" variant="destructive" className="gap-1"
                data-testid="button-reject"
                onClick={() => setShowRejectBox(true)}>
                <ThumbsDown className="h-3 w-3" /> Reject
              </Button>
            )}
            {showRejectBox && (
              <div className="flex gap-2 items-center w-full">
                <Input className="h-8 text-xs flex-1" placeholder="Rejection reason (optional)"
                  value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <Button size="sm" variant="destructive"
                  onClick={() => { onReject(reply.id, rejectReason); setShowRejectBox(false); }}>
                  Confirm Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowRejectBox(false)}>Cancel</Button>
              </div>
            )}
            <div className="ml-auto">
              <StatusBadge status={reply.status} />
              {reply.approval_status !== reply.status && (
                <span className="ml-1"><StatusBadge status={reply.approval_status} /></span>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inbound detail dialog ────────────────────────────────────────────────────

function InboundDetailDialog({
  message, onClose, onReply,
}: { message: InboundMessage | null; onClose: () => void; onReply: (m: InboundMessage) => void }) {
  if (!message) return null;
  const suggestedReply = message.action_payload?.suggestedReply;
  const signals = message.action_payload?.intentSignals ?? [];
  return (
    <Dialog open={!!message} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MailOpen className="h-4 w-4" />{message.subject}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3">
            <div><span className="text-muted-foreground">From: </span><span className="font-medium">{message.from_name ?? ""} &lt;{message.from_email}&gt;</span></div>
            <div><span className="text-muted-foreground">To: </span><span className="font-medium">{message.to_email}</span></div>
            <div><span className="text-muted-foreground">Inbox: </span><Badge variant="outline" className="font-mono text-xs">{message.inbox}@</Badge></div>
            <div><span className="text-muted-foreground">Received: </span><span>{new Date(message.received_at).toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Classification: </span><ClassBadge cls={message.classification} /></div>
            <div><span className="text-muted-foreground">Confidence: </span><ConfBadge conf={message.confidence} /></div>
            <div><span className="text-muted-foreground">Agent: </span><span>{message.routed_agent ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Status: </span><StatusBadge status={message.routed_status} /></div>
          </div>
          {signals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Intent signals</p>
              <div className="flex flex-wrap gap-1">{signals.map((s) => <Badge key={s} variant="outline" className="text-xs">{s.replace(/_/g, " ")}</Badge>)}</div>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Message body</p>
            <div className="bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
              {message.body_text ?? "(no body text)"}
            </div>
          </div>
          {suggestedReply && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1"><Zap className="h-3 w-3" /> AI Suggested Reply Draft</p>
              <p className="text-sm text-blue-900 dark:text-blue-200 whitespace-pre-wrap">{suggestedReply}</p>
            </div>
          )}
          {message.routed_status !== "spam_stored" && (
            <Button size="sm" onClick={() => onReply(message)} className="gap-1"><Send className="h-3 w-3" /> Compose Reply</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminAgentMailPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [testTo, setTestTo] = useState("");
  const [sendForm, setSendForm] = useState({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" });
  const [verifyInbox, setVerifyInbox] = useState("revenue");
  const [selectedInbound, setSelectedInbound] = useState<InboundMessage | null>(null);
  const [selectedReply, setSelectedReply] = useState<ReplyQueueItem | null>(null);
  const [inboundFilter, setInboundFilter] = useState({ inbox: "", classification: "", routed_status: "" });
  const [replyFilter, setReplyFilter] = useState({ inbox: "", classification: "", status: "", approval_status: "" });
  const [replyDraft, setReplyDraft] = useState<{ to: string; subject: string; body: string; fromInbox: string } | null>(null);
  const [activeTab, setActiveTab] = useState("replies");

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({
    queryKey: ["/api/agentmail/status"],
  });
  const { data: inboxesData, isLoading: inboxesLoading } = useQuery<{ configured: boolean; inboxes: any[]; agentInboxes: AgentInboxDef[] }>({
    queryKey: ["/api/agentmail/inboxes"],
  });
  const { data: messagesData, isLoading: messagesLoading } = useQuery<{ messages: AgentMailMessage[]; byStatus: Record<string, number> }>({
    queryKey: ["/api/agentmail/messages"],
  });
  const { data: inboundData, isLoading: inboundLoading, refetch: refetchInbound } = useQuery<{
    messages: InboundMessage[]; byClassification: Record<string, number>; byStatus: Record<string, number>; total: number;
  }>({ queryKey: ["/api/agentmail/inbound"] });
  const { data: repliesData, isLoading: repliesLoading, refetch: refetchReplies } = useQuery<{
    replies: ReplyQueueItem[]; byApprovalStatus: Record<string, number>; total: number;
  }>({ queryKey: ["/api/agentmail/replies"] });
  const { data: analytics, isLoading: analyticsLoading, refetch: refetchAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["/api/agentmail/analytics"],
  });
  const { data: simCases } = useQuery<SimCase[]>({ queryKey: ["/api/agentmail/simulate-inbound/cases"] });

  // Fetch full reply detail when selecting from queue
  const { data: replyDetail, isLoading: replyDetailLoading } = useQuery<ReplyQueueItem>({
    queryKey: ["/api/agentmail/replies", selectedReply?.id],
    enabled: !!selectedReply?.id,
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] });
    queryClient.invalidateQueries({ queryKey: ["/api/agentmail/analytics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/agentmail/status"] });
    if (selectedReply) {
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies", selectedReply.id] });
    }
  };

  const testMutation = useMutation({
    mutationFn: (to: string) => apiRequest("POST", "/api/agentmail/test", { to }),
    onSuccess: () => { toast({ title: "Test email sent" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); },
    onError: (e: any) => toast({ title: "Test failed", description: e?.message, variant: "destructive" }),
  });
  const sendMutation = useMutation({
    mutationFn: (data: typeof sendForm) => apiRequest("POST", "/api/agentmail/send", data),
    onSuccess: () => { toast({ title: "Email sent" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); setSendForm({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" }); },
    onError: (e: any) => toast({ title: "Send failed", description: e?.message, variant: "destructive" }),
  });
  const verifyMutation = useMutation({
    mutationFn: (inbox: string) => apiRequest("POST", "/api/agentmail/inboxes/verify", { inbox }),
    onSuccess: (data: any) => { toast({ title: data?.created ? "Inbox created" : "Inbox verified" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] }); },
    onError: (e: any) => toast({ title: "Verification failed", description: e?.message, variant: "destructive" }),
  });
  const simulateMutation = useMutation({
    mutationFn: (testCaseIndex: number) => apiRequest("POST", "/api/agentmail/simulate-inbound", { testCaseIndex }),
    onSuccess: (data: any) => {
      toast({ title: "Simulation complete", description: `Classified: ${data?.classification ?? "unknown"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inbound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/status"] });
      refetchInbound(); refetchReplies();
    },
    onError: (e: any) => toast({ title: "Simulation failed", description: e?.message, variant: "destructive" }),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/approve`, {}),
    onSuccess: () => { toast({ title: "Reply approved" }); invalidateAll(); },
    onError: (e: any) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/agentmail/replies/${id}/reject`, { reason }),
    onSuccess: () => { toast({ title: "Reply rejected" }); invalidateAll(); setSelectedReply(null); },
    onError: (e: any) => toast({ title: "Reject failed", description: e?.message, variant: "destructive" }),
  });
  const sendReplyMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/replies/${id}/send`, {}),
    onSuccess: () => { toast({ title: "Reply sent successfully" }); invalidateAll(); setSelectedReply(null); },
    onError: (e: any) => toast({ title: "Send failed", description: e?.message, variant: "destructive" }),
  });
  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiRequest("PATCH", `/api/agentmail/replies/${id}`, { edited_body: body }),
    onSuccess: () => { toast({ title: "Draft updated" }); invalidateAll(); },
    onError: (e: any) => toast({ title: "Edit failed", description: e?.message, variant: "destructive" }),
  });
  const replyMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/agentmail/reply", { ...data, agentName: "Manual Reply" }),
    onSuccess: () => { toast({ title: "Reply sent" }); setReplyDraft(null); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); },
    onError: (e: any) => toast({ title: "Reply failed", description: e?.message, variant: "destructive" }),
  });

  // ─── Derived state ────────────────────────────────────────────────────────

  const messages = messagesData?.messages ?? [];
  const sentCount = messagesData?.byStatus?.sent ?? 0;
  const failedCount = messagesData?.byStatus?.failed ?? 0;
  const agentInboxes = statusData?.agentInboxes ?? inboxesData?.agentInboxes ?? [];
  const urgentCount = statusData?.inbound?.urgentEscalations ?? 0;
  const totalInbound = inboundData?.total ?? 0;
  const pendingReplies = repliesData?.byApprovalStatus?.pending_review ?? 0;
  const sentReplies = (analytics?.summary?.sent ?? 0);

  const filteredInbound = (inboundData?.messages ?? []).filter((m) => {
    if (inboundFilter.inbox && m.inbox !== inboundFilter.inbox) return false;
    if (inboundFilter.classification && m.classification !== inboundFilter.classification) return false;
    if (inboundFilter.routed_status && m.routed_status !== inboundFilter.routed_status) return false;
    return true;
  });

  const filteredReplies = (repliesData?.replies ?? []).filter((r) => {
    if (replyFilter.inbox && r.inbox !== replyFilter.inbox) return false;
    if (replyFilter.classification && r.classification !== replyFilter.classification) return false;
    if (replyFilter.status && r.status !== replyFilter.status) return false;
    if (replyFilter.approval_status && r.approval_status !== replyFilter.approval_status) return false;
    return true;
  });

  function openReplyDetail(r: ReplyQueueItem) {
    setSelectedReply(r);
    queryClient.invalidateQueries({ queryKey: ["/api/agentmail/replies", r.id] });
  }

  function handleOpenReply(msg: InboundMessage) {
    setSelectedInbound(null);
    setReplyDraft({ to: msg.from_email, subject: `Re: ${msg.subject}`, body: msg.action_payload?.suggestedReply ?? "", fromInbox: msg.inbox });
  }

  const replyForDialog = selectedReply ? (replyDetail ?? selectedReply) : null;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Mail className="h-6 w-6 text-primary" />AgentMail</h1>
            <p className="text-muted-foreground text-sm mt-1">Dedicated agent inbox infrastructure — outbound, inbound routing, and human-controlled reply approval</p>
          </div>
          <div className="flex items-center gap-3">
            {statusLoading
              ? <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</Badge>
              : statusData?.connected
                ? <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"><Wifi className="h-3 w-3" /> Connected</Badge>
                : statusData?.configured
                  ? <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Disconnected</Badge>
                  : <Badge variant="outline" className="gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" /> Not Configured</Badge>
            }
            <Button data-testid="button-refresh" variant="outline" size="sm" onClick={() => { refetchStatus(); refetchInbound(); refetchReplies(); refetchAnalytics(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Config banner */}
        {!statusLoading && !statusData?.configured && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <CardContent className="pt-4 pb-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div><p className="font-semibold text-amber-800 dark:text-amber-300">AgentMail Not Configured</p>
                <p className="text-sm text-amber-700 dark:text-amber-400">{statusData?.message}</p></div>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {[
            { label: "Sent", value: sentCount, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
            { label: "Outbound Errors", value: failedCount, icon: <XCircle className="h-4 w-4 text-red-500" /> },
            { label: "Inbound", value: totalInbound, icon: <ArrowDownToLine className="h-4 w-4 text-blue-500" /> },
            { label: "Pending Review", value: pendingReplies, icon: <Clock className="h-4 w-4 text-yellow-500" /> },
            { label: "Replies Sent", value: sentReplies, icon: <Send className="h-4 w-4 text-purple-500" /> },
            { label: "Urgent", value: urgentCount, icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
          ].map((s) => (
            <Card key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide leading-none">{s.label}</p>
                  <p className="text-2xl font-bold mt-1">{s.value}</p>
                </div>
                {s.icon}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="replies" data-testid="tab-replies">
              Reply Queue
              {pendingReplies > 0 && <Badge className="ml-1 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">{pendingReplies}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics">Analytics</TabsTrigger>
            <TabsTrigger value="inbound" data-testid="tab-inbound">
              Inbound {totalInbound > 0 && <Badge className="ml-1 text-xs bg-primary/20 text-primary">{totalInbound}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="simulate" data-testid="tab-simulate">Simulate</TabsTrigger>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="inboxes" data-testid="tab-inboxes">Agent Inboxes</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages">Outbound Log</TabsTrigger>
            <TabsTrigger value="failed" data-testid="tab-failed">Failed</TabsTrigger>
            <TabsTrigger value="send" data-testid="tab-send">Send Email</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          {/* ── Reply Queue ───────────────────────────────────────────────── */}
          <TabsContent value="replies" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Human Review Queue</CardTitle>
                    <CardDescription>Agent-drafted replies awaiting approval before sending. No email sends automatically.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchReplies()} data-testid="button-refresh-replies">
                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                  <Select value={replyFilter.inbox || "all"} onValueChange={(v) => setReplyFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-reply-inbox"><SelectValue placeholder="All inboxes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All inboxes</SelectItem>
                      {INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={replyFilter.approval_status || "all"} onValueChange={(v) => setReplyFilter(f => ({ ...f, approval_status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-44" data-testid="filter-approval"><SelectValue placeholder="All approval statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {["pending_review", "approved", "rejected"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={replyFilter.status || "all"} onValueChange={(v) => setReplyFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-send-status"><SelectValue placeholder="All send statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {["drafted", "pending_review", "approved", "sent", "rejected", "failed"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {Object.values(replyFilter).some(Boolean) && (
                    <Button variant="ghost" size="sm" onClick={() => setReplyFilter({ inbox: "", classification: "", status: "", approval_status: "" })}>
                      Clear filters
                    </Button>
                  )}
                </div>

                {repliesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading reply queue…</div>
                ) : filteredReplies.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Mail className="h-8 w-8 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No replies in queue yet.</p>
                    <p className="text-xs mt-1">Run a simulation in the <strong>Simulate</strong> tab — the agent will draft a reply for you to review here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Created</TableHead>
                          <TableHead>Inbox</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Classification</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Conf.</TableHead>
                          <TableHead>Approval</TableHead>
                          <TableHead>Send Status</TableHead>
                          <TableHead>Edited</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredReplies.map((r) => (
                          <TableRow key={r.id} data-testid={`row-reply-${r.id}`} className="hover:bg-muted/30">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(r.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell><Badge variant="outline" className="font-mono text-xs">{r.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[140px]">
                              <div className="truncate font-medium">{r.recipient_name ?? r.recipient_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{r.recipient_email}</div>
                            </TableCell>
                            <TableCell><ClassBadge cls={r.classification} /></TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">{r.agent_name}</TableCell>
                            <TableCell><ConfBadge conf={r.confidence} /></TableCell>
                            <TableCell><StatusBadge status={r.approval_status} /></TableCell>
                            <TableCell><StatusBadge status={r.status} /></TableCell>
                            <TableCell>
                              {r.edited_body
                                ? <Badge className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"><Edit3 className="h-2.5 w-2.5 mr-1" />Yes</Badge>
                                : <span className="text-xs text-muted-foreground">No</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => openReplyDetail(r)} data-testid={`button-view-reply-${r.id}`}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                                {(r.approval_status === "pending_review" || r.approval_status === "drafted") && (
                                  <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    data-testid={`button-approve-${r.id}`}
                                    disabled={approveMutation.isPending}
                                    onClick={() => approveMutation.mutate(r.id)}>
                                    <ThumbsUp className="h-3 w-3" />
                                  </Button>
                                )}
                                {r.approval_status === "approved" && r.status !== "sent" && (
                                  <Button size="sm" variant="ghost" className="text-primary"
                                    data-testid={`button-send-${r.id}`}
                                    disabled={sendReplyMutation.isPending}
                                    onClick={() => sendReplyMutation.mutate(r.id)}>
                                    <Send className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Approval status breakdown */}
                {Object.keys(repliesData?.byApprovalStatus ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-2">
                    {Object.entries(repliesData!.byApprovalStatus).map(([status, cnt]) => (
                      <div key={status} className="flex items-center gap-1.5 bg-muted/40 rounded px-2.5 py-1.5">
                        <StatusBadge status={status} />
                        <span className="text-sm font-bold">{cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Analytics ─────────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-4 space-y-4">
            {analyticsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading analytics…</div>
            ) : !analytics ? (
              <p className="text-sm text-muted-foreground text-center py-12">No analytics data yet. Run simulations to generate outcomes.</p>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Total Replies", value: analytics.summary.total_replies },
                    { label: "Pending Review", value: analytics.summary.pending },
                    { label: "Sent", value: analytics.summary.sent },
                    { label: "Rejected", value: analytics.summary.rejected },
                    { label: "Sent Today", value: analytics.summary.sent_today },
                    { label: "Approved Unsent", value: analytics.summary.approved_unsent },
                    { label: "Failed", value: analytics.summary.failed },
                    { label: "Avg Approval Time", value: analytics.summary.avgApprovalTimeMinutes ? `${analytics.summary.avgApprovalTimeMinutes}m` : "—" },
                  ].map((s) => (
                    <Card key={s.label} data-testid={`analytics-stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
                      <CardContent className="pt-3 pb-3">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
                        <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Per-agent */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" /> Per-Agent Performance</CardTitle>
                    <CardDescription>Measures which agents write useful drafts — for intelligence only. No automatic retraining.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics.agentMetrics.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No agent data yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Agent</TableHead>
                              <TableHead>Drafts</TableHead>
                              <TableHead>Approvals</TableHead>
                              <TableHead>Edits</TableHead>
                              <TableHead>Rejections</TableHead>
                              <TableHead>Sends</TableHead>
                              <TableHead>Approval %</TableHead>
                              <TableHead>Edit %</TableHead>
                              <TableHead>Avg Time</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analytics.agentMetrics.map((a) => (
                              <TableRow key={a.agentName} data-testid={`analytics-agent-${a.agentName}`}>
                                <TableCell className="font-medium text-sm">{a.agentName}</TableCell>
                                <TableCell className="text-sm">{a.draftsGenerated}</TableCell>
                                <TableCell className="text-sm">{a.approvals}</TableCell>
                                <TableCell className="text-sm">{a.edits}</TableCell>
                                <TableCell className="text-sm">{a.rejections}</TableCell>
                                <TableCell className="text-sm">{a.sends}</TableCell>
                                <TableCell><PctCell val={a.approvalRate} /></TableCell>
                                <TableCell><PctCell val={a.editRate} /></TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {a.avgResponseTimeMinutes ? `${a.avgResponseTimeMinutes}m` : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Per-classification */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> Per-Classification Metrics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {analytics.classificationMetrics.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No classification data yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Classification</TableHead>
                              <TableHead>Total</TableHead>
                              <TableHead>Approval %</TableHead>
                              <TableHead>Edit %</TableHead>
                              <TableHead>Rejection %</TableHead>
                              <TableHead>Send %</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analytics.classificationMetrics.map((c) => (
                              <TableRow key={c.classification} data-testid={`analytics-class-${c.classification}`}>
                                <TableCell><ClassBadge cls={c.classification} /></TableCell>
                                <TableCell className="text-sm">{c.total}</TableCell>
                                <TableCell><PctCell val={c.approvalPct} /></TableCell>
                                <TableCell><PctCell val={c.editPct} /></TableCell>
                                <TableCell><PctCell val={c.rejectionPct} /></TableCell>
                                <TableCell><PctCell val={c.sendPct} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ── Inbound ───────────────────────────────────────────────────── */}
          <TabsContent value="inbound" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><ArrowDownToLine className="h-4 w-4" /> Inbound Messages</CardTitle>
                    <CardDescription>Emails received at agent inboxes — classified, routed, and ready for action</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchInbound()} data-testid="button-refresh-inbound">
                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Select value={inboundFilter.inbox || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-inbox"><SelectValue placeholder="All inboxes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All inboxes</SelectItem>
                      {INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={inboundFilter.classification || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, classification: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-52" data-testid="filter-classification"><SelectValue placeholder="All classifications" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classifications</SelectItem>
                      {Object.keys(inboundData?.byClassification ?? {}).map((c) => (
                        <SelectItem key={c} value={c}>{c.replace(/_/g, " ")} ({inboundData!.byClassification[c]})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={inboundFilter.routed_status || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, routed_status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-40" data-testid="filter-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {["received", "routed", "spam_stored", "failed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(inboundFilter.inbox || inboundFilter.classification || inboundFilter.routed_status) && (
                    <Button variant="ghost" size="sm" onClick={() => setInboundFilter({ inbox: "", classification: "", routed_status: "" })}>Clear</Button>
                  )}
                </div>

                {inboundLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : filteredInbound.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ArrowDownToLine className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No inbound messages yet. Use the <strong>Simulate</strong> tab to test.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Received</TableHead><TableHead>Inbox</TableHead><TableHead>From</TableHead>
                          <TableHead>Subject</TableHead><TableHead>Classification</TableHead><TableHead>Conf.</TableHead>
                          <TableHead>Status</TableHead><TableHead>Reply Draft</TableHead><TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInbound.map((m) => (
                          <TableRow key={m.id} data-testid={`row-inbound-${m.id}`} className="cursor-pointer hover:bg-muted/40">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.received_at).toLocaleString()}</TableCell>
                            <TableCell><Badge variant="outline" className="font-mono text-xs">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[140px]">
                              <div className="truncate font-medium">{m.from_name ?? m.from_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{m.from_email}</div>
                            </TableCell>
                            <TableCell className="text-sm max-w-[180px] truncate">{m.subject}</TableCell>
                            <TableCell><ClassBadge cls={m.classification} /></TableCell>
                            <TableCell><ConfBadge conf={m.confidence} /></TableCell>
                            <TableCell><StatusBadge status={m.routed_status} /></TableCell>
                            <TableCell>
                              {m.action_payload?.suggestedReply
                                ? <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 gap-1"><Zap className="h-2.5 w-2.5" />In Queue</Badge>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
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

          {/* ── Simulate ──────────────────────────────────────────────────── */}
          <TabsContent value="simulate" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Simulate Inbound Email</CardTitle>
                <CardDescription>Run test inbound payloads through the full pipeline: classify → draft reply → add to approval queue.</CardDescription>
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
                        disabled={simulateMutation.isPending}
                        onClick={() => simulateMutation.mutate(tc.index)}>
                        {simulateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                        <span className="ml-1">Run</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  After running, check the <strong>Reply Queue</strong> tab — the agent draft will be waiting for your approval.
                  Switch to <strong>Inbound</strong> to see the classified email.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Overview ──────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Connection Status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  ["Configuration", statusData?.configured ? "✓ Credentials present" : "✗ Not configured"],
                  ["API Connection", statusData?.connected ? "✓ Live" : statusData?.configured ? "✗ Unreachable" : "–"],
                  ["Status", statusData?.message ?? "–"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground text-right max-w-xs">{val}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Agent → Inbox Mapping</CardTitle></CardHeader>
              <CardContent>
                {agentInboxes.map((a) => (
                  <div key={a.inbox} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{a.agent}</p>
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">{a.inbox}@</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Agent Inboxes ─────────────────────────────────────────────── */}
          <TabsContent value="inboxes" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Inbox className="h-4 w-4" /> Configured Inboxes</CardTitle></CardHeader>
              <CardContent>
                {inboxesLoading ? <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                  : !inboxesData?.configured ? <p className="text-sm text-muted-foreground py-4">AgentMail not configured.</p>
                    : inboxesData.inboxes.length === 0 ? <p className="text-sm text-muted-foreground py-4">No inboxes found.</p>
                      : <div className="space-y-2">{inboxesData.inboxes.map((inbox: any, i: number) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md">
                            <span className="text-sm font-mono">{inbox.address ?? inbox.username ?? JSON.stringify(inbox)}</span>
                            <Badge variant="outline" className="text-xs">Active</Badge>
                          </div>
                        ))}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Verify / Create Inbox</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Inbox local-part</Label>
                    <Select value={verifyInbox} onValueChange={setVerifyInbox}>
                      <SelectTrigger data-testid="select-verify-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button data-testid="button-verify-inbox"
                    onClick={() => verifyMutation.mutate(verifyInbox)}
                    disabled={verifyMutation.isPending || !statusData?.configured}>
                    {verifyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Verify / Create
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Outbound Log ──────────────────────────────────────────────── */}
          <TabsContent value="messages" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Outbound Sent Messages</CardTitle>
                <CardDescription>All outbound messages logged by the AgentMail integration</CardDescription>
              </CardHeader>
              <CardContent>
                {messagesLoading ? <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                  : messages.filter(m => m.status !== "failed").length === 0
                    ? <p className="text-sm text-muted-foreground py-4">No sent messages yet.</p>
                    : <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>Inbox</TableHead>
                              <TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {messages.filter(m => m.status !== "failed").slice(0, 100).map((m) => (
                              <TableRow key={m.id} data-testid={`row-message-${m.id}`}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                                <TableCell className="text-sm">{m.agent_name}</TableCell>
                                <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@</Badge></TableCell>
                                <TableCell className="text-sm max-w-[160px] truncate">{m.to_email}</TableCell>
                                <TableCell className="text-sm max-w-[200px] truncate">{m.subject}</TableCell>
                                <TableCell><StatusBadge status={m.status} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Failed ────────────────────────────────────────────────────── */}
          <TabsContent value="failed" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" /> Failed Messages</CardTitle></CardHeader>
              <CardContent>
                {messages.filter(m => m.status === "failed").length === 0
                  ? <p className="text-sm text-muted-foreground py-4">No failed messages.</p>
                  : <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Error</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {messages.filter(m => m.status === "failed").map((m) => (
                            <TableRow key={m.id} data-testid={`row-failed-${m.id}`}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                              <TableCell className="text-sm">{m.agent_name}</TableCell>
                              <TableCell className="text-sm max-w-[120px] truncate">{m.to_email}</TableCell>
                              <TableCell className="text-sm max-w-[120px] truncate">{m.subject}</TableCell>
                              <TableCell className="text-sm text-red-600 dark:text-red-400 max-w-[200px] truncate">{m.error_message ?? "Unknown"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Send Email ────────────────────────────────────────────────── */}
          <TabsContent value="send" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Send Email from Agent Inbox</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>From Inbox</Label>
                    <Select value={sendForm.fromInbox} onValueChange={(v) => setSendForm(f => ({ ...f, fromInbox: v }))}>
                      <SelectTrigger data-testid="select-send-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Agent Name</Label>
                    <Input data-testid="input-agent-name" value={sendForm.agentName} onChange={(e) => setSendForm(f => ({ ...f, agentName: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>To Email</Label>
                  <Input data-testid="input-send-to" type="email" value={sendForm.to} onChange={(e) => setSendForm(f => ({ ...f, to: e.target.value }))} placeholder="recipient@example.com" />
                </div>
                <div className="space-y-1">
                  <Label>Subject</Label>
                  <Input data-testid="input-send-subject" value={sendForm.subject} onChange={(e) => setSendForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject" />
                </div>
                <div className="space-y-1">
                  <Label>Body</Label>
                  <Textarea data-testid="input-send-body" value={sendForm.body} onChange={(e) => setSendForm(f => ({ ...f, body: e.target.value }))} rows={6} />
                </div>
                <Button data-testid="button-send-email"
                  onClick={() => sendMutation.mutate(sendForm)}
                  disabled={sendMutation.isPending || !statusData?.configured || !sendForm.to || !sendForm.subject || !sendForm.body}>
                  {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send Email
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Settings ──────────────────────────────────────────────────── */}
          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Connection Settings</CardTitle>
                <CardDescription>Credentials stored as Replit Secrets. Never exposed in code.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { key: "AGENTMAIL_API_KEY", required: true, example: "am_live_xxxx" },
                    { key: "AGENTMAIL_BASE_URL", required: false, example: "https://api.agentmail.to/v0" },
                    { key: "AGENTMAIL_DEFAULT_FROM", required: false, example: "operations@yourco.com" },
                    { key: "AGENTMAIL_WEBHOOK_SECRET", required: false, example: "whsec_xxxx" },
                    { key: "AGENTMAIL_ORG_DOMAIN", required: false, example: "yourco.com" },
                  ].map(({ key, required, example }) => (
                    <div key={key} className="bg-muted/40 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-bold">{key}</code>
                        {required ? <Badge variant="destructive" className="text-xs">Required</Badge> : <Badge variant="outline" className="text-xs">Optional</Badge>}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">Example: {example}</p>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Test Connection</p>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1 space-y-1">
                      <Label>Send test email to</Label>
                      <Input data-testid="input-test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
                    </div>
                    <Button data-testid="button-test-connection" variant="outline"
                      onClick={() => testMutation.mutate(testTo)}
                      disabled={testMutation.isPending || !statusData?.configured || !testTo}>
                      {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                      Send Test
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
        reply={replyDetailLoading ? null : (replyForDialog as ReplyQueueItem | null)}
        onClose={() => setSelectedReply(null)}
        onApprove={(id) => approveMutation.mutate(id)}
        onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
        onSend={(id) => sendReplyMutation.mutate(id)}
        onSaveEdit={(id, body) => editMutation.mutate({ id, body })}
        isPending={approveMutation.isPending || sendReplyMutation.isPending || rejectMutation.isPending || editMutation.isPending}
      />

      {replyDraft && (
        <Dialog open={!!replyDraft} onOpenChange={() => setReplyDraft(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Compose Reply</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>From Inbox</Label>
                <Select value={replyDraft.fromInbox} onValueChange={(v) => setReplyDraft(d => d ? { ...d, fromInbox: v } : d)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input value={replyDraft.to} onChange={(e) => setReplyDraft(d => d ? { ...d, to: e.target.value } : d)} />
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={replyDraft.subject} onChange={(e) => setReplyDraft(d => d ? { ...d, subject: e.target.value } : d)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <Textarea value={replyDraft.body} rows={6} onChange={(e) => setReplyDraft(d => d ? { ...d, body: e.target.value } : d)} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setReplyDraft(null)}>Cancel</Button>
                <Button data-testid="button-send-reply"
                  disabled={replyMutation.isPending || !statusData?.configured}
                  onClick={() => { if (!replyDraft) return; replyMutation.mutate({ fromInbox: replyDraft.fromInbox, to: replyDraft.to, subject: replyDraft.subject, body: replyDraft.body, threadId: "manual" }); }}>
                  {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send Reply
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
