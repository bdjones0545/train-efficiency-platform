import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, Edit3, Filter,
  Mail, MessageSquare, Plus, RefreshCw, Send, Shield, Smartphone,
  Sparkles, ThumbsDown, ThumbsUp, XCircle, BarChart2, Eye
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OutreachDraft {
  id: string; orgId: string; workflowId?: string; operatorActionId?: string;
  relatedClientId?: string; relatedCoachId?: string;
  channel: string; purpose: string; tone: string; status: string;
  subject?: string; content: string; aiGenerated: boolean;
  aiContextSnapshot?: any; generatedBy?: string; approvedBy?: string; sentBy?: string;
  approvedAt?: string; sentAt?: string; rejectedAt?: string; rejectionReason?: string;
  sendResult?: any; createdAt: string; updatedAt: string;
}

interface OutreachEvent {
  id: string; outreachDraftId: string; actorId?: string; eventType: string;
  previousStatus?: string; newStatus?: string; note?: string; metadata?: any; createdAt: string;
}

interface OutreachSummary {
  totalDrafts: number; pendingApproval: number; approved: number;
  sent: number; rejected: number; staleDrafts: number;
  approvalRate: number; sendRate: number;
  byPurpose: Record<string, number>; byChannel: Record<string, number>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<string, string> = {
  inactive_client: "Inactive Client", unused_credits: "Unused Credits",
  expiring_package: "Expiring Package", unpaid_balance: "Unpaid Balance",
  no_show_followup: "No-Show Follow-up", churn_recovery: "Churn Recovery",
  scheduling_recovery: "Scheduling Recovery", general: "General",
};
const TONE_LABELS: Record<string, string> = {
  professional: "Professional", supportive: "Supportive", energetic: "Energetic",
  accountability: "Accountability", relationship_first: "Relationship First",
};
const CHANNEL_ICON: Record<string, any> = { email: Mail, sms: Smartphone, in_app: MessageSquare };
const STATUS_STYLE: Record<string, string> = {
  draft:            "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  approved:         "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  sent:             "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled:        "bg-muted text-muted-foreground",
};
const STATUS_TABS = [
  { key: "all", label: "All" }, { key: "draft", label: "Drafts" },
  { key: "pending_approval", label: "Pending Approval" }, { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" }, { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

const EVENT_LABELS: Record<string, string> = {
  generated: "Draft generated", edited: "Content edited", submitted_for_approval: "Submitted for approval",
  approved: "Approved", rejected: "Rejected", sent: "Sent", cancelled: "Cancelled",
  note_added: "Note added", regenerated: "Regenerated",
};

// ── Generate Dialog ────────────────────────────────────────────────────────────

function GenerateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    clientId: "", workflowId: "", operatorActionId: "",
    purpose: "inactive_client", channel: "email", tone: "supportive",
  });

