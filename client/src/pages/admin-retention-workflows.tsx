import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, DollarSign, Filter,
  Plus, RefreshCw, Shield, TrendingDown, User, XCircle, Activity, Sparkles
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetentionWorkflow {
  id: string; orgId: string; workflowType: string; status: string;
  relatedClientId?: string; relatedOperatorActionId?: string;
  riskSeverity: string; estimatedRevenueAtRiskCents: number;
  estimatedRecoverableRevenueCents: number; metadata?: any;
  createdBy?: string; startedAt?: string; completedAt?: string;
  cancelledAt?: string; createdAt: string; updatedAt: string;
}

interface WorkflowEvent {
  id: string; workflowId: string; actorId?: string;
  eventType: string; note?: string; metadata?: any; createdAt: string;
}

interface RecoverySummary {
  totalRecoverableRevenueCents: number;
  inactivePrepaidExposureCents: number;
  unpaidBalanceCents: number;
  expiringPackageExposureCents: number;
  recoveredLast30dCents: number;
  activeWorkflowCount: number;
  churnedClientCount: number;
  narrative?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (c: number | null | undefined) =>
  c == null ? "$0" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const TYPE_LABELS: Record<string, string> = {
  inactive_prepaid: "Inactive Prepaid", unused_credits: "Unused Credits",
  expiring_package: "Expiring Package", unpaid_balance: "Unpaid Balance",
  no_show_followup: "No-Show Follow-up", stalled_client: "Stalled Client",
  churn_risk: "Churn Risk", manual: "Manual",
};
const TYPE_ICON: Record<string, any> = {
  inactive_prepaid: TrendingDown, unused_credits: DollarSign,
  expiring_package: Clock, unpaid_balance: DollarSign,
  no_show_followup: User, stalled_client: Activity,
  churn_risk: AlertTriangle, manual: Shield,
};
const STATUS_BADGE: Record<string, string> = {
  draft:             "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  active:            "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  contacted:         "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  awaiting_response:"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  recovered:         "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  churned:           "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  completed:         "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:         "bg-muted text-muted-foreground",
  paused:            "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};
const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500", warning: "bg-amber-400", info: "bg-blue-400",
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "high_risk", label: "High Risk" },
  { key: "revenue_recovery", label: "Revenue Recovery" },
  { key: "recovered", label: "Recovered" },
  { key: "churned", label: "Churned" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:            ["active", "cancelled"],
  active:           ["contacted", "paused", "cancelled"],
  paused:           ["active", "cancelled"],
  contacted:        ["awaiting_response", "recovered", "churned", "active"],
  awaiting_response:["recovered", "churned", "contacted", "active"],
  recovered:        ["completed"],
  churned:          ["completed"],
  completed:        [],
  cancelled:        [],
};

// ── Workflow Detail Drawer ───────────────────────────────────────────────────

function WorkflowDetail({ wf, onClose, onTransition }: {
  wf: RetentionWorkflow; onClose: () => void; onTransition: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [targetStatus, setTargetStatus] = useState("");

  const { data: events } = useQuery<WorkflowEvent[]>({
    queryKey: ["/api/admin/retention-workflows", wf.id, "events"],
    queryFn: async () => {
      return authenticatedFetch(`/api/admin/retention-workflows/${wf.id}/events`);
    },
  });

  const transition = async (status: string) => {
    try {
      await apiRequest("POST", `/api/admin/retention-workflows/${wf.id}/transition`, { status, note: note || undefined });
      toast({ title: "Workflow updated" });
      onTransition();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await apiRequest("POST", `/api/admin/retention-workflows/${wf.id}/note`, { note });
      toast({ title: "Note added" });
      setNote("");
      onTransition();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const validNext = VALID_TRANSITIONS[wf.status] || [];
  const meta = wf.metadata || {};

  const EVENT_LABELS: Record<string, string> = {
    created: "Workflow created", activated: "Activated", contacted: "Marked contacted",
    awaiting_response: "Awaiting response", recovered: "Marked recovered",
    churned: "Marked churned", completed: "Completed", cancelled: "Cancelled",
    paused: "Paused", resumed: "Resumed", note_added: "Note added",
    outreach_drafted: "Outreach drafted",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-background border-l shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_BADGE[wf.status] || ""}`}>{wf.status.replace(/_/g, " ")}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${wf.riskSeverity === "critical" ? "bg-red-100 text-red-700" : wf.riskSeverity === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{wf.riskSeverity}</span>
            </div>
            <h2 className="text-base font-semibold">{TYPE_LABELS[wf.workflowType] || wf.workflowType} Workflow</h2>
            {wf.relatedClientId && <p className="text-xs text-muted-foreground mt-0.5">Client: {wf.relatedClientId}</p>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Revenue exposure */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Revenue at Risk</p>
              <p className="text-lg font-bold font-mono text-red-600 dark:text-red-400">{fmt(wf.estimatedRevenueAtRiskCents)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Recoverable</p>
              <p className="text-lg font-bold font-mono text-green-600 dark:text-green-400">{fmt(wf.estimatedRecoverableRevenueCents)}</p>
            </div>
          </div>

          {/* Client recovery profile from metadata */}
          {meta && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Client Recovery Profile</p>
              <div className="space-y-1.5 text-sm">
                {meta.clientName && <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span className="font-medium">{meta.clientName}</span></div>}
                {meta.sessionsRemaining != null && <div className="flex justify-between"><span className="text-muted-foreground">Sessions remaining</span><span className="font-medium">{meta.sessionsRemaining}</span></div>}
                {meta.daysSinceLastSession != null && <div className="flex justify-between"><span className="text-muted-foreground">Days inactive</span><span className={`font-medium ${meta.daysSinceLastSession > 60 ? "text-red-600" : meta.daysSinceLastSession > 30 ? "text-amber-600" : ""}`}>{meta.daysSinceLastSession}</span></div>}
                {meta.riskType && <div className="flex justify-between"><span className="text-muted-foreground">Risk type</span><span className="font-medium capitalize">{String(meta.riskType).replace(/_/g, " ")}</span></div>}
                {meta.recommendedAction && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs">
                    <span className="font-medium">Recommended: </span>{meta.recommendedAction}
                  </div>
                )}
                {meta.description && <p className="text-xs text-muted-foreground">{meta.description}</p>}
              </div>
            </div>
          )}

          {/* AI recovery notes */}
          {meta?.aiRecommendation && (
            <div className="p-3 rounded-lg bg-muted/40 border">
              <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> AI Recovery Guidance
              </p>
              <p className="text-sm">{meta.aiRecommendation}</p>
            </div>
          )}

          {/* State transitions */}
          {validNext.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Advance Workflow</p>
              <div className="flex flex-wrap gap-2">
                {validNext.map(next => (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === "recovered" ? "default" : next === "churned" || next === "cancelled" ? "destructive" : "outline"}
                    onClick={() => transition(next)}
                    data-testid={`btn-${next}`}
                    className="capitalize"
                  >
                    {next.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Note input */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add Note</p>
            <Textarea
              placeholder="Log outreach attempt, client response, or context…"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="text-sm min-h-[70px]"
              data-testid="input-workflow-note"
            />
            <Button size="sm" variant="outline" disabled={!note.trim()} onClick={addNote} data-testid="btn-add-note">
              Add Note
            </Button>
          </div>

          {/* Audit timeline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Activity Timeline</p>
            <div className="space-y-3">
              {(events || []).map(ev => (
                <div key={ev.id} className="flex gap-3 text-sm" data-testid={`wf-event-${ev.id}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-border mt-2 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{EVENT_LABELS[ev.eventType] || ev.eventType.replace(/_/g, " ")}</p>
                    {ev.note && <p className="text-xs text-muted-foreground mt-0.5">{ev.note}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {(!events || events.length === 0) && (
                <p className="text-xs text-muted-foreground">No events yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Workflow Dialog ────────────────────────────────────────────────────

function CreateWorkflowDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    workflowType: "manual", riskSeverity: "warning",
    relatedClientId: "", estimatedRevenueAtRiskCents: "",
    metadata: "",
  });

  const create = async () => {
    try {
      const payload: any = {
        workflowType: form.workflowType,
        riskSeverity: form.riskSeverity,
        status: "draft",
      };
      if (form.relatedClientId.trim()) payload.relatedClientId = form.relatedClientId.trim();
      if (form.estimatedRevenueAtRiskCents) {
        const cents = Math.round(parseFloat(form.estimatedRevenueAtRiskCents) * 100);
        if (!isNaN(cents)) { payload.estimatedRevenueAtRiskCents = cents; payload.estimatedRecoverableRevenueCents = Math.round(cents * 0.6); }
      }
      if (form.metadata.trim()) {
        try { payload.metadata = JSON.parse(form.metadata); } catch {}
      }
      await apiRequest("POST", "/api/admin/retention-workflows", payload);
      toast({ title: "Workflow created" });
      onCreated(); onClose();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Retention Workflow</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.workflowType} onValueChange={v => f("workflowType", v)}>
              <SelectTrigger data-testid="select-workflow-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.riskSeverity} onValueChange={v => f("riskSeverity", v)}>
              <SelectTrigger data-testid="select-risk-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input placeholder="Client ID (optional)" value={form.relatedClientId} onChange={e => f("relatedClientId", e.target.value)} data-testid="input-client-id" />
          <Input placeholder="Revenue at risk ($)" type="number" value={form.estimatedRevenueAtRiskCents} onChange={e => f("estimatedRevenueAtRiskCents", e.target.value)} data-testid="input-revenue-at-risk" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} data-testid="btn-confirm-create-workflow">Create Workflow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Workflow Card ────────────────────────────────────────────────────────────

function WorkflowCard({ wf, onSelect }: { wf: RetentionWorkflow; onSelect: (w: RetentionWorkflow) => void }) {
  const Icon = TYPE_ICON[wf.workflowType] || DollarSign;
  const meta = wf.metadata || {};
  const isHighRisk = wf.riskSeverity === "critical" || wf.estimatedRevenueAtRiskCents > 50000;
  const isStale = ["active", "contacted"].includes(wf.status) &&
    (new Date().getTime() - new Date(wf.updatedAt).getTime()) > 7 * 24 * 3600000;

  return (
    <div
      className={`flex items-start gap-3 p-4 border-b hover:bg-muted/30 cursor-pointer transition-colors ${isHighRisk ? "border-l-2 border-l-red-400" : ""}`}
      onClick={() => onSelect(wf)}
      data-testid={`workflow-card-${wf.id}`}
    >
      <div className="flex items-center gap-2 mt-0.5 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEV_DOT[wf.riskSeverity] || "bg-blue-400"}`} />
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium">{TYPE_LABELS[wf.workflowType] || wf.workflowType}</span>
          {meta.clientName && <span className="text-sm text-muted-foreground">· {meta.clientName}</span>}
          {isStale && <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 px-1.5 py-0.5 rounded">Stale</span>}
        </div>
        {meta.description && <p className="text-xs text-muted-foreground line-clamp-1">{meta.description}</p>}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[wf.status] || ""}`}>{wf.status.replace(/_/g, " ")}</span>
          <span className="text-xs text-muted-foreground capitalize">{wf.riskSeverity}</span>
          {wf.estimatedRevenueAtRiskCents > 0 && (
            <span className="text-xs font-mono text-red-600 dark:text-red-400 font-medium">{fmt(wf.estimatedRevenueAtRiskCents)} at risk</span>
          )}
          {wf.estimatedRecoverableRevenueCents > 0 && (
            <span className="text-xs font-mono text-green-600 dark:text-green-400">{fmt(wf.estimatedRecoverableRevenueCents)} recoverable</span>
          )}
          <span className="text-xs text-muted-foreground">{new Date(wf.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminRetentionWorkflowsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RetentionWorkflow | null>(null);
  const [creating, setCreating] = useState(false);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (tab === "active") p.set("status", "active");
    else if (tab === "high_risk") p.set("severity", "critical");
    else if (tab === "revenue_recovery") { /* all non-completed/cancelled */ }
    else if (tab === "recovered") p.set("status", "recovered");
    else if (tab === "churned") p.set("status", "churned");
    else if (tab === "completed") p.set("status", "completed");
    else if (tab === "cancelled") p.set("status", "cancelled");
    if (typeFilter !== "all") p.set("workflowType", typeFilter);
    if (severityFilter !== "all") p.set("riskSeverity", severityFilter);
    return p;
  };

  const { data: workflows, isLoading, refetch, isFetching } = useQuery<RetentionWorkflow[]>({
    queryKey: ["/api/admin/retention-workflows", tab, typeFilter, severityFilter],
    queryFn: async () => {
      return authenticatedFetch(`/api/admin/retention-workflows?${buildParams()}`);
    },
  });

  const { data: summary } = useQuery<RecoverySummary>({
    queryKey: ["/api/admin/revenue-recovery-summary"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/retention-workflows"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/revenue-recovery-summary"] });
    if (selected) qc.invalidateQueries({ queryKey: ["/api/admin/retention-workflows", selected.id, "events"] });
  };

  const filtered = (workflows || []).filter(w => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const meta = w.metadata || {};
    return (meta.clientName || "").toLowerCase().includes(q) ||
      TYPE_LABELS[w.workflowType]?.toLowerCase().includes(q) ||
      w.workflowType.includes(q);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between flex-wrap gap-4 max-w-6xl mx-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="page-title-retention">Client Retention & Revenue Recovery</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Structured retention workflows for inactive clients, unused credits, and revenue recovery.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5" data-testid="button-create-workflow">
              <Plus className="w-3.5 h-3.5" /> New Workflow
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-6xl mx-auto">
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Total Recoverable</p>
              <p className="text-xl font-bold font-mono text-green-600 dark:text-green-400 mt-0.5" data-testid="summary-recoverable">{fmt(summary.totalRecoverableRevenueCents)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Inactive Prepaid Exposure</p>
              <p className="text-xl font-bold font-mono text-red-600 dark:text-red-400 mt-0.5" data-testid="summary-inactive">{fmt(summary.inactivePrepaidExposureCents)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Active Workflows</p>
              <p className="text-xl font-bold mt-0.5" data-testid="summary-active-wf">{summary.activeWorkflowCount}</p>
            </div>
            <div className="p-3 rounded-lg border bg-background">
              <p className="text-xs text-muted-foreground">Recovered (30d)</p>
              <p className="text-xl font-bold font-mono text-emerald-600 mt-0.5" data-testid="summary-recovered">{fmt(summary.recoveredLast30dCents)}</p>
            </div>
          </div>
        )}
        {summary?.narrative && (
          <p className="text-xs text-muted-foreground mt-3 max-w-3xl mx-auto flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 flex-shrink-0" />{summary.narrative}
          </p>
        )}
      </div>

      {/* Tabs + filters */}
      <div className="border-b bg-background px-6 py-2 flex items-center gap-4 flex-wrap max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid={`tab-${t.key}`}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="h-7 w-36 text-xs" data-testid="input-search" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 w-40 text-xs" data-testid="filter-type"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-7 w-28 text-xs" data-testid="filter-severity"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto max-w-6xl mx-auto w-full">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading workflows…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No workflows match the current filters.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreating(true)}>Create your first workflow</Button>
          </div>
        ) : (
          filtered.map(w => <WorkflowCard key={w.id} wf={w} onSelect={setSelected} />)
        )}
      </div>

      {/* Safety notice */}
      <div className="border-t px-6 py-2 bg-muted/20">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-6xl mx-auto">
          <Shield className="w-3 h-3 flex-shrink-0" />
          This system never auto-sends outreach, auto-charges balances, auto-renews subscriptions, or auto-marks clients recovered. All actions require explicit operator confirmation.
        </p>
      </div>

      {selected && (
        <WorkflowDetail
          wf={selected}
          onClose={() => setSelected(null)}
          onTransition={() => { invalidate(); setSelected(null); }}
        />
      )}
      <CreateWorkflowDialog open={creating} onClose={() => setCreating(false)} onCreated={invalidate} />
    </div>
  );
}
