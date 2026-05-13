import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  GitBranch, Play, CheckCircle, Clock, XCircle, AlertTriangle,
  ChevronRight, RefreshCw, Zap, BarChart3, Layers, Eye,
  ArrowRight, SkipForward, Timer, MessageSquare, Send, X, Plus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkflowStatus = "pending" | "running" | "waiting_confirmation" | "waiting_response" | "completed" | "failed" | "cancelled";

type WorkflowRun = {
  id: string;
  orgId: string;
  workflowType: string;
  displayName: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  totalSteps: number;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  triggerReason?: string;
  triggerSource?: string;
  context?: Record<string, any>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  nextCheckAt?: string;
  createdAt: string;
};

type WorkflowStepRecord = {
  id: string;
  stepIndex: number;
  stepName: string;
  stepType: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
  toolCallId?: string;
  retryCount?: number;
  confirmationStatus?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

type WorkflowDef = {
  type: string;
  displayName: string;
  description: string;
  category: string;
  estimatedDays: number;
  triggerEvent: string;
  totalSteps: number;
};

type WorkflowStats = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  completionRate: number;
  byType: Record<string, number>;
};

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusBadge(status: WorkflowStatus) {
  const map: Record<WorkflowStatus, { label: string; className: string }> = {
    pending:              { label: "Pending",       className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    running:              { label: "Running",       className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse" },
    waiting_confirmation: { label: "Needs Approval",className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
    waiting_response:     { label: "Waiting",       className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
    completed:            { label: "Completed",     className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    failed:               { label: "Failed",        className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
    cancelled:            { label: "Cancelled",     className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 line-through" },
  };
  const { label, className } = map[status] ?? { label: status, className: "" };
  return <Badge className={`text-[11px] px-2 py-0.5 font-medium border-0 ${className}`}>{label}</Badge>;
}

function stepStatusIcon(status: string) {
  switch (status) {
    case "completed":            return <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
    case "running":              return <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0" />;
    case "waiting_confirmation": return <Clock className="h-4 w-4 text-orange-500 shrink-0" />;
    case "waiting_response":     return <Timer className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "failed":               return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "skipped":              return <SkipForward className="h-4 w-4 text-gray-400 shrink-0" />;
    default:                     return <div className="h-4 w-4 rounded-full border-2 border-border shrink-0 bg-muted" />;
  }
}

function stepTypePill(type: string) {
  const map: Record<string, { label: string; icon: any; color: string }> = {
    tool_call:          { label: "Tool Call",    icon: Zap,          color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40" },
    wait_confirmation:  { label: "Gate",         icon: Clock,        color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40" },
    wait_time:          { label: "Wait",         icon: Timer,        color: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40" },
    check_response:     { label: "Check",        icon: Eye,          color: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40" },
    branch:             { label: "Branch",       icon: GitBranch,    color: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40" },
    complete:           { label: "Complete",     icon: CheckCircle,  color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40" },
    notify:             { label: "Notify",       icon: MessageSquare,color: "text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40" },
  };
  const { label, icon: Icon, color } = map[type] ?? { label: type, icon: Zap, color: "bg-muted" };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${color}`}>
      <Icon className="h-2.5 w-2.5" /> {label}
    </span>
  );
}

function categoryColor(cat: string) {
  return {
    sales:      "text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300",
    retention:  "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
    scheduling: "text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300",
    operations: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300",
    finance:    "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300",
  }[cat] ?? "bg-muted text-muted-foreground";
}

// ─── Trigger Workflow Modal ───────────────────────────────────────────────────

function TriggerModal({ defs, onClose }: { defs: WorkflowDef[]; onClose: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState("");
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [reason, setReason] = useState("");

  const trigger = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/workflows/trigger", {
      workflowType: type, entityName: entityName || undefined, entityType: entityType || undefined,
      entityId: entityId || undefined, triggerReason: reason || undefined, triggerSource: "manual",
    }).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Workflow started", description: `Run ID: ${data.runId?.slice(0, 8)}…` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/stats"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Failed to start workflow", description: e.message, variant: "destructive" }),
  });

  const def = defs.find(d => d.type === type);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4 text-primary" /> Trigger Workflow
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Workflow Type</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-workflow-type">
                <SelectValue placeholder="Choose a workflow…" />
              </SelectTrigger>
              <SelectContent>
                {defs.map(d => (
                  <SelectItem key={d.type} value={d.type} data-testid={`option-workflow-${d.type}`}>
                    {d.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {def && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p>{def.description}</p>
              <p className="font-medium text-foreground">{def.totalSteps} steps · ~{def.estimatedDays} days</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entity Name <span className="text-muted-foreground">(optional)</span></label>
              <Input placeholder="e.g. Lincoln High School" value={entityName} onChange={e => setEntityName(e.target.value)} data-testid="input-entity-name" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entity Type</label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger data-testid="select-entity-type">
                  <SelectValue placeholder="Type…" />
                </SelectTrigger>
                <SelectContent>
                  {["deal","lead","client","session","prospect"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Trigger Reason <span className="text-muted-foreground">(optional)</span></label>
            <Textarea placeholder="Why is this workflow being triggered?" value={reason} onChange={e => setReason(e.target.value)} className="h-20 resize-none" data-testid="textarea-trigger-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => trigger.mutate()} disabled={!type || trigger.isPending} data-testid="button-start-workflow">
            {trigger.isPending ? <><span className="animate-spin mr-1.5 inline-block">⟳</span> Starting…</> : <><Play className="h-3.5 w-3.5 mr-1.5" /> Start Workflow</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workflow Timeline Panel ──────────────────────────────────────────────────

function WorkflowTimeline({ run, onClose }: { run: WorkflowRun; onClose: () => void }) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ run: WorkflowRun; steps: WorkflowStepRecord[] }>({
    queryKey: ["/api/admin/workflows", run.id],
    refetchInterval: ["running", "waiting_confirmation", "waiting_response"].includes(run.status) ? 3000 : false,
  });

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/workflows/${run.id}/approve`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Step approved", description: "Workflow is resuming." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", run.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/workflows/${run.id}/reject`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Step rejected", description: "Workflow cancelled." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", run.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      onClose();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/workflows/${run.id}/cancel`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Workflow cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      onClose();
    },
  });

  const liveRun = data?.run ?? run;
  const steps = data?.steps ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" /> {liveRun.displayName}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {liveRun.workflowType} · ID {liveRun.id.slice(0, 8)}…
                {liveRun.entityName && <> · <span className="font-medium text-foreground">{liveRun.entityName}</span></>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusBadge(liveRun.status)}
              {["running", "waiting_confirmation", "waiting_response"].includes(liveRun.status) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                  onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Progress bar */}
        <div className="px-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Step {liveRun.currentStepIndex + 1} of {liveRun.totalSteps}</span>
            <span>{Math.round(((liveRun.currentStepIndex) / Math.max(liveRun.totalSteps - 1, 1)) * 100)}% complete</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${liveRun.status === "completed" ? "bg-emerald-500" : liveRun.status === "failed" || liveRun.status === "cancelled" ? "bg-red-500" : "bg-primary"}`}
              style={{ width: `${liveRun.status === "completed" ? 100 : Math.round(((liveRun.currentStepIndex) / Math.max(liveRun.totalSteps - 1, 1)) * 100)}%` }}
            />
          </div>
        </div>

        {/* Trigger info */}
        {liveRun.triggerReason && (
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Trigger:</span> {liveRun.triggerReason}
          </div>
        )}

        {/* Approval gate */}
        {liveRun.status === "waiting_confirmation" && (
          <div className="rounded-xl border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20 p-4 space-y-3" data-testid="panel-approval-gate">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500 shrink-0" />
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">Human Approval Required</p>
            </div>
            {(() => {
              const currentStep = steps.find(s => s.stepIndex === liveRun.currentStepIndex);
              const output = currentStep?.output as any;
              return (
                <>
                  {output?.prompt && <p className="text-xs text-muted-foreground">{output.prompt}</p>}
                  {output?.subject && (
                    <div className="rounded-lg bg-white dark:bg-black/20 border border-border p-3 space-y-1 text-xs">
                      <p className="font-medium">Subject: {output.subject}</p>
                      <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{output.body ?? output.smsBody}</p>
                    </div>
                  )}
                </>
              );
            })()}
            <div className="flex gap-2">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}
                data-testid="button-approve-step">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> {approveMutation.isPending ? "Approving…" : "Approve & Continue"}
              </Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-300"
                onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}
                data-testid="button-reject-step">
                <X className="h-3.5 w-3.5 mr-1.5" /> Reject
              </Button>
            </div>
          </div>
        )}

        {/* Wait state */}
        {liveRun.status === "waiting_response" && (
          <div className="rounded-xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 flex items-center gap-3" data-testid="panel-waiting">
            <Timer className="h-4 w-4 text-yellow-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Waiting for response</p>
              {liveRun.nextCheckAt && (
                <p className="text-xs text-muted-foreground">
                  Resumes {new Date(liveRun.nextCheckAt).toLocaleDateString()} at {new Date(liveRun.nextCheckAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {liveRun.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {liveRun.error}
          </div>
        )}

        {/* Timeline */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : (
          <div className="space-y-1" data-testid="workflow-timeline">
            {steps.map((step, idx) => {
              const isActive = step.stepIndex === liveRun.currentStepIndex;
              const output = step.output as any;
              return (
                <div
                  key={step.id}
                  className={`rounded-lg border px-3 py-2.5 transition-colors ${
                    isActive && liveRun.status !== "completed"
                      ? "border-primary/50 bg-primary/5"
                      : step.status === "completed"
                      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10"
                      : step.status === "failed"
                      ? "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                      : step.status === "skipped"
                      ? "border-dashed opacity-50"
                      : "border-border bg-muted/20"
                  }`}
                  data-testid={`step-${step.stepIndex}`}
                >
                  <div className="flex items-center gap-2">
                    {stepStatusIcon(step.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono text-muted-foreground w-4">{step.stepIndex + 1}.</span>
                        <span className="text-sm font-medium leading-snug">{step.stepName}</span>
                        {stepTypePill(step.stepType)}
                        {step.retryCount && step.retryCount > 0 && (
                          <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-0 px-1">↺ {step.retryCount}</Badge>
                        )}
                      </div>
                      {step.error && (
                        <p className="text-[11px] text-red-500 mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {step.error}
                        </p>
                      )}
                      {output?.waitDays && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Waiting {output.waitDays} days · resumes {output.resumeAt ? new Date(output.resumeAt).toLocaleDateString() : "soon"}
                        </p>
                      )}
                      {output?.subject && step.status === "completed" && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Draft: "{output.subject}"
                        </p>
                      )}
                      {output?.hasResponse !== undefined && (
                        <p className={`text-[11px] mt-0.5 ${output.hasResponse ? "text-emerald-600" : "text-muted-foreground"}`}>
                          Response: {output.hasResponse ? "✓ Detected" : "✗ None detected"}
                        </p>
                      )}
                      {output?.targetIndex !== undefined && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Branched → step {output.targetIndex + 1} ({output.result ? "condition met" : "condition not met"})
                        </p>
                      )}
                    </div>
                    {step.completedAt && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(step.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Attribution */}
        {(liveRun as any).sourceRecommendationId || (liveRun as any).sourceRevenueActionId ? (
          <div className="text-[11px] text-muted-foreground border-t border-border/50 pt-2 flex items-center gap-2">
            <GitBranch className="h-3 w-3" />
            <span>Triggered by {(liveRun as any).sourceRecommendationId ? "Brain Recommendation" : "Revenue Agent Action"}</span>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: WorkflowStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="workflow-stats">
      {[
        { label: "Total Runs",    value: stats.total,          color: "text-foreground" },
        { label: "Completed",     value: stats.completed,      color: "text-emerald-600 dark:text-emerald-400" },
        { label: "Active",        value: stats.running,        color: "text-blue-600 dark:text-blue-400" },
        { label: "Completion %",  value: `${stats.completionRate}%`, color: "text-primary" },
      ].map(({ label, value, color }) => (
        <Card key={label} className="p-3 text-center">
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </Card>
      ))}
    </div>
  );
}

// ─── Workflow Definitions Grid ────────────────────────────────────────────────

function DefinitionsGrid({ defs, onTrigger }: { defs: WorkflowDef[]; onTrigger: (type: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="workflow-definitions">
      {defs.map(d => (
        <Card key={d.type} className="p-4 hover:border-primary/30 transition-colors" data-testid={`card-workflow-def-${d.type}`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-semibold leading-snug">{d.displayName}</p>
            <Badge className={`text-[10px] px-1.5 py-0 border-0 shrink-0 ${categoryColor(d.category)}`}>{d.category}</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{d.description}</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{d.totalSteps} steps · ~{d.estimatedDays}d</span>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => onTrigger(d.type)}
              data-testid={`button-trigger-${d.type}`}>
              <Play className="h-3 w-3 mr-1" /> Trigger
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Runs Table ───────────────────────────────────────────────────────────────

function RunsTable({ runs, onView }: { runs: WorkflowRun[]; onView: (run: WorkflowRun) => void }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground" data-testid="runs-empty">
        <Layers className="h-8 w-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No workflow runs yet.</p>
        <p className="text-xs mt-1">Trigger a workflow above to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="workflow-runs-list">
      {runs.map(run => (
        <Card
          key={run.id}
          className="p-3 flex items-center gap-3 hover:border-primary/30 transition-colors cursor-pointer"
          onClick={() => onView(run)}
          data-testid={`row-workflow-run-${run.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              {statusBadge(run.status)}
              <span className="text-sm font-medium">{run.displayName}</span>
              {run.entityName && (
                <span className="text-xs text-muted-foreground">→ {run.entityName}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span>Step {run.currentStepIndex + 1}/{run.totalSteps}</span>
              {run.triggerSource && <span>via {run.triggerSource}</span>}
              <span>{new Date(run.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Mini progress */}
          <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${run.status === "completed" ? "bg-emerald-500" : run.status === "failed" || run.status === "cancelled" ? "bg-red-400" : "bg-primary"}`}
                style={{ width: `${run.status === "completed" ? 100 : Math.round((run.currentStepIndex / Math.max(run.totalSteps - 1, 1)) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {run.status === "completed" ? "100%" : `${Math.round((run.currentStepIndex / Math.max(run.totalSteps - 1, 1)) * 100)}%`}
            </span>
          </div>

          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type PageTab = "runs" | "definitions";

export default function AdminWorkflowsPage() {
  const [tab, setTab] = useState<PageTab>("runs");
  const [showTrigger, setShowTrigger] = useState(false);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [triggerDefaultType, setTriggerDefaultType] = useState("");

  const { data: runs = [], isLoading: runsLoading } = useQuery<WorkflowRun[]>({
    queryKey: ["/api/admin/workflows"],
    refetchInterval: 8000,
  });

  const { data: defs = [] } = useQuery<WorkflowDef[]>({
    queryKey: ["/api/admin/workflows/definitions"],
    staleTime: Infinity,
  });

  const { data: stats } = useQuery<WorkflowStats>({
    queryKey: ["/api/admin/workflows/stats"],
    refetchInterval: 15000,
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/workflows/resume-waiting").then(r => r.json()),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
    },
  });

  function handleTriggerFromDef(type: string) {
    setTriggerDefaultType(type);
    setShowTrigger(true);
  }

  const pendingApprovals = runs.filter(r => r.status === "waiting_confirmation").length;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-workflows">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" /> Workflow Orchestration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-step agent workflows with confirmation gates, wait states, and conditional branching.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}
            data-testid="button-resume-waiting">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${resumeMutation.isPending ? "animate-spin" : ""}`} /> Resume Waiting
          </Button>
          <Button size="sm" onClick={() => { setTriggerDefaultType(""); setShowTrigger(true); }}
            data-testid="button-trigger-workflow">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Workflow
          </Button>
        </div>
      </div>

      {/* Approval alert */}
      {pendingApprovals > 0 && (
        <div className="rounded-xl border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20 p-3 flex items-center gap-3"
          data-testid="alert-pending-approvals">
          <Clock className="h-5 w-5 text-orange-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
              {pendingApprovals} workflow{pendingApprovals > 1 ? "s" : ""} waiting for approval
            </p>
            <p className="text-xs text-muted-foreground">Click any run below to review and approve.</p>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && <StatsBar stats={stats} />}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([["runs", "All Runs"], ["definitions", "Workflow Types"]] as const).map(([id, label]) => (
          <button
            key={id}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab(id)}
            data-testid={`tab-${id}`}
          >
            {label}
            {id === "runs" && runs.length > 0 && (
              <Badge className="ml-1.5 text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-0">{runs.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "runs" && (
        runsLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
        ) : (
          <RunsTable runs={runs} onView={setSelectedRun} />
        )
      )}

      {tab === "definitions" && (
        <DefinitionsGrid defs={defs} onTrigger={handleTriggerFromDef} />
      )}

      {/* Modals */}
      {showTrigger && (
        <TriggerModal
          defs={triggerDefaultType ? defs.map(d => d.type === triggerDefaultType ? { ...d } : d) : defs}
          onClose={() => setShowTrigger(false)}
        />
      )}

      {selectedRun && (
        <WorkflowTimeline run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
}
