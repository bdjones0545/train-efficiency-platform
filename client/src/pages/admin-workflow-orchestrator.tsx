import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock,
  Filter, Play, Plus, RefreshCw, Shield, SkipForward,
  Sparkles, XCircle, RotateCcw, Pause, ArrowRight
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowTemplate {
  key: string; name: string; description: string; sourceType: string;
  steps: Array<{ key: string; type: string; label: string; nextStepKey?: string }>;
}

interface WorkflowRun {
  id: string; orgId: string; workflowTemplateKey: string; sourceType?: string;
  sourceId?: string; status: string; currentStepKey?: string;
  startedAt?: string; completedAt?: string; failedAt?: string; cancelledAt?: string;
  failureReason?: string; createdBy?: string; metadata?: any;
  createdAt: string; updatedAt: string;
  steps?: WorkflowStepRun[];
}

interface WorkflowStepRun {
  id: string; workflowRunId: string; stepKey: string; stepType: string;
  status: string; startedAt?: string; completedAt?: string; failedAt?: string;
  output?: any; errorMessage?: string; retryCount?: number; createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  running:   "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  waiting:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  blocked:   "bg-orange-100 text-orange-700",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  failed:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};
const STEP_STATUS_STYLE: Record<string, string> = {
  pending:   "text-muted-foreground", running: "text-sky-600 dark:text-sky-400",
  waiting:   "text-amber-600 dark:text-amber-400", completed: "text-emerald-600 dark:text-emerald-400",
  failed:    "text-red-600 dark:text-red-400", skipped: "text-muted-foreground line-through",
};
const STATUS_TABS = [
  { key: "all", label: "All" }, { key: "running", label: "Running" },
  { key: "waiting", label: "Waiting" }, { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" },
];
const STEP_ICON: Record<string, string> = {
  pending: "○", running: "▶", waiting: "⏸", completed: "✓",
  failed: "✕", skipped: "–",
};

function duration(start?: string, end?: string): string {
  if (!start) return "—";
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

// ── Start Workflow Dialog ─────────────────────────────────────────────────────

function StartDialog({ templates, open, onClose, onStarted }: {
  templates: WorkflowTemplate[]; open: boolean; onClose: () => void; onStarted: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ templateKey: "", clientId: "", sourceId: "", clientName: "", metadata: "" });
  const [loading, setLoading] = useState(false);

  const start = async () => {
    if (!form.templateKey) { toast({ title: "Template required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const meta: any = {};
      if (form.clientId.trim()) meta.clientId = form.clientId.trim();
      if (form.clientName.trim()) meta.clientName = form.clientName.trim();
      if (form.metadata.trim()) { try { Object.assign(meta, JSON.parse(form.metadata)); } catch {} }
      await apiRequest("POST", "/api/admin/workflow-runs", {
        templateKey: form.templateKey,
        sourceId: form.sourceId.trim() || undefined,
        metadata: meta,
      });
      toast({ title: "Workflow started" });
      onStarted(); onClose();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const tpl = templates.find(t => t.key === form.templateKey);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="w-4 h-4" /> Start Workflow Run</DialogTitle>
          <DialogDescription>Select a template and provide context. The orchestrator will execute steps sequentially with human approval gates.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Select value={form.templateKey} onValueChange={v => f("templateKey", v)}>
            <SelectTrigger data-testid="select-template"><SelectValue placeholder="Select template…" /></SelectTrigger>
            <SelectContent>
              {templates.map(t => <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {tpl && <p className="text-xs text-muted-foreground">{tpl.description} · {tpl.steps.length} steps</p>}
          <Input placeholder="Client ID (optional)" value={form.clientId} onChange={e => f("clientId", e.target.value)} data-testid="input-client-id" />
          <Input placeholder="Client name (optional)" value={form.clientName} onChange={e => f("clientName", e.target.value)} data-testid="input-client-name" />
          <Input placeholder="Source ID (optional — linked entity)" value={form.sourceId} onChange={e => f("sourceId", e.target.value)} data-testid="input-source-id" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={start} disabled={loading || !form.templateKey} data-testid="btn-start-workflow">
            {loading ? "Starting…" : "Start Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Workflow Run Detail Drawer ─────────────────────────────────────────────────

function RunDetail({ run, onClose, onUpdate }: { run: WorkflowRun; onClose: () => void; onUpdate: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data: detail } = useQuery<WorkflowRun>({
    queryKey: ["/api/admin/workflow-runs", run.id],
    queryFn: async () => {
      const r = await fetch(`/api/admin/workflow-runs/${run.id}`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: run.status === "running" || run.status === "waiting" ? 5000 : false,
  });

  const act = async (action: string, body: any = {}) => {
    try {
      await apiRequest("POST", `/api/admin/workflow-runs/${run.id}/${action}`, body);
      toast({ title: `Action: ${action}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/workflow-runs"] });
      onUpdate();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await act("note", { note });
    setNote("");
  };

  const current = detail || run;
  const steps = current.steps || [];
  const meta = current.metadata || {};

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-background border-l shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[current.status] || ""}`}>{current.status}</span>
            </div>
            <h2 className="text-base font-semibold">{current.workflowTemplateKey.replace(/_/g, " ")}</h2>
            {meta.clientName && <p className="text-xs text-muted-foreground mt-0.5">Client: {meta.clientName}</p>}
            <p className="text-xs text-muted-foreground">Duration: {duration(current.startedAt, current.completedAt || current.failedAt || current.cancelledAt)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg ml-4">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Current step */}
          {current.currentStepKey && (
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Current step</p>
              <p className="text-sm font-medium">{current.currentStepKey}</p>
            </div>
          )}

          {/* Failure reason */}
          {current.failureReason && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Failure reason</p>
              <p className="text-sm">{current.failureReason}</p>
            </div>
          )}

          {/* Operator controls */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Controls</p>
            <div className="flex flex-wrap gap-2">
              {current.status === "waiting" && (
                <Button size="sm" variant="outline" onClick={() => act("resume", { note: "Manual resume" })} data-testid="btn-resume">
                  <Play className="w-3.5 h-3.5 mr-1" />Resume
                </Button>
              )}
              {current.status === "failed" && current.currentStepKey && (
                <Button size="sm" variant="outline" onClick={() => act("retry-step", { stepKey: current.currentStepKey })} data-testid="btn-retry">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />Retry Step
                </Button>
              )}
              {(current.status === "failed" || current.status === "waiting") && current.currentStepKey && (
                <Button size="sm" variant="outline" onClick={() => act("skip-step", { stepKey: current.currentStepKey })} data-testid="btn-skip">
                  <SkipForward className="w-3.5 h-3.5 mr-1" />Skip Step
                </Button>
              )}
              {!["completed","cancelled"].includes(current.status) && (
                <Button size="sm" variant="ghost" onClick={() => act("cancel", {})} data-testid="btn-cancel">
                  <XCircle className="w-3.5 h-3.5 mr-1" />Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Step timeline */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Execution Timeline</p>
            <div className="space-y-2">
              {steps.length === 0 ? (
                <p className="text-xs text-muted-foreground">No step history yet.</p>
              ) : (
                steps.map((s, i) => (
                  <div key={s.id} className="flex gap-3 items-start" data-testid={`step-${s.stepKey}`}>
                    <span className={`text-xs font-mono mt-0.5 w-3 flex-shrink-0 ${STEP_STATUS_STYLE[s.status] || ""}`}>{STEP_ICON[s.status] || "○"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium ${STEP_STATUS_STYLE[s.status] || ""}`}>{s.stepKey}</p>
                        <span className="text-xs text-muted-foreground capitalize">{s.stepType.replace(/_/g, " ")}</span>
                        {s.retryCount && s.retryCount > 0 && <span className="text-xs text-orange-600">retried ×{s.retryCount}</span>}
                      </div>
                      {s.status === "waiting" && s.output && (
                        <p className="text-xs text-amber-600 mt-0.5">Waiting: {(s.output as any).waitFor} {(s.output as any).waitUntil ? `until ${new Date((s.output as any).waitUntil).toLocaleDateString()}` : ""}</p>
                      )}
                      {s.errorMessage && <p className="text-xs text-red-600 mt-0.5">{s.errorMessage}</p>}
                      {s.completedAt && <p className="text-xs text-muted-foreground">{duration(s.startedAt, s.completedAt)} · {new Date(s.completedAt).toLocaleString()}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Related entities */}
          {(meta.operatorActionId || meta.retentionWorkflowId || meta.outreachDraftId) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Related Entities</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {meta.operatorActionId && <p>Operator Action: <span className="font-mono">{String(meta.operatorActionId).slice(0, 8)}…</span></p>}
                {meta.retentionWorkflowId && <p>Retention Workflow: <span className="font-mono">{String(meta.retentionWorkflowId).slice(0, 8)}…</span></p>}
                {meta.outreachDraftId && <p>Outreach Draft: <span className="font-mono">{String(meta.outreachDraftId).slice(0, 8)}…</span></p>}
              </div>
            </div>
          )}

          {/* Note input */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add Note</p>
            <Textarea placeholder="Log decision, context, or escalation reason…" value={note} onChange={e => setNote(e.target.value)} className="text-sm min-h-[60px]" data-testid="input-note" />
            <Button size="sm" variant="outline" disabled={!note.trim()} onClick={addNote} data-testid="btn-add-note">Add Note</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Run Card ──────────────────────────────────────────────────────────────────

function RunCard({ run, onSelect }: { run: WorkflowRun; onSelect: (r: WorkflowRun) => void }) {
  const meta = run.metadata || {};
  const isStale = run.status === "waiting" &&
    (new Date().getTime() - new Date(run.updatedAt).getTime()) > 48 * 3600000;

  return (
    <div
      className={`flex items-start gap-3 p-4 border-b hover:bg-muted/30 cursor-pointer transition-colors ${run.status === "failed" ? "border-l-2 border-l-red-400" : run.status === "waiting" ? "border-l-2 border-l-amber-400" : ""}`}
      onClick={() => onSelect(run)}
      data-testid={`run-card-${run.id}`}
    >
      <div className="flex-shrink-0 mt-1">
        {run.status === "running" && <Activity className="w-4 h-4 text-sky-500 animate-pulse" />}
        {run.status === "waiting" && <Pause className="w-4 h-4 text-amber-500" />}
        {run.status === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {run.status === "failed" && <XCircle className="w-4 h-4 text-red-500" />}
        {run.status === "cancelled" && <XCircle className="w-4 h-4 text-muted-foreground" />}
        {run.status === "pending" && <Clock className="w-4 h-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium capitalize">{run.workflowTemplateKey.replace(/_/g, " ")}</span>
          {meta.clientName && <span className="text-sm text-muted-foreground">· {meta.clientName}</span>}
          {isStale && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Stale</span>}
        </div>
        {run.currentStepKey && (
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <ArrowRight className="w-3 h-3" />{run.currentStepKey.replace(/_/g, " ")}
          </p>
        )}
        {run.failureReason && <p className="text-xs text-red-600 line-clamp-1 mb-1">{run.failureReason}</p>}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[run.status] || ""}`}>{run.status}</span>
          <span className="text-xs text-muted-foreground">{duration(run.startedAt, run.completedAt)}</span>
          <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
    </div>
  );
}

// ── Template Browser ──────────────────────────────────────────────────────────

function TemplateBrowser({ templates }: { templates: WorkflowTemplate[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
      {templates.map(tpl => (
        <div key={tpl.key} className="rounded-lg border p-3 bg-background" data-testid={`template-${tpl.key}`}>
          <p className="text-sm font-semibold mb-0.5">{tpl.name}</p>
          <p className="text-xs text-muted-foreground mb-2">{tpl.description}</p>
          <div className="space-y-1">
            {tpl.steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-4 h-4 rounded-full border flex items-center justify-center text-xs font-mono flex-shrink-0">{i + 1}</span>
                <span className="capitalize">{s.label || s.type.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminWorkflowOrchestratorPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WorkflowRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<"runs" | "templates">("runs");

  const buildParams = () => {
    const p = new URLSearchParams();
    if (tab !== "all") p.set("status", tab);
    return p;
  };

  const { data: runs, isLoading, refetch, isFetching } = useQuery<WorkflowRun[]>({
    queryKey: ["/api/admin/workflow-runs", tab],
    queryFn: async () => {
      const r = await fetch(`/api/admin/workflow-runs?${buildParams()}`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: tab === "running" || tab === "waiting" ? 10000 : false,
  });

  const { data: templates = [] } = useQuery<WorkflowTemplate[]>({
    queryKey: ["/api/admin/workflow-templates"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/workflow-runs"] });
  };

  const filtered = (runs || []).filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const meta = r.metadata || {};
    return r.workflowTemplateKey.includes(q) ||
      (meta.clientName || "").toLowerCase().includes(q) ||
      r.status.includes(q);
  });

  // Summary counts
  const counts = {
    running: (runs || []).filter(r => r.status === "running").length,
    waiting: (runs || []).filter(r => r.status === "waiting").length,
    failed: (runs || []).filter(r => r.status === "failed").length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between flex-wrap gap-4 max-w-6xl mx-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold" data-testid="page-title-orchestrator">Workflow Orchestrator</h1>
            </div>
            <p className="text-sm text-muted-foreground">Multi-step operational workflows with approval gates, escalation, and audit trails.</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Summary chips */}
            {counts.running > 0 && <span className="text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded font-medium">{counts.running} running</span>}
            {counts.waiting > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-medium">{counts.waiting} waiting</span>}
            {counts.failed > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-medium">{counts.failed} failed</span>}
            <Button variant="outline" size="sm" onClick={() => setView(v => v === "runs" ? "templates" : "runs")} data-testid="button-toggle-view">
              <Sparkles className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setStarting(true)} className="gap-1.5" data-testid="button-start-workflow">
              <Plus className="w-3.5 h-3.5" /> Start Workflow
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs + filters */}
      <div className="border-b bg-background px-6 py-2 flex items-center gap-4 flex-wrap max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setView("runs"); }}
              className={`px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors ${tab === t.key && view === "runs" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid={`tab-${t.key}`}
            >{t.label}</button>
          ))}
          <button onClick={() => setView("templates")}
            className={`px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors ${view === "templates" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            data-testid="tab-templates"
          >Templates</button>
        </div>
        {view === "runs" && (
          <div className="flex items-center gap-2 ml-auto">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="h-7 w-40 text-xs" data-testid="input-search" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto max-w-6xl mx-auto w-full">
        {view === "templates" ? (
          <TemplateBrowser templates={templates} />
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading workflow runs…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No workflow runs match the current filter.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setStarting(true)}>Start your first workflow</Button>
          </div>
        ) : (
          filtered.map(r => <RunCard key={r.id} run={r} onSelect={setSelected} />)
        )}
      </div>

      {/* Safety notice */}
      <div className="border-t px-6 py-2 bg-muted/20">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-6xl mx-auto">
          <Shield className="w-3 h-3 flex-shrink-0" />
          The orchestration engine never auto-sends outreach, auto-pays coaches, auto-closes accounting periods, or bypasses approval gates. All high-risk steps create pending human work items.
        </p>
      </div>

      {selected && (
        <RunDetail run={selected} onClose={() => setSelected(null)} onUpdate={() => { invalidate(); setSelected(null); }} />
      )}
      <StartDialog templates={templates} open={starting} onClose={() => setStarting(false)} onStarted={invalidate} />
    </div>
  );
}