  const generate = async () => {
    if (!form.clientId.trim()) { toast({ title: "Client ID is required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/outreach/generate", {
        clientId: form.clientId.trim(),
        workflowId: form.workflowId.trim() || undefined,
        operatorActionId: form.operatorActionId.trim() || undefined,
        purpose: form.purpose, channel: form.channel, tone: form.tone,
      });
      toast({ title: "Draft generated" });
      onCreated(); onClose();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> Generate AI Outreach Draft</DialogTitle>
          <DialogDescription>AI will draft outreach based on client context. You review and approve before anything is sent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Input placeholder="Client ID *" value={form.clientId} onChange={e => f("clientId", e.target.value)} data-testid="input-gen-client-id" />
          <Input placeholder="Retention Workflow ID (optional)" value={form.workflowId} onChange={e => f("workflowId", e.target.value)} data-testid="input-gen-workflow-id" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={form.purpose} onValueChange={v => f("purpose", v)}>
              <SelectTrigger data-testid="select-purpose"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PURPOSE_LABELS).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.channel} onValueChange={v => f("channel", v)}>
              <SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="in_app">In-App</SelectItem>
              </SelectContent>
            </Select>
            <Select value={form.tone} onValueChange={v => f("tone", v)}>
              <SelectTrigger data-testid="select-tone"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TONE_LABELS).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={generate} disabled={loading} data-testid="btn-generate-draft">
            {loading ? "Generating…" : "Generate Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Send Confirmation Dialog ───────────────────────────────────────────────────

function SendConfirmDialog({ draft, open, onClose, onSent }: { draft: OutreachDraft; open: boolean; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const send = async () => {
    setLoading(true);
    try {
      await apiRequest("POST", `/api/admin/outreach/${draft.id}/send`, {});
      toast({ title: "Message sent" });
      onSent(); onClose();
    } catch (e: any) { toast({ title: "Send failed", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Send</DialogTitle>
          <DialogDescription>
            This will send the approved message to the client via {draft.channel.toUpperCase()}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-3 bg-muted/30 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">{draft.content}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={loading} data-testid="btn-confirm-send">
            <Send className="w-3.5 h-3.5 mr-1.5" />{loading ? "Sending…" : "Send Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function RejectDialog({ draft, open, onClose, onRejected }: { draft: OutreachDraft; open: boolean; onClose: () => void; onRejected: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const reject = async () => {
    if (!reason.trim()) { toast({ title: "Rejection reason is required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiRequest("POST", `/api/admin/outreach/${draft.id}/reject`, { reason });
      toast({ title: "Draft rejected" });
      onRejected(); onClose();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject Draft</DialogTitle></DialogHeader>
        <Textarea placeholder="Why is this draft being rejected? (required)" value={reason} onChange={e => setReason(e.target.value)} className="min-h-[80px]" data-testid="input-reject-reason" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={reject} disabled={loading || !reason.trim()} data-testid="btn-confirm-reject">
            Reject Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Draft Detail Drawer ───────────────────────────────────────────────────────

function DraftDetail({ draft, onClose, onUpdate }: { draft: OutreachDraft; onClose: () => void; onUpdate: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(draft.content);
  const [editSubject, setEditSubject] = useState(draft.subject || "");
  const [note, setNote] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const { data: events } = useQuery<OutreachEvent[]>({
    queryKey: ["/api/admin/outreach", draft.id, "events"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/outreach/${draft.id}/events`, { credentials: "include" });
      return r.json();
    },
  });

  const act = async (action: string, body: any = {}) => {
    try {
      await apiRequest("POST", `/api/admin/outreach/${draft.id}/${action}`, body);
      toast({ title: `Action: ${action}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/outreach"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/outreach", draft.id, "events"] });
      onUpdate();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const saveEdit = () => {
    act("edit", { content: editContent, subject: editSubject || undefined });
    setEditMode(false);
  };

  const regen = async () => {
    setRegenLoading(true);
    try {
      await apiRequest("POST", `/api/admin/outreach/${draft.id}/regenerate`, {});
      toast({ title: "Regenerated" });
      qc.invalidateQueries({ queryKey: ["/api/admin/outreach"] });
      onUpdate();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setRegenLoading(false); }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await act("note", { note });
    setNote("");
  };

  const ChanIcon = CHANNEL_ICON[draft.channel] || Mail;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-background border-l shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <ChanIcon className="w-4 h-4 text-muted-foreground" />
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[draft.status] || ""}`}>{draft.status.replace(/_/g, " ")}</span>
              {draft.aiGenerated && <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Sparkles className="w-3 h-3" />AI</span>}
            </div>
            <h2 className="text-base font-semibold">{PURPOSE_LABELS[draft.purpose] || draft.purpose}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">{TONE_LABELS[draft.tone]} · {draft.channel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg ml-4">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Message content */}
          {editMode ? (
            <div className="space-y-2">
              {draft.channel === "email" && (
                <Input placeholder="Subject" value={editSubject} onChange={e => setEditSubject(e.target.value)} data-testid="input-edit-subject" />
              )}
              <Textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="min-h-[140px] text-sm font-mono"
                data-testid="input-edit-content"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} data-testid="btn-save-edit">Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div>
              {draft.subject && <p className="text-sm font-semibold mb-1">{draft.subject}</p>}
              <div className="rounded-lg border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-relaxed">{draft.content}</div>
            </div>
          )}

          {/* Context snapshot */}
          {draft.aiContextSnapshot && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer flex items-center gap-1"><Eye className="w-3 h-3" /> AI context snapshot</summary>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">{JSON.stringify(draft.aiContextSnapshot, null, 2)}</pre>
            </details>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Actions</p>
            <div className="flex flex-wrap gap-2">
              {!editMode && ["draft","pending_approval"].includes(draft.status) && (
                <Button size="sm" variant="outline" onClick={() => setEditMode(true)} data-testid="btn-edit">
                  <Edit3 className="w-3.5 h-3.5 mr-1" />Edit
                </Button>
              )}
              {draft.aiGenerated && ["draft"].includes(draft.status) && (
                <Button size="sm" variant="outline" onClick={regen} disabled={regenLoading} data-testid="btn-regenerate">
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${regenLoading ? "animate-spin" : ""}`} />Regenerate
                </Button>
              )}
              {draft.status === "draft" && (
                <Button size="sm" variant="outline" onClick={() => act("submit")} data-testid="btn-submit">
                  Submit for Approval
                </Button>
              )}
              {draft.status === "pending_approval" && (
                <>
                  <Button size="sm" onClick={() => act("approve")} className="gap-1" data-testid="btn-approve">
                    <ThumbsUp className="w-3.5 h-3.5" />Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)} className="gap-1" data-testid="btn-reject">
                    <ThumbsDown className="w-3.5 h-3.5" />Reject
                  </Button>
                </>
              )}
              {draft.status === "approved" && (
                <Button size="sm" onClick={() => setSendOpen(true)} className="gap-1" data-testid="btn-send">
                  <Send className="w-3.5 h-3.5" />Send
                </Button>
              )}
              {["draft","pending_approval"].includes(draft.status) && (
                <Button size="sm" variant="ghost" onClick={() => act("cancel")} data-testid="btn-cancel">
                  <XCircle className="w-3.5 h-3.5 mr-1" />Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Note input */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add Note</p>
            <Textarea placeholder="Add context, feedback, or decision notes…" value={note} onChange={e => setNote(e.target.value)} className="text-sm min-h-[60px]" data-testid="input-note" />
            <Button size="sm" variant="outline" disabled={!note.trim()} onClick={addNote} data-testid="btn-add-note">Add Note</Button>
          </div>

          {/* Rejection reason */}
          {draft.status === "rejected" && draft.rejectionReason && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Rejection reason</p>
              <p className="text-sm">{draft.rejectionReason}</p>
            </div>
          )}

          {/* Send result */}
          {draft.sendResult && (
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-xs font-medium text-muted-foreground mb-1">Send result</p>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(draft.sendResult, null, 2)}</pre>
            </div>
          )}

          {/* Audit timeline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Activity Timeline</p>
            <div className="space-y-3">
              {(events || []).map(ev => (
                <div key={ev.id} className="flex gap-3 text-sm" data-testid={`outreach-event-${ev.id}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-border mt-2 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{EVENT_LABELS[ev.eventType] || ev.eventType.replace(/_/g, " ")}</p>
                    {ev.previousStatus && ev.newStatus && (
                      <p className="text-xs text-muted-foreground">{ev.previousStatus} → {ev.newStatus}</p>
                    )}
                    {ev.note && <p className="text-xs text-muted-foreground mt-0.5">{ev.note}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {(!events || events.length === 0) && <p className="text-xs text-muted-foreground">No events yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {sendOpen && <SendConfirmDialog draft={draft} open={sendOpen} onClose={() => setSendOpen(false)} onSent={onUpdate} />}
      {rejectOpen && <RejectDialog draft={draft} open={rejectOpen} onClose={() => setRejectOpen(false)} onRejected={onUpdate} />}
    </div>
  );
}

// ── Draft Card ────────────────────────────────────────────────────────────────

function DraftCard({ draft, onSelect }: { draft: OutreachDraft; onSelect: (d: OutreachDraft) => void }) {
  const ChanIcon = CHANNEL_ICON[draft.channel] || Mail;
  const isStale = draft.status === "draft" &&
    (new Date().getTime() - new Date(draft.updatedAt).getTime()) > 7 * 24 * 3600000;
  const meta = draft.aiContextSnapshot || {};

  return (
    <div
      className={`flex items-start gap-3 p-4 border-b hover:bg-muted/30 cursor-pointer transition-colors ${draft.status === "pending_approval" ? "border-l-2 border-l-amber-400" : ""}`}
      onClick={() => onSelect(draft)}
      data-testid={`draft-card-${draft.id}`}
    >
      <ChanIcon className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium">{PURPOSE_LABELS[draft.purpose] || draft.purpose}</span>
          {meta.clientName && <span className="text-sm text-muted-foreground">· {meta.clientName}</span>}
          {isStale && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Stale</span>}
          {draft.aiGenerated && <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />AI</span>}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">{draft.content}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[draft.status] || ""}`}>{draft.status.replace(/_/g, " ")}</span>
          <span className="text-xs text-muted-foreground capitalize">{draft.channel} · {TONE_LABELS[draft.tone]}</span>
          <span className="text-xs text-muted-foreground">{new Date(draft.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminOutreachQueuePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [purposeFilter, setPurposeFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OutreachDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (tab !== "all") p.set("status", tab);
    if (purposeFilter !== "all") p.set("purpose", purposeFilter);
    if (channelFilter !== "all") p.set("channel", channelFilter);
    return p;
  };

  const { data: drafts, isLoading, refetch, isFetching } = useQuery<OutreachDraft[]>({
    queryKey: ["/api/admin/outreach", tab, purposeFilter, channelFilter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/outreach?${buildParams()}`, { credentials: "include" });
      return r.json();
    },
  });

  const { data: summary } = useQuery<OutreachSummary>({
    queryKey: ["/api/admin/outreach-summary"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/outreach"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/outreach-summary"] });
  };

  const filtered = (drafts || []).filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const meta = d.aiContextSnapshot || {};
    return d.content.toLowerCase().includes(q) ||
      (meta.clientName || "").toLowerCase().includes(q) ||
      PURPOSE_LABELS[d.purpose]?.toLowerCase().includes(q);
  });

  const pendingCount = (drafts || []).filter(d => d.status === "pending_approval").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between flex-wrap gap-4 max-w-6xl mx-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Send className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="page-title-outreach">Outreach Queue</h1>
              {pendingCount > 0 && (
                <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{pendingCount}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">AI-assisted client outreach — review, edit, and approve before anything is sent.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSummary(s => !s)} data-testid="button-toggle-summary">
              <BarChart2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setGenerating(true)} className="gap-1.5" data-testid="button-generate">
              <Sparkles className="w-3.5 h-3.5" /> Generate Draft
            </Button>
          </div>
        </div>

        {/* Summary panel */}
        {showSummary && summary && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-6xl mx-auto">
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Total Drafts</p>
              <p className="text-xl font-bold mt-0.5" data-testid="summary-total">{summary.totalDrafts}</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Pending Approval</p>
              <p className="text-xl font-bold text-amber-600 mt-0.5" data-testid="summary-pending">{summary.pendingApproval}</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Approval Rate</p>
              <p className="text-xl font-bold text-sky-600 mt-0.5" data-testid="summary-approval-rate">{summary.approvalRate}%</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Sent</p>
              <p className="text-xl font-bold text-emerald-600 mt-0.5" data-testid="summary-sent">{summary.sent}</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs + filters */}
      <div className="border-b bg-background px-6 py-2 flex items-center gap-4 flex-wrap max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors relative ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
              {t.key === "pending_approval" && pendingCount > 0 && (
                <span className="ml-1 bg-amber-500 text-white text-xs w-4 h-4 rounded-full inline-flex items-center justify-center">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="h-7 w-36 text-xs" data-testid="input-search" />
          <Select value={purposeFilter} onValueChange={setPurposeFilter}>
            <SelectTrigger className="h-7 w-40 text-xs" data-testid="filter-purpose"><SelectValue placeholder="All purposes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All purposes</SelectItem>
              {Object.entries(PURPOSE_LABELS).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-7 w-28 text-xs" data-testid="filter-channel"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Draft list */}
      <div className="flex-1 overflow-y-auto max-w-6xl mx-auto w-full">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading outreach queue…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No drafts match the current filters.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setGenerating(true)}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate your first draft
            </Button>
          </div>
        ) : (
          filtered.map(d => <DraftCard key={d.id} draft={d} onSelect={setSelected} />)
        )}
      </div>

      {/* Safety notice */}
      <div className="border-t px-6 py-2 bg-muted/20">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-6xl mx-auto">
          <Shield className="w-3 h-3 flex-shrink-0" />
          AI may draft communication. Only humans may approve or send communication. No message is ever auto-sent, auto-approved, or modified after sending.
        </p>
      </div>

      {selected && (
        <DraftDetail
          draft={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => { invalidate(); setSelected(null); }}
        />
      )}
      <GenerateDialog open={generating} onClose={() => setGenerating(false)} onCreated={invalidate} />
    </div>
  );
}
