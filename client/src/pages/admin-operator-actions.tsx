import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock,
  DollarSign, Eye, Filter, Info, Plus, RefreshCw, Shield, User, Users, XCircle
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface OperatorAction {
  id: string; orgId: string; sourceType: string; sourceKey?: string;
  severity: "info" | "warning" | "critical"; category: string;
  title: string; description?: string; suggestedAction?: string;
  status: "open" | "acknowledged" | "in_progress" | "resolved" | "ignored";
  assignedToUserId?: string; assignedToCoachId?: string;
  relatedClientId?: string; relatedCoachId?: string; relatedCloseoutId?: string;
  estimatedImpact?: string; metadata?: any;
  acknowledgedAt?: string; resolvedAt?: string; ignoredAt?: string; ignoredReason?: string;
  createdBy?: string; createdAt: string; updatedAt: string;
}

interface ActionEvent {
  id: string; operatorActionId: string; actorId?: string;
  eventType: string; previousStatus?: string; newStatus?: string;
  note?: string; createdAt: string;
}

interface ActionSummary {
  totalOpen: number; criticalOpen: number; staleCount: number;
  inProgressCount: number; resolvedLast7d: number;
  byCategory: Record<string, number>; byStatus: Record<string, number>;
  narrative?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800",
  warning:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
  info:     "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800",
};
const STATUS_BADGE: Record<string, string> = {
  open:        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  acknowledged:"bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  in_progress: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  resolved:    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  ignored:     "bg-muted text-muted-foreground",
};
const CAT_ICON: Record<string, any> = {
  financial: DollarSign, payout: DollarSign, churn: Users,
  scheduling: Clock, accounting: Shield, client_retention: User,
  coach_operations: Users,
};
const SOURCE_LABELS: Record<string, string> = {
  financial_brain: "AI Financial Brain", reconciliation: "Reconciliation",
  integrity_check: "Integrity Check", scheduling: "Scheduling",
  churn_risk: "Churn Risk", payout_review: "Payout Review", manual: "Manual",
};

function SevDot({ sev }: { sev: string }) {
  const cls = sev === "critical" ? "bg-red-500" : sev === "warning" ? "bg-amber-400" : "bg-blue-400";
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />;
}

// ── Action Detail Drawer ─────────────────────────────────────────────────────

