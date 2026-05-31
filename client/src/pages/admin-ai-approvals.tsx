import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  CheckCheck,
  X,
  Pencil,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  Send,
  Inbox,
  BarChart2,
  Sliders,
  RefreshCw,
  Shield,
  Zap,
  TrendingUp,
  User,
  Filter,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface Proposal {
  id: string;
  orgId: string;
  actionType: string;
  recipientEmail: string | null;
  subject: string | null;
  bodyPreview: string | null;
  riskLevel: string;
  approvalRequired: boolean;
  status: string;
  createdByAgent: string | null;
  leadId: string | null;
  dealId: string | null;
  createdAt: string | null;
  executedAt: string | null;
}

interface Metrics {
  pending: number;
  lowRisk: number;
  approvalRate: number | null;
  totalReviewed: number;
  approved: number;
  rejected: number;
  sent: number;
  oldestPendingHours: number | null;
}

interface AutonomySetting {
  messageType: string;
  autonomyLevel: number;
  enabled: boolean;
  totalReviewed: number;
  approvalRate: number;
  rejectionRate: number;
  avgRating: number | null;
  readyForLevel2: boolean;
  readyForLevel3: boolean;
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  intake_outreach: "Intake Outreach",
  followup_24h: "24h Follow-up",
  followup_72h: "72h Follow-up",
  followup_7d: "7-Day Follow-up",
  retention: "Retention",
  reactivation: "Reactivation",
  team_partnership: "Team Partnership",
  scheduling_response: "Scheduling Response",
  booking_confirmation: "Booking Confirmation",
};

