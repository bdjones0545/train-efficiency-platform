import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield, Zap, Eye, CheckCircle, XCircle, Clock, AlertTriangle,
  TrendingUp, BarChart3, Brain, DollarSign, Settings, Pause,
  ChevronRight, ArrowRight, RefreshCw, Loader2, Star, Activity,
  Lock, Unlock, CircleDot, Play, RotateCcw, Award, Target,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<string, { label: string; color: string; icon: typeof Eye; badge: string }> = {
  observe:   { label: "Observe Only",       color: "text-slate-500",   icon: Eye,          badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  recommend: { label: "Recommend",           color: "text-blue-500",    icon: Brain,        badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  queue:     { label: "Recommend + Queue",   color: "text-amber-500",   icon: Clock,        badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  execute:   { label: "Auto Execute",        color: "text-green-500",   icon: Zap,          badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
};

const RISK_CONFIG: Record<string, { color: string; badge: string; ceiling: number }> = {
  low:      { color: "text-green-600",  badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",   ceiling: 100 },
  medium:   { color: "text-amber-600",  badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",   ceiling: 75  },
  high:     { color: "text-red-600",    badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",           ceiling: 50  },
  critical: { color: "text-purple-600", badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300", ceiling: 25 },
};

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: typeof Clock }> = {
  pending:  { label: "Pending",  badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", icon: Clock },
  approved: { label: "Approved", badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",         icon: CheckCircle },
  executed: { label: "Executed", badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",     icon: Zap },
  rejected: { label: "Rejected", badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",             icon: XCircle },
  failed:   { label: "Failed",   badge: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",         icon: AlertTriangle },
};

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 76 ? "bg-green-600" : score >= 51 ? "bg-amber-600" : score >= 26 ? "bg-blue-600" : "bg-slate-500";
  return <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-white text-sm font-bold ${color}`}>{score}</span>;
}

function ModeBadge({ mode, ceoPaused }: { mode: string; ceoPaused?: boolean }) {
  const cfg = MODE_CONFIG[mode] ?? MODE_CONFIG.observe;
  const Icon = cfg.icon;
  return (
    <Badge className={`text-xs gap-1 ${cfg.badge} border-0`}>
      <Icon className="w-3 h-3" />
      {ceoPaused ? "Paused" : cfg.label}
    </Badge>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: dash, isLoading: dashLoading } = useQuery<any>({ queryKey: ["/api/autonomy-trust/dashboard"] });
  const { data: flywheel, isLoading: fwLoading } = useQuery<any>({ queryKey: ["/api/autonomy-trust/flywheel"] });

  const pauseAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/autonomy-trust/pause-all", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); toast({ title: "All auto-execute decisions paused" }); },
  });

  const bulkApprove = useMutation({
    mutationFn: () => apiRequest("POST", "/api/autonomy-trust/queue/bulk-approve", { maxRisk: "low" }),
    onSuccess: async (res) => {
      const d = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] });
      toast({ title: `Approved ${d.approved} low-risk actions` });
    },
  });

  if (dashLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  const d = dash ?? {};
  const fw = flywheel ?? {};

  const metrics = [
    { label: "Autonomous Actions Today",  value: d.todayExecuted ?? 0,           icon: Zap,          color: "text-green-600" },
    { label: "Pending Approvals",          value: d.pendingApprovalCount ?? 0,     icon: Clock,        color: "text-amber-600" },
    { label: "Hours Saved",               value: `${d.hoursSaved ?? 0}h`,         icon: Award,        color: "text-blue-600" },
    { label: "Revenue Influenced",        value: `$${Math.round((d.revenueInfluenced ?? 0) / 100).toLocaleString()}`, icon: DollarSign, color: "text-emerald-600" },
    { label: "Trust Score Average",       value: `${d.avgTrustScore ?? 0}/100`,   icon: Star,         color: "text-purple-600" },
    { label: "High Risk Pending",         value: d.highRiskPending ?? 0,          icon: AlertTriangle, color: "text-red-600" },
  ];

  const flywheelStages = [
    { label: "Memory Created",   value: fw.memoryCreated ?? 0,    unit: "notes",    icon: Brain },
    { label: "Better Decisions", value: `${fw.betterDecisions ?? 0}/100`, unit: "avg score", icon: Target },
    { label: "Better Outcomes",  value: fw.betterOutcomes ?? 0,   unit: "wins",     icon: CheckCircle },
    { label: "Higher Trust",     value: `${fw.higherTrust ?? 0}/100`, unit: "trust",  icon: Shield },
    { label: "More Autonomy",    value: fw.moreAutonomy ?? 0,     unit: "auto types", icon: Zap },
    { label: "More Execution",   value: fw.moreExecution ?? 0,    unit: "executed", icon: Play },
    { label: "More Data",        value: fw.moreData ?? 0,         unit: "decisions", icon: BarChart3 },
    { label: "Revenue",          value: `$${(fw.revenueGenerated ?? 0).toLocaleString()}`, unit: "", icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      {/* Readiness score */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Autonomy Readiness</CardTitle>
              <CardDescription>Overall platform readiness to operate autonomously</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => bulkApprove.mutate()} disabled={bulkApprove.isPending} data-testid="button-approve-low-risk">
                {bulkApprove.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />} Approve All Low Risk
              </Button>
              <Button size="sm" variant="destructive" onClick={() => pauseAll.mutate()} disabled={pauseAll.isPending} data-testid="button-pause-autonomy">
                {pauseAll.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Pause className="w-3 h-3 mr-1" />} Pause Autonomy
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="flex items-end justify-between mb-2">
              <span className="text-sm text-muted-foreground">Readiness Score</span>
              <span className="text-4xl font-bold text-primary">{d.readinessScore ?? 0}<span className="text-lg text-muted-foreground">/100</span></span>
            </div>
            <Progress value={d.readinessScore ?? 0} className="h-4" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>System of Record</span><span>System of Recommendation</span><span>System of Trust</span><span>Autonomous Execution</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="text-center p-3 border rounded-lg">
                <m.icon className={`w-5 h-5 mx-auto mb-1 ${m.color}`} />
                <div className="text-xl font-bold">{m.value}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">{m.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trust flywheel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><RotateCcw className="w-4 h-4 text-primary" /> Organizational Trust Flywheel</CardTitle>
          <CardDescription>The self-reinforcing loop from memory to autonomous execution</CardDescription>
        </CardHeader>
        <CardContent>
          {fwLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {flywheelStages.map((stage, idx) => (
                <div key={stage.label} className="flex items-center gap-1">
                  <div className="text-center px-3 py-2 border-2 border-dashed rounded-xl min-w-[80px]">
                    <stage.icon className="w-4 h-4 mx-auto mb-1 text-primary" />
                    <div className="text-sm font-bold">{stage.value}</div>
                    <div className="text-[9px] text-muted-foreground leading-tight">{stage.label}</div>
                  </div>
                  {idx < flywheelStages.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>
              ))}
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <div className="text-xs text-primary font-medium px-2">↩ Better Decisions</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Autonomy evolution ladder */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Platform Evolution Path</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: "System of Record",        active: true,  done: true  },
              { label: "System of Recommendation", active: true,  done: true  },
              { label: "System of Learning",       active: true,  done: true  },
              { label: "System of Trust",          active: true,  done: false },
              { label: "System of Autonomous Execution", active: false, done: false },
            ].map((step, idx) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 ${
                  step.done ? "border-green-500 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300" :
                  step.active ? "border-primary bg-primary/10 text-primary" :
                  "border-muted bg-muted/30 text-muted-foreground"
                }`}>
                  {step.done ? <CheckCircle className="w-3 h-3" /> : step.active ? <CircleDot className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  {step.label}
                </div>
                {idx < 4 && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Trust Registry Tab ───────────────────────────────────────────────────────
function TrustRegistryTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: registry, isLoading } = useQuery<any[]>({ queryKey: ["/api/autonomy-trust/registry"] });
  const [editRow, setEditRow] = useState<any | null>(null);

  const updateMode = useMutation({
    mutationFn: ({ decisionType, ceoOverrideMode }: any) =>
      apiRequest("PATCH", `/api/autonomy-trust/registry/${decisionType}`, { ceoOverrideMode }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); setEditRow(null); toast({ title: "Mode updated" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Decision Trust Registry</h3>
          <p className="text-sm text-muted-foreground">Every decision category with its autonomy score and execution mode. CEO can override any category.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {registry?.map((row: any) => {
            const effectiveMode = row.ceo_override_mode ?? row.recommended_mode;
            const ceoPaused = row.ceo_override_mode === "observe" && row.recommended_mode === "execute";
            const riskCfg = RISK_CONFIG[row.risk_level] ?? RISK_CONFIG.medium;
            const overrideRate = (row.human_approvals + row.human_overrides) > 0
              ? Math.round((row.human_overrides / (row.human_approvals + row.human_overrides)) * 100)
              : 0;

            return (
              <Card key={row.id} className="border" data-testid={`card-registry-${row.decision_type}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <ScoreBadge score={row.autonomy_score} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-sm">{row.label}</span>
                        <Badge className={`text-xs border-0 ${riskCfg.badge}`}>{row.risk_level} risk</Badge>
                        <ModeBadge mode={effectiveMode} ceoPaused={ceoPaused} />
                        {row.ceo_override_mode && <Badge variant="outline" className="text-xs">CEO Override</Badge>}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs mt-2">
                        <div>
                          <div className="text-muted-foreground">Success Rate</div>
                          <div className="font-medium">{row.success_rate}%</div>
                          <Progress value={row.success_rate} className="h-1 mt-1" />
                        </div>
                        <div>
                          <div className="text-muted-foreground">Executions</div>
                          <div className="font-medium">{row.executions?.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Override Rate</div>
                          <div className={`font-medium ${overrideRate > 30 ? "text-red-600" : "text-green-600"}`}>{overrideRate}%</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Revenue</div>
                          <div className="font-medium">${Math.round((row.revenue_influenced ?? 0) / 100).toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Score Ceiling</div>
                          <div className="font-medium">{riskCfg.ceiling}/100</div>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEditRow(row)} data-testid={`button-edit-${row.decision_type}`}>
                      <Settings className="w-3 h-3 mr-1" /> Override
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Override dialog */}
      {editRow && (
        <Dialog open onOpenChange={() => setEditRow(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Override Mode — {editRow.label}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="bg-muted/50 rounded p-3 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-muted-foreground">Autonomy Score</span>
                  <span className="font-bold">{editRow.autonomy_score}/100</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-muted-foreground">Recommended Mode</span>
                  <ModeBadge mode={editRow.recommended_mode} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk Level</span>
                  <Badge className={`text-xs border-0 ${(RISK_CONFIG[editRow.risk_level] ?? RISK_CONFIG.medium).badge}`}>{editRow.risk_level}</Badge>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-2 block">CEO Override Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  {["observe", "recommend", "queue", "execute"].map((m) => {
                    const cfg = MODE_CONFIG[m];
                    const Icon = cfg.icon;
                    const isCurrent = (editRow.ceo_override_mode ?? editRow.recommended_mode) === m;
                    const maxScore = RISK_CONFIG[editRow.risk_level]?.ceiling ?? 100;
                    const disabled = m === "execute" && maxScore < 76;
                    return (
                      <button
                        key={m}
                        disabled={disabled}
                        onClick={() => updateMode.mutate({ decisionType: editRow.decision_type, ceoOverrideMode: m })}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 text-sm transition-all ${
                          isCurrent ? "border-primary bg-primary/10" :
                          disabled ? "border-muted opacity-40 cursor-not-allowed" :
                          "border-muted hover:border-primary/50"
                        }`}
                        data-testid={`button-mode-${m}`}
                      >
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                        <div className="text-left">
                          <div className="font-medium">{cfg.label}</div>
                          {disabled && <div className="text-[10px] text-muted-foreground">Risk ceiling exceeded</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button variant="ghost" className="w-full text-xs" onClick={() => updateMode.mutate({ decisionType: editRow.decision_type, ceoOverrideMode: null })}>
                Clear Override (restore recommended)
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Action Queue Tab ─────────────────────────────────────────────────────────
function QueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: queue, isLoading } = useQuery<any[]>({ queryKey: ["/api/autonomy-trust/queue", statusFilter] });
  const [rejectDialog, setRejectDialog] = useState<{ id: string; action: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [queueForm, setQueueForm] = useState({ decisionType: "follow_up_lead", agentType: "revenue_agent", action: "", description: "" });
  const [showQueueForm, setShowQueueForm] = useState(false);

  const approve = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/autonomy-trust/queue/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); toast({ title: "Action approved" }); },
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/autonomy-trust/queue/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); setRejectDialog(null); setRejectReason(""); toast({ title: "Action rejected" }); },
  });

  const execute = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/autonomy-trust/queue/${id}/execute`, { outcome: "Executed manually by CEO" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); toast({ title: "Action executed" }); },
  });

  const addToQueue = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/autonomy-trust/queue", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autonomy-trust"] }); setShowQueueForm(false); setQueueForm({ decisionType: "follow_up_lead", agentType: "revenue_agent", action: "", description: "" }); toast({ title: "Action queued" }); },
  });

  const statuses = ["all", "pending", "approved", "executed", "rejected"];
  const filteredQueue = statusFilter === "all" ? queue : queue?.filter((r: any) => r.status === statusFilter);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {statuses.map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} data-testid={`button-filter-${s}`} className="capitalize">
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowQueueForm(!showQueueForm)} data-testid="button-add-action">+ Add Action</Button>
      </div>

      {/* Add to queue form */}
      {showQueueForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Decision Type</label>
                <Input value={queueForm.decisionType} onChange={(e) => setQueueForm((f) => ({ ...f, decisionType: e.target.value }))} placeholder="e.g. follow_up_lead" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Agent</label>
                <Input value={queueForm.agentType} onChange={(e) => setQueueForm((f) => ({ ...f, agentType: e.target.value }))} placeholder="e.g. revenue_agent" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Action</label>
              <Input value={queueForm.action} onChange={(e) => setQueueForm((f) => ({ ...f, action: e.target.value }))} placeholder="What should be done?" data-testid="input-queue-action" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description</label>
              <Textarea value={queueForm.description} onChange={(e) => setQueueForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Why?" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => addToQueue.mutate(queueForm)} disabled={addToQueue.isPending || !queueForm.action} data-testid="button-submit-queue">
                {addToQueue.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Queue Action
              </Button>
              <Button variant="outline" onClick={() => setShowQueueForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !filteredQueue?.length ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No actions in the queue. Actions are added automatically as agents make recommendations, or manually above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredQueue?.map((row: any) => {
            const statusCfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.pending;
            const riskCfg = RISK_CONFIG[row.risk_level] ?? RISK_CONFIG.medium;
            const StatusIcon = statusCfg.icon;
            return (
              <Card key={row.id} className="border" data-testid={`card-queue-${row.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-center shrink-0">
                      <ScoreBadge score={row.autonomy_score} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={`text-xs border-0 ${statusCfg.badge} gap-1`}>
                          <StatusIcon className="w-3 h-3" /> {statusCfg.label}
                        </Badge>
                        <Badge className={`text-xs border-0 ${riskCfg.badge}`}>{row.risk_level} risk</Badge>
                        <Badge variant="outline" className="text-xs">{row.agent_type}</Badge>
                        <Badge variant="outline" className="text-xs">{row.decision_type}</Badge>
                      </div>
                      <p className="text-sm font-medium">{row.action}</p>
                      {row.description && <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>}
                      {row.outcome && <p className="text-xs text-muted-foreground mt-1 italic">Outcome: {row.outcome}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{new Date(row.created_at).toLocaleString()}</p>
                    </div>
                    {row.status === "pending" && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approve.mutate(row.id)} disabled={approve.isPending} data-testid={`button-approve-${row.id}`}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setRejectDialog({ id: row.id, action: row.action })} data-testid={`button-reject-${row.id}`}>
                          <XCircle className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    {row.status === "approved" && (
                      <Button size="sm" onClick={() => execute.mutate(row.id)} disabled={execute.isPending} data-testid={`button-execute-${row.id}`}>
                        <Zap className="w-3 h-3 mr-1" /> Execute
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject dialog */}
      {rejectDialog && (
        <Dialog open onOpenChange={() => setRejectDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reject Action</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="bg-muted/50 rounded p-2 text-sm">{rejectDialog.action}</div>
              <div>
                <label className="text-xs font-medium mb-1 block">Reason (used for override learning)</label>
                <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Why is this being rejected?" data-testid="textarea-reject-reason" />
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" className="flex-1" onClick={() => reject.mutate({ id: rejectDialog.id, reason: rejectReason })} disabled={reject.isPending} data-testid="button-confirm-reject">
                  {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Reject & Learn
                </Button>
                <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Overrides Tab ────────────────────────────────────────────────────────────
function OverridesTab() {
  const { data: overrides, isLoading } = useQuery<any[]>({ queryKey: ["/api/autonomy-trust/overrides"] });

  const overrideTypeColor: Record<string, string> = {
    approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    modified: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Override Learning Log</h3>
        <p className="text-sm text-muted-foreground">Every human decision recorded as training context for future recommendations</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !overrides?.length ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Brain className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No overrides recorded yet. Approve or reject queue items to build the learning database.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {overrides.map((o: any) => (
            <Card key={o.id} className="border" data-testid={`card-override-${o.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Badge className={`text-xs border-0 ${overrideTypeColor[o.override_type] ?? ""} shrink-0 capitalize`}>{o.override_type}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{o.decision_type}</Badge>
                      {o.success_score != null && (
                        <Badge className={`text-xs ${o.success_score >= 70 ? "bg-green-600" : "bg-red-600"} text-white`}>
                          Score: {o.success_score}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{o.original_recommendation}</p>
                    {o.reason && <p className="text-xs text-muted-foreground mt-0.5">Reason: {o.reason}</p>}
                    {o.outcome && <p className="text-xs text-muted-foreground mt-0.5">Outcome: {o.outcome}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(o.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Override analytics */}
      {(overrides?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Override Summary</CardTitle></CardHeader>
          <CardContent className="flex gap-6 text-sm">
            {["approved", "rejected", "modified"].map((type) => {
              const count = overrides?.filter((o) => o.override_type === type).length ?? 0;
              return (
                <div key={type} className="text-center">
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground capitalize">{type}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Risk Assessment Tab ──────────────────────────────────────────────────────
function RiskAssessmentTab() {
  const { data: risks, isLoading } = useQuery<any[]>({ queryKey: ["/api/autonomy-trust/risk-assessment"] });

  const riskExamples: Record<string, string[]> = {
    low:      ["Session Reminders", "Attendance Follow-Ups", "Education Reminders"],
    medium:   ["Lead Outreach", "Coach Communication", "Prospect Follow-Ups"],
    high:     ["Hiring Recommendations", "Operational Changes", "Pricing Suggestions"],
    critical: ["Billing Changes", "Organization Settings", "Contract Modifications"],
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Risk Classification Engine</h3>
        <p className="text-sm text-muted-foreground">Autonomy ceiling enforced per risk level. Critical decisions cannot auto-execute.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {risks?.map((r: any) => {
            const riskCfg = RISK_CONFIG[r.riskLevel] ?? RISK_CONFIG.medium;
            const total = r.count;
            return (
              <Card key={r.riskLevel} className="border-2" data-testid={`card-risk-${r.riskLevel}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base capitalize">{r.label} Risk</CardTitle>
                    <Badge className={`text-sm border-0 ${riskCfg.badge}`}>Ceiling: {r.ceiling}/100</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: "Observe",  value: r.obsCount,   color: "text-slate-500" },
                      { label: "Recommend", value: r.recCount,  color: "text-blue-500" },
                      { label: "Queue",     value: r.queueCount, color: "text-amber-500" },
                      { label: "Execute",   value: r.autoCount,  color: "text-green-500" },
                    ].map((m) => (
                      <div key={m.label} className="bg-muted/50 rounded p-2">
                        <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                        <div className="text-[10px] text-muted-foreground">{m.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Decision types</span>
                      <span className="font-medium">{total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total executions</span>
                      <span className="font-medium">{r.totalExecutions?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Human overrides</span>
                      <span className={`font-medium ${r.totalOverrides > 20 ? "text-red-600" : ""}`}>{r.totalOverrides}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg trust score</span>
                      <span className="font-medium">{r.avgScore}/100</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Examples:</div>
                    <div className="flex flex-wrap gap-1">
                      {(riskExamples[r.riskLevel] ?? []).map((ex) => (
                        <Badge key={ex} variant="outline" className="text-[10px]">{ex}</Badge>
                      ))}
                    </div>
                  </div>

                  {r.riskLevel === "critical" && (
                    <div className="flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 rounded p-2">
                      <Lock className="w-3 h-3 shrink-0" /> Critical decisions cannot auto-execute regardless of score
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminAutonomyTrustPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" /> Autonomous Operations & Trust Layer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Phase 4 — The platform earns autonomy progressively through measurable business outcomes.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge className="text-xs gap-1 bg-green-600 text-white">
            <Activity className="w-3 h-3" /> Live
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"   data-testid="tab-overview">🛡️ Overview</TabsTrigger>
          <TabsTrigger value="registry"   data-testid="tab-registry">📋 Trust Registry</TabsTrigger>
          <TabsTrigger value="queue"      data-testid="tab-queue">⚡ Action Queue</TabsTrigger>
          <TabsTrigger value="overrides"  data-testid="tab-overrides">🧠 Override Learning</TabsTrigger>
          <TabsTrigger value="risk"       data-testid="tab-risk">🔒 Risk Assessment</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"  className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="registry"  className="mt-4"><TrustRegistryTab /></TabsContent>
        <TabsContent value="queue"     className="mt-4"><QueueTab /></TabsContent>
        <TabsContent value="overrides" className="mt-4"><OverridesTab /></TabsContent>
        <TabsContent value="risk"      className="mt-4"><RiskAssessmentTab /></TabsContent>
      </Tabs>
    </div>
  );
}