function ActionDetail({ action, onClose, onTransition }: { action: OperatorAction; onClose: () => void; onTransition: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");
  const [showIgnore, setShowIgnore] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const { data: events } = useQuery<ActionEvent[]>({
    queryKey: ["/api/admin/operator-actions", action.id, "events"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/operator-actions/${action.id}/events`, { credentials: "include" });
      return r.json();
    },
  });

  const transition = (endpoint: string, body: any = {}) =>
    apiRequest("POST", `/api/admin/operator-actions/${action.id}/${endpoint}`, body)
      .then(() => { onTransition(); toast({ title: "Action updated" }); })
      .catch(e => toast({ title: "Error", description: e.message, variant: "destructive" }));

  const EVENT_LABELS: Record<string, string> = {
    created: "Created", acknowledged: "Acknowledged", assigned: "Assigned",
    started: "Started work", resolved: "Resolved", ignored: "Ignored",
    note_added: "Note added", reassigned: "Reassigned",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-background border-l shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${SEV_BADGE[action.severity]}`}>{action.severity}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_BADGE[action.status]}`}>{action.status.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">{SOURCE_LABELS[action.sourceType] || action.sourceType}</span>
            </div>
            <h2 className="text-base font-semibold leading-tight" data-testid="detail-title">{action.title}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {action.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-sm leading-relaxed">{action.description}</p>
            </div>
          )}
          {action.suggestedAction && (
            <div className="p-3 bg-muted rounded text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-1">Suggested Action</p>
              <p>{action.suggestedAction}</p>
            </div>
          )}
          {action.estimatedImpact && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Estimated Impact</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">{action.estimatedImpact}</p>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Actions</p>
            <div className="flex flex-wrap gap-2">
              {action.status === "open" && (
                <Button size="sm" variant="outline" onClick={() => transition("acknowledge")} data-testid="btn-acknowledge">Acknowledge</Button>
              )}
              {(action.status === "open" || action.status === "acknowledged") && (
                <Button size="sm" variant="outline" onClick={() => transition("start")} data-testid="btn-start">Start Work</Button>
              )}
              {action.status !== "resolved" && action.status !== "ignored" && (
                <Button size="sm" variant="default" onClick={() => transition("resolve", { note })} data-testid="btn-resolve">Resolve</Button>
              )}
              {action.status !== "resolved" && action.status !== "ignored" && (
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setShowIgnore(v => !v)} data-testid="btn-ignore-toggle">Ignore</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setShowAssign(v => !v)} data-testid="btn-assign-toggle">Assign</Button>
            </div>
          </div>

          {showIgnore && (
            <div className="space-y-2">
              <Textarea placeholder="Reason for ignoring (required)" value={ignoreReason} onChange={e => setIgnoreReason(e.target.value)} className="text-sm" data-testid="input-ignore-reason" />
              <Button size="sm" variant="destructive" disabled={!ignoreReason.trim()}
                onClick={() => { transition("ignore", { reason: ignoreReason }); setShowIgnore(false); }}
                data-testid="btn-confirm-ignore">Confirm Ignore</Button>
            </div>
          )}

          {showAssign && (
            <div className="space-y-2">
              <Input placeholder="User ID to assign to" value={assignUserId} onChange={e => setAssignUserId(e.target.value)} className="text-sm" data-testid="input-assign-user" />
              <Button size="sm" variant="outline" disabled={!assignUserId.trim()}
                onClick={() => { transition("assign", { userId: assignUserId }); setShowAssign(false); }}
                data-testid="btn-confirm-assign">Assign</Button>
            </div>
          )}

          {/* Note */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add Note</p>
            <Textarea placeholder="Add a note to the audit trail…" value={note} onChange={e => setNote(e.target.value)} className="text-sm min-h-[60px]" data-testid="input-note" />
            <Button size="sm" variant="outline" disabled={!note.trim()}
              onClick={() => { transition("note", { note }); setNote(""); }}
              data-testid="btn-add-note">Add Note</Button>
          </div>

          {/* Related entities */}
          {(action.relatedClientId || action.relatedCoachId || action.relatedCloseoutId) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Related Entities</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {action.relatedClientId && <span className="bg-muted px-2 py-1 rounded">Client: {action.relatedClientId}</span>}
                {action.relatedCoachId && <span className="bg-muted px-2 py-1 rounded">Coach: {action.relatedCoachId}</span>}
                {action.relatedCloseoutId && <span className="bg-muted px-2 py-1 rounded">Closeout: {action.relatedCloseoutId.slice(0, 8)}…</span>}
              </div>
            </div>
          )}

          {/* Metadata */}
          {action.metadata && Object.keys(action.metadata).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">AI Source Context</p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-48">{JSON.stringify(action.metadata, null, 2)}</pre>
            </div>
          )}

          {/* Audit timeline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Audit Timeline</p>
            <div className="space-y-3">
              {(events || []).map(ev => (
                <div key={ev.id} className="flex gap-3 text-sm" data-testid={`event-${ev.id}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-border mt-2 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{EVENT_LABELS[ev.eventType] || ev.eventType}</span>
                      {ev.previousStatus && ev.newStatus && (
                        <span className="text-xs text-muted-foreground">
                          {ev.previousStatus} → {ev.newStatus}
                        </span>
                      )}
                    </div>
                    {ev.note && <p className="text-muted-foreground text-xs mt-0.5">{ev.note}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(ev.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {(!events || events.length === 0) && (
                <p className="text-xs text-muted-foreground">No audit events yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Action Dialog ─────────────────────────────────────────────────────

function CreateActionDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", description: "", suggestedAction: "", severity: "warning",
    category: "financial", sourceType: "manual", estimatedImpact: "",
  });

  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await apiRequest("POST", "/api/admin/operator-actions", form);
      toast({ title: "Action created" });
      onCreated();
      onClose();
      setForm({ title: "", description: "", suggestedAction: "", severity: "warning", category: "financial", sourceType: "manual", estimatedImpact: "" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Operator Action</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <Input placeholder="Title (required)" value={form.title} onChange={e => f("title", e.target.value)} data-testid="input-action-title" />
          <Textarea placeholder="Description" value={form.description} onChange={e => f("description", e.target.value)} className="min-h-[80px]" data-testid="input-action-description" />
          <Textarea placeholder="Suggested action" value={form.suggestedAction} onChange={e => f("suggestedAction", e.target.value)} data-testid="input-action-suggested" />
          <Input placeholder="Estimated impact" value={form.estimatedImpact} onChange={e => f("estimatedImpact", e.target.value)} data-testid="input-action-impact" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={form.severity} onValueChange={v => f("severity", v)}>
              <SelectTrigger data-testid="select-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={form.category} onValueChange={v => f("category", v)}>
              <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["financial","payout","churn","scheduling","accounting","client_retention","coach_operations"].map(c => (
                  <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.sourceType} onValueChange={v => f("sourceType", v)}>
              <SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={!form.title.trim()} data-testid="btn-confirm-create">Create Action</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Action Row ───────────────────────────────────────────────────────────────

function ActionRow({ action, onSelect }: { action: OperatorAction; onSelect: (a: OperatorAction) => void }) {
  const Icon = CAT_ICON[action.category] || DollarSign;
  const isStale = (new Date().getTime() - new Date(action.createdAt).getTime()) > 3 * 24 * 3600000
    && action.status === "open";

  return (
    <div
      className={`flex items-start gap-3 p-4 border-b hover:bg-muted/30 cursor-pointer transition-colors ${action.severity === "critical" ? "border-l-2 border-l-red-400" : ""}`}
      onClick={() => onSelect(action)}
      data-testid={`action-row-${action.id}`}
    >
      <div className="flex items-center gap-2 mt-0.5 flex-shrink-0">
        <SevDot sev={action.severity} />
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">{action.title}</span>
          {isStale && <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 px-1.5 py-0.5 rounded">Stale</span>}
        </div>
        {action.description && <p className="text-xs text-muted-foreground line-clamp-1">{action.description}</p>}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SEV_BADGE[action.severity]}`}>{action.severity}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_BADGE[action.status]}`}>{action.status.replace(/_/g,"  ")}</span>
          <span className="text-xs text-muted-foreground">{action.category.replace(/_/g, " ")}</span>
          <span className="text-xs text-muted-foreground">{SOURCE_LABELS[action.sourceType] || action.sourceType}</span>
          <span className="text-xs text-muted-foreground">{new Date(action.createdAt).toLocaleDateString()}</span>
        </div>
        {action.estimatedImpact && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Impact: {action.estimatedImpact}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "critical", label: "Critical" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "ignored", label: "Ignored" },
];

export default function AdminOperatorActionsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OperatorAction | null>(null);
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams();
  if (tab !== "all" && tab !== "critical") params.set("status", tab);
  if (tab === "critical") params.set("severity", "critical");
  if (severityFilter !== "all") params.set("severity", severityFilter);
  if (categoryFilter !== "all") params.set("category", categoryFilter);

  const { data: actions, isLoading, refetch, isFetching } = useQuery<OperatorAction[]>({
    queryKey: ["/api/admin/operator-actions", tab, severityFilter, categoryFilter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/operator-actions?${params}`, { credentials: "include" });
      return r.json();
    },
  });

  const { data: summary } = useQuery<ActionSummary>({
    queryKey: ["/api/admin/operator-actions/summary"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/operator-actions"] });
    if (selected) {
      qc.invalidateQueries({ queryKey: ["/api/admin/operator-actions", selected.id, "events"] });
    }
  };

  const filtered = (actions || []).filter(a => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return a.title.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between flex-wrap gap-4 max-w-6xl mx-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="page-title-actions">Operator Action Center</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Track and resolve AI-detected operational risks. All transitions require explicit human confirmation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5" data-testid="button-refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5" data-testid="button-create-action">
              <Plus className="w-3.5 h-3.5" /> New Action
            </Button>
          </div>
        </div>

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-4 mt-3 flex-wrap max-w-6xl mx-auto">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="font-semibold text-foreground" data-testid="summary-open">{summary.totalOpen}</span>
              <span className="text-muted-foreground">open</span>
            </div>
            {summary.criticalOpen > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                <span className="font-semibold text-red-600 dark:text-red-400" data-testid="summary-critical">{summary.criticalOpen}</span>
                <span className="text-muted-foreground">critical</span>
              </div>
            )}
            {summary.staleCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <Clock className="w-3.5 h-3.5 text-orange-500" />
                <span className="font-semibold text-orange-600" data-testid="summary-stale">{summary.staleCount}</span>
                <span className="text-muted-foreground">stale</span>
              </div>
            )}
            {summary.inProgressCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-semibold text-sky-600" data-testid="summary-in-progress">{summary.inProgressCount}</span>
                <span className="text-muted-foreground">in progress</span>
              </div>
            )}
            {summary.resolvedLast7d > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="font-semibold text-green-600">{summary.resolvedLast7d}</span>
                <span className="text-muted-foreground">resolved (7d)</span>
              </div>
            )}
          </div>
        )}
        {summary?.narrative && (
          <p className="text-xs text-muted-foreground mt-2 max-w-2xl">{summary.narrative}</p>
        )}
      </div>

      {/* Tabs + filters */}
      <div className="border-b bg-background px-6 py-2 flex items-center gap-4 flex-wrap max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 w-40 text-xs"
            data-testid="input-search"
          />
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-7 w-28 text-xs" data-testid="filter-severity"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-7 w-36 text-xs" data-testid="filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {["financial","payout","churn","scheduling","accounting","client_retention","coach_operations"].map(c => (
                <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Action list */}
      <div className="flex-1 overflow-y-auto max-w-6xl mx-auto w-full">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading actions…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No actions match the current filters.</p>
          </div>
        ) : (
          <div>
            {filtered.map(a => (
              <ActionRow key={a.id} action={a} onSelect={setSelected} />
            ))}
          </div>
        )}
      </div>

      {/* Safety notice */}
      <div className="border-t px-6 py-2 bg-muted/20">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-6xl mx-auto">
          <Shield className="w-3 h-3 flex-shrink-0" />
          All transitions require explicit human confirmation. This system never auto-pays coaches, auto-closes periods, or mutates accounting data.
        </p>
      </div>

      {/* Detail drawer */}
      {selected && (
        <ActionDetail
          action={selected}
          onClose={() => setSelected(null)}
          onTransition={() => { invalidate(); setSelected(null); }}
        />
      )}

      {/* Create dialog */}
      <CreateActionDialog open={creating} onClose={() => setCreating(false)} onCreated={invalidate} />
    </div>
  );
}