const AUTONOMY_LEVEL_LABELS = [
  { level: 0, label: "Manual Approval", description: "All messages require your review", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  { level: 1, label: "Suggested", description: "Agent drafts, you approve", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { level: 2, label: "Auto-send Low Risk", description: "Sends automatically when confidence is high", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  { level: 3, label: "Autonomous", description: "Agent sends with monitoring", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
];

function getRiskColor(level: string) {
  if (level === "low") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (level === "medium") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
}

function getMessageTypeLabel(actionType: string) {
  const raw = actionType.replace("propose_draft:", "");
  return MESSAGE_TYPE_LABELS[raw] ?? raw;
}

function MetricCard({ label, value, sub, icon: Icon, alert }: { label: string; value: string | number; sub?: string; icon: any; alert?: boolean }) {
  return (
    <Card className={`${alert ? "border-orange-400 dark:border-orange-600" : ""}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${alert ? "text-orange-600 dark:text-orange-400" : ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${alert ? "text-orange-500" : "text-muted-foreground"}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProposalCard({
  proposal,
  selected,
  onSelect,
  onApprove,
  onEditSend,
  onReject,
}: {
  proposal: Proposal;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (p: Proposal) => void;
  onEditSend: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const createdAgo = proposal.createdAt
    ? formatDistanceToNow(new Date(proposal.createdAt), { addSuffix: true })
    : "unknown";
  const isOld = proposal.createdAt
    ? Date.now() - new Date(proposal.createdAt).getTime() > 24 * 3600 * 1000
    : false;

  return (
    <Card
      className={`transition-all border ${selected ? "border-primary ring-1 ring-primary/30" : ""} ${isOld ? "border-orange-300 dark:border-orange-700" : ""}`}
      data-testid={`card-proposal-${proposal.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(proposal.id, !!v)}
            className="mt-1 flex-shrink-0"
            data-testid={`checkbox-proposal-${proposal.id}`}
          />
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-sm truncate">{proposal.recipientEmail ?? "Unknown recipient"}</span>
              {isOld && (
                <Badge variant="outline" className="text-orange-600 border-orange-400 text-xs flex-shrink-0">
                  <Clock className="h-3 w-3 mr-1" /> {createdAgo}
                </Badge>
              )}
              {!isOld && (
                <span className="text-xs text-muted-foreground flex-shrink-0">{createdAgo}</span>
              )}
            </div>

            {/* Subject */}
            <p className="text-sm font-medium mb-2 text-foreground">{proposal.subject ?? "(no subject)"}</p>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Badge className={`text-xs ${getRiskColor(proposal.riskLevel)}`} data-testid={`badge-risk-${proposal.id}`}>
                {proposal.riskLevel} risk
              </Badge>
              <Badge variant="outline" className="text-xs">
                {getMessageTypeLabel(proposal.actionType)}
              </Badge>
              {proposal.createdByAgent && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {proposal.createdByAgent}
                </Badge>
              )}
            </div>

            {/* Body preview */}
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <div className="bg-muted/40 rounded-md p-3 text-sm text-muted-foreground leading-relaxed mb-3">
                <p className={expanded ? "" : "line-clamp-3"}>{proposal.bodyPreview ?? "(no preview)"}</p>
                <CollapsibleContent>
                  <p className="mt-2 text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    This is a preview (first ~300 chars). Use "Edit & Send" to write the complete email.
                  </p>
                </CollapsibleContent>
              </div>
              <CollapsibleTrigger asChild>
                <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3" data-testid={`button-expand-${proposal.id}`}>
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? "Show less" : "Show more"}
                </button>
              </CollapsibleTrigger>
            </Collapsible>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                className="text-xs gap-1.5"
                onClick={() => onApprove(proposal)}
                data-testid={`button-approve-${proposal.id}`}
              >
                <Send className="h-3 w-3" />
                Approve & Send
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5"
                onClick={() => onEditSend(proposal)}
                data-testid={`button-edit-send-${proposal.id}`}
              >
                <Pencil className="h-3 w-3" />
                Edit & Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={() => onReject(proposal)}
                data-testid={`button-reject-${proposal.id}`}
              >
                <X className="h-3 w-3" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApproveDialog({
  proposal,
  open,
  onClose,
  onSent,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { toast } = useToast();

  const isEditMode = body !== (proposal?.bodyPreview ?? "");

  const approveMutation = useMutation({
    mutationFn: (data: { subject: string; body: string }) =>
      apiRequest("POST", `/api/ai-approvals/${proposal!.id}/approve`, data),
    onSuccess: () => {
      toast({ title: "Email sent", description: `Sent to ${proposal?.recipientEmail}` });
      onSent();
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Failed to send";
      if (msg.includes("Gmail") || msg.includes("gmail")) {
        toast({ title: "Gmail connection error", description: "Please reconnect Gmail in Settings.", variant: "destructive" });
      } else {
        toast({ title: "Failed to send", description: msg, variant: "destructive" });
      }
    },
  });

  function handleOpen() {
    setSubject(proposal?.subject ?? "");
    setBody(proposal?.bodyPreview ?? "");
  }

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else handleOpen(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Review & Send Email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-muted/40 rounded-md p-3 text-sm">
            <p><span className="font-medium">To:</span> {proposal.recipientEmail}</p>
            <p className="mt-1"><span className="font-medium">Type:</span> {getMessageTypeLabel(proposal.actionType)}</p>
          </div>
          <div className="p-3 rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-sm text-orange-800 dark:text-orange-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>The AI stored a <strong>preview only</strong> (first ~300 chars). Review and complete the email body below before sending.</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="approve-subject">Subject</Label>
            <Input
              id="approve-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="input-approve-subject"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="approve-body">Email Body</Label>
            <Textarea
              id="approve-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-sm"
              placeholder="Complete the email body here..."
              data-testid="input-approve-body"
            />
            <p className="text-xs text-muted-foreground">{body.length} characters</p>
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={onClose} data-testid="button-approve-cancel">Cancel</Button>
          <Button
            onClick={() => {
              if (!subject.trim() || !body.trim()) {
                toast({ title: "Subject and body are required", variant: "destructive" });
                return;
              }
              approveMutation.mutate({ subject, body });
            }}
            disabled={approveMutation.isPending || !body.trim()}
            className="gap-1.5"
            data-testid="button-approve-confirm"
          >
            <Send className="h-4 w-4" />
            {approveMutation.isPending ? "Sending…" : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSendDialog({
  proposal,
  open,
  onClose,
  onSent,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const editSendMutation = useMutation({
    mutationFn: (data: { subject: string; body: string; qualityRating?: number; reviewerNotes?: string }) =>
      apiRequest("POST", `/api/ai-approvals/${proposal!.id}/edit-send`, data),
    onSuccess: () => {
      toast({ title: "Email sent", description: `Edited and sent to ${proposal?.recipientEmail}` });
      onSent();
    },
    onError: (err: any) => {
      toast({ title: "Failed to send", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  function handleOpen() {
    setSubject(proposal?.subject ?? "");
    setBody(proposal?.bodyPreview ?? "");
    setRating("");
    setNotes("");
  }

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else handleOpen(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit & Send
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-muted/40 rounded-md p-3 text-sm">
            <p><span className="font-medium">To:</span> {proposal.recipientEmail}</p>
            <p className="mt-1"><span className="font-medium">Original type:</span> {getMessageTypeLabel(proposal.actionType)}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subject">Subject</Label>
            <Input id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-edit-subject" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-body">Email Body</Label>
            <Textarea id="edit-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-mono text-sm" data-testid="input-edit-body" />
            <p className="text-xs text-muted-foreground">{body.length} characters</p>
          </div>
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Training feedback (optional)</p>
            <div className="space-y-1.5">
              <Label htmlFor="edit-rating">Quality rating for AI learning (1–5)</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger id="edit-rating" data-testid="select-rating">
                  <SelectValue placeholder="Rate original draft..." />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} — {["Poor", "Fair", "Good", "Very Good", "Excellent"][n - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Notes for AI (what to improve)</Label>
              <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Too long, avoid hype language, add direct booking CTA..." data-testid="input-edit-notes" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={onClose} data-testid="button-edit-cancel">Cancel</Button>
          <Button
            onClick={() =>
              editSendMutation.mutate({
                subject,
                body,
                qualityRating: rating ? parseInt(rating) : undefined,
                reviewerNotes: notes || undefined,
              })
            }
            disabled={editSendMutation.isPending || !subject.trim() || !body.trim()}
            className="gap-1.5"
            data-testid="button-edit-confirm"
          >
            <Send className="h-4 w-4" />
            {editSendMutation.isPending ? "Sending…" : "Send Edited Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  proposal,
  open,
  onClose,
  onRejected,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState("");
  const [rating, setRating] = useState("");
  const { toast } = useToast();

  const rejectMutation = useMutation({
    mutationFn: (data: { reason: string; qualityRating?: number }) =>
      apiRequest("POST", `/api/ai-approvals/${proposal!.id}/reject`, data),
    onSuccess: () => {
      toast({ title: "Proposal rejected", description: "Feedback saved for agent learning." });
      onRejected();
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <X className="h-4 w-4" />
            Reject Email Draft
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-muted/40 rounded-md p-3 text-sm">
            <p className="font-medium">{proposal.subject}</p>
            <p className="text-muted-foreground mt-1">To: {proposal.recipientEmail}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason (helps train the AI)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Wrong tone, too aggressive, lead already responded..."
              data-testid="input-reject-reason"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reject-rating">Quality rating (1–5)</Label>
            <Select value={rating} onValueChange={setRating}>
              <SelectTrigger id="reject-rating" data-testid="select-reject-rating">
                <SelectValue placeholder="Rate this draft..." />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} — {["Poor", "Fair", "Good", "Very Good", "Excellent"][n - 1]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-reject-cancel">Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => rejectMutation.mutate({ reason, qualityRating: rating ? parseInt(rating) : undefined })}
            disabled={rejectMutation.isPending}
            data-testid="button-reject-confirm"
          >
            {rejectMutation.isPending ? "Rejecting…" : "Reject Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutonomyPanel({ settings }: { settings: AutonomySetting[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: ({ messageType, autonomyLevel, enabled }: { messageType: string; autonomyLevel: number; enabled: boolean }) =>
      apiRequest("POST", `/api/ai-approvals/autonomy/${messageType}`, { autonomyLevel, enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-approvals/autonomy"] });
      toast({ title: "Autonomy settings updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sliders className="h-4 w-4" />
                Autonomy Progression Controls
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Configure per message type</span>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="text-xs text-muted-foreground mb-4 p-3 bg-muted/30 rounded-md">
              <p className="font-medium mb-1">Autonomy levels:</p>
              {AUTONOMY_LEVEL_LABELS.map((l) => (
                <p key={l.level}><span className="font-medium">Level {l.level}:</span> {l.label} — {l.description}</p>
              ))}
              <p className="mt-2 text-orange-600 dark:text-orange-400">⚠ Auto-send is never allowed for pricing, refunds, legal claims, or high-risk churn messages.</p>
            </div>
            <div className="space-y-3">
              {settings.map((s) => {
                const levelInfo = AUTONOMY_LEVEL_LABELS[s.autonomyLevel] ?? AUTONOMY_LEVEL_LABELS[0];
                const canUpgrade = s.readyForLevel2 && s.autonomyLevel < 2;
                return (
                  <div key={s.messageType} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{MESSAGE_TYPE_LABELS[s.messageType] ?? s.messageType}</span>
                        <Badge className={`text-xs ${levelInfo.color}`}>{levelInfo.label}</Badge>
                        {canUpgrade && <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Ready to upgrade</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Reviewed: {s.totalReviewed}</span>
                        <span>Approval: {s.approvalRate}%</span>
                        <span>Rejection: {s.rejectionRate}%</span>
                        {s.avgRating && <span>Avg rating: {s.avgRating}/5</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Select
                        value={String(s.autonomyLevel)}
                        onValueChange={(v) => updateMutation.mutate({ messageType: s.messageType, autonomyLevel: parseInt(v), enabled: s.enabled })}
                        disabled={updateMutation.isPending}
                      >
                        <SelectTrigger className="w-40 text-xs" data-testid={`select-autonomy-${s.messageType}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Level 0 — Manual</SelectItem>
                          <SelectItem value="1" disabled={s.totalReviewed < 5}>Level 1 — Suggested</SelectItem>
                          <SelectItem value="2" disabled={!s.readyForLevel2}>Level 2 — Auto-send Low Risk</SelectItem>
                          <SelectItem value="3" disabled={!s.readyForLevel3}>Level 3 — Autonomous</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function AdminAiApprovalsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("all");
  const [approveDialogProposal, setApproveDialogProposal] = useState<Proposal | null>(null);
  const [editSendDialogProposal, setEditSendDialogProposal] = useState<Proposal | null>(null);
  const [rejectDialogProposal, setRejectDialogProposal] = useState<Proposal | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");

  const { data: proposals = [], isLoading, refetch } = useQuery<Proposal[]>({
    queryKey: ["/api/ai-approvals"],
  });

  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["/api/ai-approvals/metrics"],
  });

  const { data: autonomySettings = [] } = useQuery<AutonomySetting[]>({
    queryKey: ["/api/ai-approvals/autonomy"],
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
    qc.invalidateQueries({ queryKey: ["/api/ai-approvals/metrics"] });
    qc.invalidateQueries({ queryKey: ["/api/ai-approvals/autonomy"] });
    setSelectedIds(new Set());
  }

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/ai-approvals/bulk-approve", { ids }),
    onSuccess: (data: any) => {
      toast({ title: `${data.sent} email${data.sent !== 1 ? "s" : ""} sent`, description: data.failed > 0 ? `${data.failed} failed` : undefined });
      invalidateAll();
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      apiRequest("POST", "/api/ai-approvals/bulk-reject", { ids, reason }),
    onSuccess: (data: any) => {
      toast({ title: `${data.rejected} draft${data.rejected !== 1 ? "s" : ""} rejected` });
      setBulkRejectOpen(false);
      setBulkRejectReason("");
      invalidateAll();
    },
    onError: () => toast({ title: "Bulk reject failed", variant: "destructive" }),
  });

  const filteredByTab = useMemo(() => {
    let list = proposals;
    if (activeTab === "email") list = list.filter((p) => p.actionType.startsWith("propose_draft:"));
    if (activeTab === "intake") list = list.filter((p) => p.actionType.includes("intake_outreach"));
    if (activeTab === "followup") list = list.filter((p) => p.actionType.includes("followup"));
    if (riskFilter !== "all") list = list.filter((p) => p.riskLevel === riskFilter);
    return list;
  }, [proposals, activeTab, riskFilter]);

  const lowRiskProposals = proposals.filter((p) => p.riskLevel === "low");
  const selectedList = filteredByTab.filter((p) => selectedIds.has(p.id));
  const allSelected = filteredByTab.length > 0 && filteredByTab.every((p) => selectedIds.has(p.id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredByTab.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...filteredByTab.map((p) => p.id)]));
    }
  }

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const oldestHours = metrics?.oldestPendingHours ?? null;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6" />
            AI Approval Inbox
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Review, approve, and teach the AI agent what good messages look like.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 flex-shrink-0" data-testid="button-refresh-approvals">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Alerts */}
      {metrics && metrics.pending > 0 && (
        <div className="flex flex-wrap gap-2">
          {metrics.pending > 0 && (
            <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2 text-sm text-orange-800 dark:text-orange-200" data-testid="alert-pending-count">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span><strong>{metrics.pending}</strong> AI draft{metrics.pending !== 1 ? "s" : ""} awaiting your approval</span>
            </div>
          )}
          {metrics.lowRisk > 0 && (
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 text-sm text-green-800 dark:text-green-200">
              <CheckCheck className="h-4 w-4 flex-shrink-0" />
              <span><strong>{metrics.lowRisk}</strong> low-risk draft{metrics.lowRisk !== 1 ? "s" : ""} ready to send</span>
            </div>
          )}
          {oldestHours !== null && oldestHours > 24 && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-sm text-red-800 dark:text-red-200">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>Oldest follow-up backlog: <strong>{oldestHours}h ago</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Pending Approvals" value={metrics?.pending ?? "—"} icon={Inbox} alert={(metrics?.pending ?? 0) > 5} />
        <MetricCard label="Low-Risk Drafts" value={metrics?.lowRisk ?? "—"} sub="ready to send" icon={Shield} />
        <MetricCard label="Approval Rate" value={metrics?.approvalRate != null ? `${metrics.approvalRate}%` : "—"} sub={`${metrics?.totalReviewed ?? 0} reviewed`} icon={TrendingUp} />
        <MetricCard label="Emails Sent" value={metrics?.sent ?? "—"} sub="via this inbox" icon={Send} />
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3" data-testid="bulk-action-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => bulkApproveMutation.mutate([...selectedIds])}
              disabled={bulkApproveMutation.isPending}
              data-testid="button-bulk-approve"
            >
              <Send className="h-3.5 w-3.5" />
              {bulkApproveMutation.isPending ? "Sending…" : "Approve Selected"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-red-600"
              onClick={() => setBulkRejectOpen(true)}
              data-testid="button-bulk-reject"
            >
              <X className="h-3.5 w-3.5" />
              Reject Selected
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Quick bulk actions */}
      {lowRiskProposals.length > 0 && selectedIds.size === 0 && (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-green-400 text-green-700 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950"
            onClick={() => bulkApproveMutation.mutate(lowRiskProposals.map((p) => p.id))}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-approve-all-low-risk"
          >
            <Zap className="h-3.5 w-3.5" />
            {bulkApproveMutation.isPending ? "Sending…" : `Approve All Low-Risk (${lowRiskProposals.length})`}
          </Button>
          <span className="text-xs text-muted-foreground">Sends using stored draft text</span>
        </div>
      )}

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="all" data-testid="tab-all">All ({proposals.length})</TabsTrigger>
            <TabsTrigger value="intake" data-testid="tab-intake">Intake</TabsTrigger>
            <TabsTrigger value="followup" data-testid="tab-followup">Follow-ups</TabsTrigger>
            <TabsTrigger value="email" data-testid="tab-email">All Email</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 ml-auto">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-36 text-xs" data-testid="select-risk-filter">
                <SelectValue placeholder="Risk level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risks</SelectItem>
                <SelectItem value="low">Low risk</SelectItem>
                <SelectItem value="medium">Medium risk</SelectItem>
                <SelectItem value="high">High risk</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {["all", "intake", "followup", "email"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4 space-y-3">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-36 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : filteredByTab.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCheck className="h-10 w-10 text-green-500 mb-3" />
                  <p className="font-medium">All caught up!</p>
                  <p className="text-sm text-muted-foreground mt-1">No pending approvals in this category.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center gap-2 pb-1">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                  <span className="text-xs text-muted-foreground">Select all ({filteredByTab.length})</span>
                </div>
                {filteredByTab.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    selected={selectedIds.has(p.id)}
                    onSelect={handleSelect}
                    onApprove={(p) => setApproveDialogProposal(p)}
                    onEditSend={(p) => setEditSendDialogProposal(p)}
                    onReject={(p) => setRejectDialogProposal(p)}
                  />
                ))}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Autonomy panel */}
      {autonomySettings.length > 0 && <AutonomyPanel settings={autonomySettings} />}

      {/* Dialogs */}
      <ApproveDialog
        proposal={approveDialogProposal}
        open={!!approveDialogProposal}
        onClose={() => setApproveDialogProposal(null)}
        onSent={() => { setApproveDialogProposal(null); invalidateAll(); }}
      />
      <EditSendDialog
        proposal={editSendDialogProposal}
        open={!!editSendDialogProposal}
        onClose={() => setEditSendDialogProposal(null)}
        onSent={() => { setEditSendDialogProposal(null); invalidateAll(); }}
      />
      <RejectDialog
        proposal={rejectDialogProposal}
        open={!!rejectDialogProposal}
        onClose={() => setRejectDialogProposal(null)}
        onRejected={() => { setRejectDialogProposal(null); invalidateAll(); }}
      />

      {/* Bulk reject dialog */}
      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <X className="h-4 w-4" />
              Reject {selectedList.length} draft{selectedList.length !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Label htmlFor="bulk-reject-reason">Reason (optional, helps the AI learn)</Label>
            <Textarea
              id="bulk-reject-reason"
              value={bulkRejectReason}
              onChange={(e) => setBulkRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Wrong tone for these leads, will handle manually..."
              data-testid="input-bulk-reject-reason"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setBulkRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => bulkRejectMutation.mutate({ ids: [...selectedIds], reason: bulkRejectReason })}
              disabled={bulkRejectMutation.isPending}
              data-testid="button-bulk-reject-confirm"
            >
              {bulkRejectMutation.isPending ? "Rejecting…" : `Reject ${selectedList.length} drafts`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
