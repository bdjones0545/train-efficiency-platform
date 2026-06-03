import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Brain, Target, Zap, BookOpen, Activity, Layers, ChevronRight,
  Plus, Trash2, RefreshCw, Play, Pause, CheckCircle, Clock, TrendingUp,
  AlertTriangle, BarChart3, Cpu, Database, Send, Lightbulb, Shield,
  XCircle, Star, Settings, Users, DollarSign, FlaskConical, Archive,
  ChevronDown, ChevronUp, Sparkles, CircleDot, Flag, Calendar,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────────────────

type Objective = {
  id: string; org_id: string; title: string; description?: string;
  target_value?: number; target_unit?: string; current_value?: number;
  deadline?: string; priority: string; status: string; progress: number;
  confidence: number; assigned_agents: any[]; execution_plan?: any;
  notes?: string; created_at: string; updated_at: string;
};

type Initiative = {
  id: string; org_id: string; name: string; description?: string;
  initiative_type: string; status: string; agents_assigned: any[];
  progress: number; results_summary?: string; automation_mode: string;
  started_at: string; created_at: string;
};

type MemoryEntry = {
  id: string; memory_type: string; title: string; description?: string;
  outcome?: string; outcome_value?: number; tags: string[];
  created_at: string;
};

type Dashboard = {
  objectives: { total: number; active: number; completed: number; avgProgress: number };
  initiatives: { total: number; running: number };
  memory: { total: number; recent: MemoryEntry[] };
  workforce: { totalActions: number; revenueInfluenced: number; hoursSaved: number; activeAgents: number };
  pipeline: { opportunities: number; pipelineValue: number };
  recentObjectives: Objective[];
  generatedAt: string;
};

type SimulationResult = {
  simulation: {
    revenueImpact: { monthly: number; confidence: number; direction: string };
    riskLevel: string; timeToSeeResults: string; confidence: number;
    recommendation: string; reasoning: string;
    expectedOutcomes: string[]; sideEffects: string[];
  };
  changeDescription: string; simulatedAt: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  high:   { color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/20",     border: "border-rose-200 dark:border-rose-800",    dot: "bg-rose-500" },
  medium: { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500" },
  low:    { color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20",     border: "border-blue-200 dark:border-blue-800",     dot: "bg-blue-500" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  active:    { label: "Active",    color: "text-emerald-600 dark:text-emerald-400", icon: Play },
  paused:    { label: "Paused",    color: "text-amber-600 dark:text-amber-400",     icon: Pause },
  completed: { label: "Completed", color: "text-blue-600 dark:text-blue-400",       icon: CheckCircle },
  archived:  { label: "Archived",  color: "text-muted-foreground",                  icon: Archive },
  running:   { label: "Running",   color: "text-emerald-600 dark:text-emerald-400", icon: Activity },
};

const MEMORY_TYPE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  initiative_success:       { label: "Success",    color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
  initiative_failure:       { label: "Failure",    color: "text-rose-600 dark:text-rose-400",       icon: XCircle },
  recommendation_approved:  { label: "Approved",   color: "text-blue-600 dark:text-blue-400",       icon: Lightbulb },
  recommendation_rejected:  { label: "Rejected",   color: "text-muted-foreground",                  icon: XCircle },
  outcome:                  { label: "Outcome",    color: "text-violet-600 dark:text-violet-400",   icon: Star },
  insight:                  { label: "Insight",    color: "text-amber-600 dark:text-amber-400",     icon: Brain },
};

const AUTOMATION_MODES = [
  { value: "manual",     label: "Manual",       desc: "Requires explicit approval for every action" },
  { value: "suggested",  label: "Suggested",    desc: "AI suggests; you approve before execution" },
  { value: "auto",       label: "Auto-Execute", desc: "AI executes approved action types automatically" },
];

const PRESET_INITIATIVES = [
  { name: "Lead Recovery Initiative",    type: "lead_recovery",   description: "Automatically identify and re-engage lost leads" },
  { name: "Referral Growth Initiative",  type: "referral",        description: "Systematically generate referrals from existing clients" },
  { name: "Coach Recruiting Initiative", type: "recruiting",      description: "Continuously identify and screen coach candidates" },
  { name: "Retention Initiative",        type: "retention",       description: "Monitor and proactively prevent client churn" },
];

const PRESET_OBJECTIVES = [
  { title: "Increase lead conversion by 20%", targetValue: 20, targetUnit: "%" },
  { title: "Recover $5,000 in lost revenue",  targetValue: 5000, targetUnit: "$" },
  { title: "Fill 15 training spots",          targetValue: 15, targetUnit: "spots" },
  { title: "Increase athlete retention by 10%", targetValue: 10, targetUnit: "%" },
];

function ProgressBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "dashboard",      label: "Dashboard",       icon: BarChart3 },
  { id: "objectives",     label: "Objectives",      icon: Target },
  { id: "initiatives",    label: "Initiatives",     icon: Layers },
  { id: "simulator",      label: "Simulator",       icon: FlaskConical },
  { id: "memory",         label: "Business Memory", icon: Database },
  { id: "chief",          label: "Chief of Staff",  icon: Brain },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Dashboard ────────────────────────────────────────────────────────────

function DashboardTab() {
  const { data, isLoading } = useQuery<Dashboard>({
    queryKey: ["/api/autonomous/dashboard"],
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="space-y-4" data-testid="tab-dashboard">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : [
          { label: "Active Objectives",    value: data?.objectives.active ?? 0,                              icon: Target,       color: "text-primary",                              bg: "bg-primary/10" },
          { label: "Avg Progress",         value: `${data?.objectives.avgProgress ?? 0}%`,                   icon: Activity,     color: "text-emerald-600 dark:text-emerald-400",    bg: "bg-emerald-500/10" },
          { label: "Running Initiatives",  value: data?.initiatives.running ?? 0,                            icon: Layers,       color: "text-violet-600 dark:text-violet-400",      bg: "bg-violet-500/10" },
          { label: "Revenue Influenced",   value: `$${(data?.workforce.revenueInfluenced ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
        ].map(m => {
          const Icon = m.icon;
          return (
            <div key={m.label} className={`p-4 rounded-xl border ${m.bg}`} data-testid={`kpi-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active Objectives */}
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Active Objectives</h3>
            <Badge variant="secondary" className="text-[10px] ml-auto">{data?.objectives.active ?? 0} active</Badge>
          </div>
          {isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : (
            <div className="space-y-3">
              {(data?.recentObjectives ?? []).slice(0, 4).map(obj => {
                const pri = PRIORITY_CONFIG[obj.priority] ?? PRIORITY_CONFIG.medium;
                const progressColor = obj.progress >= 75 ? "bg-emerald-500" : obj.progress >= 40 ? "bg-amber-500" : "bg-rose-500";
                return (
                  <div key={obj.id} data-testid={`dashboard-obj-${obj.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate mr-2">{obj.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className={`h-1.5 w-1.5 rounded-full ${pri.dot}`} />
                        <span className="text-[10px] font-semibold text-muted-foreground">{obj.progress}%</span>
                      </div>
                    </div>
                    <ProgressBar value={obj.progress} color={progressColor} />
                  </div>
                );
              })}
              {(data?.recentObjectives ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No active objectives. Create one in the Objectives tab.</p>
              )}
            </div>
          )}
        </div>

        {/* Workforce & Pipeline */}
        <div className="space-y-3">
          <div className="p-4 rounded-xl border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold">Workforce (7d)</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Agent Actions", value: data?.workforce.totalActions ?? 0 },
                { label: "Active Agents", value: data?.workforce.activeAgents ?? 0 },
                { label: "Hours Saved",   value: `${(data?.workforce.hoursSaved ?? 0).toFixed(1)}h` },
                { label: "Open Opps",     value: data?.pipeline.opportunities ?? 0 },
              ].map(m => (
                <div key={m.label} className="text-center p-2 rounded-lg bg-muted/40">
                  <p className="text-[9px] text-muted-foreground">{m.label}</p>
                  <p className="text-base font-bold">{m.value}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Recent memory */}
          <div className="p-4 rounded-xl border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Database className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-semibold">Recent Memory</h3>
            </div>
            {(data?.memory.recent ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No business memory recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {(data?.memory.recent ?? []).map((m: any) => {
                  const cfg = MEMORY_TYPE_CONFIG[m.memory_type] ?? MEMORY_TYPE_CONFIG.outcome;
                  const Icon = cfg.icon;
                  return (
                    <div key={m.id} className="flex items-center gap-2 text-xs">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                      <span className="flex-1 truncate">{m.title}</span>
                      <span className="text-muted-foreground shrink-0 text-[10px]">
                        {m.created_at ? formatDistanceToNow(new Date(m.created_at), { addSuffix: true }) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Business Objectives ──────────────────────────────────────────────────

function ObjectivesTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generatingPlanId, setGeneratingPlanId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", targetValue: "", targetUnit: "", deadline: "", priority: "medium" });

  const { data: objectives = [], isLoading } = useQuery<Objective[]>({
    queryKey: ["/api/autonomous/objectives"],
    staleTime: 2 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => (await apiRequest("POST", "/api/autonomous/objectives", payload)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/autonomous/objectives"] }); queryClient.invalidateQueries({ queryKey: ["/api/autonomous/dashboard"] }); setShowForm(false); setForm({ title: "", description: "", targetValue: "", targetUnit: "", deadline: "", priority: "medium" }); toast({ title: "Objective created." }); },
    onError: () => toast({ title: "Failed to create objective", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: any) => (await apiRequest("PATCH", `/api/autonomous/objectives/${id}`, payload)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/autonomous/objectives"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/autonomous/objectives/${id}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/autonomous/objectives"] }); queryClient.invalidateQueries({ queryKey: ["/api/autonomous/dashboard"] }); toast({ title: "Objective deleted." }); },
  });

  const generatePlan = async (obj: Objective) => {
    setGeneratingPlanId(obj.id);
    try {
      const r = await apiRequest("POST", `/api/autonomous/objectives/${obj.id}/generate-plan`, {});
      const data = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/objectives"] });
      toast({ title: "Execution plan generated!" });
      setExpandedId(obj.id);
    } catch {
      toast({ title: "Failed to generate plan", variant: "destructive" });
    } finally { setGeneratingPlanId(null); }
  };

  const STATUS_CYCLE: Record<string, string> = { active: "paused", paused: "active", completed: "archived" };

  return (
    <div className="space-y-4" data-testid="tab-objectives">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">{objectives.filter(o => o.status === "active").length} active · {objectives.filter(o => o.status === "completed").length} completed</p>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowForm(v => !v)} data-testid="button-new-objective">
          <Plus className="h-3.5 w-3.5" />{showForm ? "Cancel" : "New Objective"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="p-4 rounded-xl border bg-card space-y-3" data-testid="form-new-objective">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Business Objective</p>
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {PRESET_OBJECTIVES.map(p => (
              <button key={p.title} onClick={() => setForm(f => ({ ...f, title: p.title, targetValue: String(p.targetValue), targetUnit: p.targetUnit }))}
                className="px-2.5 py-1 rounded-full border text-[10px] bg-muted/40 hover:bg-muted transition-colors">
                {p.title}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Objective Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Increase lead conversion by 20%" className="h-8 text-sm mt-1" data-testid="input-objective-title" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional context..." className="text-sm min-h-14 resize-none mt-1" data-testid="input-objective-description" />
            </div>
            <div>
              <Label className="text-xs">Target Value</Label>
              <div className="flex gap-2 mt-1">
                <Input value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} placeholder="20" className="h-8 text-sm" data-testid="input-objective-target" />
                <Input value={form.targetUnit} onChange={e => setForm(f => ({ ...f, targetUnit: e.target.value }))} placeholder="%" className="h-8 text-sm w-20" data-testid="input-objective-unit" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Deadline</Label>
              <Input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} className="h-8 text-sm mt-1" data-testid="input-objective-deadline" />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-objective-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => createMutation.mutate({ ...form, targetValue: form.targetValue ? Number(form.targetValue) : undefined })} disabled={!form.title.trim() || createMutation.isPending} data-testid="button-submit-objective">
            <Plus className="h-3.5 w-3.5" />{createMutation.isPending ? "Creating..." : "Create Objective"}
          </Button>
        </div>
      )}

      {/* Objective list */}
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : objectives.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed">
          <Target className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No objectives yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first business objective to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {objectives.map(obj => {
            const pri = PRIORITY_CONFIG[obj.priority] ?? PRIORITY_CONFIG.medium;
            const stat = STATUS_CONFIG[obj.status] ?? STATUS_CONFIG.active;
            const StatIcon = stat.icon;
            const progressColor = obj.progress >= 75 ? "bg-emerald-500" : obj.progress >= 40 ? "bg-amber-500" : "bg-rose-500";
            const isExpanded = expandedId === obj.id;
            const plan = obj.execution_plan;

            return (
              <div key={obj.id} className={`rounded-xl border bg-card overflow-hidden`} data-testid={`objective-${obj.id}`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`h-2 w-2 rounded-full ${pri.dot} shrink-0 mt-2`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-semibold">{obj.title}</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${pri.color}`}>{obj.priority}</Badge>
                            <div className={`flex items-center gap-1 text-[10px] ${stat.color}`}>
                              <StatIcon className="h-3 w-3" />{stat.label}
                            </div>
                          </div>
                          {obj.description && <p className="text-xs text-muted-foreground">{obj.description}</p>}
                          {(obj.target_value !== undefined && obj.target_value !== null) && (
                            <p className="text-xs text-muted-foreground mt-0.5">Target: <span className="font-medium">{obj.target_value} {obj.target_unit ?? ""}</span>{obj.deadline && ` · Due ${format(new Date(obj.deadline), "MMM d, yyyy")}`}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => generatePlan(obj)} disabled={generatingPlanId === obj.id} title="Generate AI execution plan" data-testid={`button-gen-plan-${obj.id}`}>
                            {generatingPlanId === obj.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-500" onClick={() => deleteMutation.mutate(obj.id)} data-testid={`button-delete-obj-${obj.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpandedId(isExpanded ? null : obj.id)} data-testid={`button-expand-obj-${obj.id}`}>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2.5">
                        <div className="flex-1">
                          <ProgressBar value={obj.progress} color={progressColor} />
                        </div>
                        <span className={`text-xs font-bold shrink-0 ${progressColor.replace("bg-", "text-").replace("-500", "-600 dark:" + progressColor.replace("bg-", "text-").replace("-500", "-400"))}`}>{obj.progress}%</span>
                        <div className="flex items-center gap-1">
                          {[0, 25, 50, 75, 100].map(v => (
                            <button key={v} onClick={() => updateMutation.mutate({ id: obj.id, progress: v })}
                              className={`text-[9px] px-1.5 py-0.5 rounded ${obj.progress === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                              data-testid={`button-progress-${obj.id}-${v}`}>
                              {v}%
                            </button>
                          ))}
                        </div>
                      </div>
                      {obj.confidence !== undefined && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-[9px] text-muted-foreground">Confidence:</span>
                          <div className="h-1 w-20 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${obj.confidence}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground">{obj.confidence}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Execution plan */}
                {isExpanded && plan && (
                  <div className="border-t bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold">AI Execution Plan</span>
                      {plan.confidenceScore && <Badge variant="secondary" className="text-[10px]">{plan.confidenceScore}% confidence</Badge>}
                      {plan.totalDuration && <span className="text-[10px] text-muted-foreground ml-auto">{plan.totalDuration}</span>}
                    </div>
                    <div className="space-y-2">
                      {(plan.steps ?? []).map((step: any, i: number) => (
                        <div key={i} className="flex items-start gap-2.5 text-xs">
                          <div className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{step.step ?? i + 1}</div>
                          <div className="flex-1">
                            <p className="font-medium">{step.title}</p>
                            {step.agentType && <p className="text-muted-foreground text-[10px]">Agent: {step.agentType} · {step.duration}</p>}
                            {step.expectedOutcome && <p className="text-muted-foreground text-[10px]">→ {step.expectedOutcome}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(plan.keyRisks ?? []).length > 0 && (
                      <div className="mt-3 pt-2 border-t">
                        <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Key Risks</p>
                        {(plan.keyRisks ?? []).map((r: string, i: number) => (
                          <p key={i} className="text-[10px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />{r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {isExpanded && !plan && (
                  <div className="border-t bg-muted/30 p-4 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs text-muted-foreground">No execution plan yet. Click the <Sparkles className="h-3 w-3 inline" /> button to generate one with AI.</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Autonomous Initiatives ───────────────────────────────────────────────

function InitiativesTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", initiativeType: "custom", automationMode: "manual" });

  const { data: initiatives = [], isLoading } = useQuery<Initiative[]>({
    queryKey: ["/api/autonomous/initiatives"],
    staleTime: 2 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => (await apiRequest("POST", "/api/autonomous/initiatives", payload)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/autonomous/initiatives"] }); queryClient.invalidateQueries({ queryKey: ["/api/autonomous/dashboard"] }); setShowForm(false); setForm({ name: "", description: "", initiativeType: "custom", automationMode: "manual" }); toast({ title: "Initiative launched." }); },
    onError: () => toast({ title: "Failed to create initiative", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: any) => (await apiRequest("PATCH", `/api/autonomous/initiatives/${id}`, payload)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/autonomous/initiatives"] }); queryClient.invalidateQueries({ queryKey: ["/api/autonomous/dashboard"] }); },
  });

  const INITIATIVE_TYPE_LABELS: Record<string, string> = { lead_recovery: "Lead Recovery", referral: "Referral Growth", recruiting: "Coach Recruiting", retention: "Retention", custom: "Custom" };
  const AUTOMATION_BADGE: Record<string, { label: string; color: string }> = {
    manual:    { label: "Manual",       color: "text-muted-foreground" },
    suggested: { label: "Suggested",    color: "text-amber-600 dark:text-amber-400" },
    auto:      { label: "Auto-Execute", color: "text-emerald-600 dark:text-emerald-400" },
  };

  return (
    <div className="space-y-4" data-testid="tab-initiatives">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">{initiatives.filter(i => i.status === "running").length} running · {initiatives.length} total</p>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowForm(v => !v)} data-testid="button-new-initiative">
          <Plus className="h-3.5 w-3.5" />{showForm ? "Cancel" : "New Initiative"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="p-4 rounded-xl border bg-card space-y-3" data-testid="form-new-initiative">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Launch New Initiative</p>
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {PRESET_INITIATIVES.map(p => (
              <button key={p.name} onClick={() => setForm(f => ({ ...f, name: p.name, description: p.description, initiativeType: p.type }))}
                className="px-2.5 py-1 rounded-full border text-[10px] bg-muted/40 hover:bg-muted transition-colors" data-testid={`preset-initiative-${p.type}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Initiative Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lead Recovery Initiative" className="h-8 text-sm mt-1" data-testid="input-initiative-name" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What will this initiative accomplish?" className="text-sm min-h-14 resize-none mt-1" data-testid="input-initiative-description" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.initiativeType} onValueChange={v => setForm(f => ({ ...f, initiativeType: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-initiative-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INITIATIVE_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Automation Mode</Label>
              <Select value={form.automationMode} onValueChange={v => setForm(f => ({ ...f, automationMode: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-initiative-automation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTOMATION_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => createMutation.mutate(form)} disabled={!form.name.trim() || createMutation.isPending} data-testid="button-submit-initiative">
            <Play className="h-3.5 w-3.5" />{createMutation.isPending ? "Launching..." : "Launch Initiative"}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : initiatives.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed">
          <Layers className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No initiatives running</p>
          <p className="text-xs text-muted-foreground mt-1">Launch a long-running autonomous initiative to continuously improve your business</p>
        </div>
      ) : (
        <div className="space-y-3">
          {initiatives.map(init => {
            const stat = STATUS_CONFIG[init.status] ?? STATUS_CONFIG.running;
            const StatIcon = stat.icon;
            const autoBadge = AUTOMATION_BADGE[init.automation_mode] ?? AUTOMATION_BADGE.manual;
            const progressColor = init.progress >= 75 ? "bg-emerald-500" : init.progress >= 40 ? "bg-amber-500" : "bg-violet-500";
            return (
              <div key={init.id} className="p-4 rounded-xl border bg-card" data-testid={`initiative-${init.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold">{init.name}</span>
                      <div className={`flex items-center gap-1 text-[10px] ${stat.color}`}>
                        <StatIcon className="h-3 w-3" />{stat.label}
                      </div>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {INITIATIVE_TYPE_LABELS[init.initiative_type] ?? init.initiative_type}
                      </Badge>
                      <span className={`text-[10px] font-medium ${autoBadge.color}`}>{autoBadge.label}</span>
                    </div>
                    {init.description && <p className="text-xs text-muted-foreground">{init.description}</p>}
                    {init.results_summary && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{init.results_summary}</p>}
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex-1"><ProgressBar value={init.progress} color={progressColor} /></div>
                      <span className="text-xs font-bold shrink-0 text-muted-foreground">{init.progress}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">Started {init.started_at ? formatDistanceToNow(new Date(init.started_at), { addSuffix: true }) : ""}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {init.status === "running" ? (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => updateMutation.mutate({ id: init.id, status: "paused" })} data-testid={`button-pause-init-${init.id}`}>
                        <Pause className="h-3 w-3" />Pause
                      </Button>
                    ) : init.status === "paused" ? (
                      <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => updateMutation.mutate({ id: init.id, status: "running" })} data-testid={`button-resume-init-${init.id}`}>
                        <Play className="h-3 w-3" />Resume
                      </Button>
                    ) : null}
                    <Select value={init.automation_mode} onValueChange={v => updateMutation.mutate({ id: init.id, automationMode: v })}>
                      <SelectTrigger className="h-7 text-[10px]" data-testid={`select-automation-mode-${init.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUTOMATION_MODES.map(m => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Automation Mode Legend */}
      <div className="p-3 rounded-xl border bg-muted/30">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Automation Modes</p>
        <div className="space-y-1.5">
          {AUTOMATION_MODES.map(m => (
            <div key={m.value} className="flex items-start gap-2 text-xs">
              <span className="font-medium w-20 shrink-0">{m.label}</span>
              <span className="text-muted-foreground">{m.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Business Simulator ───────────────────────────────────────────────────

function SimulatorTab() {
  const { toast } = useToast();
  const [changeDescription, setChangeDescription] = useState("");
  const [changeType, setChangeType] = useState("workflow");
  const [targetMetric, setTargetMetric] = useState("revenue");
  const [result, setResult] = useState<SimulationResult | null>(null);

  const PRESETS = [
    "Enable automated follow-up for uncontacted leads",
    "Increase agent autonomy from manual to auto-execute",
    "Add a Research Agent for lead enrichment",
    "Launch a referral campaign to existing clients",
    "Expand scheduling automation to allow direct bookings",
    "Implement client re-engagement sequence for churned clients",
  ];

  const simulateMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/autonomous/simulate", { changeDescription, changeType, targetMetric })).json(),
    onSuccess: (data: SimulationResult) => setResult(data),
    onError: () => toast({ title: "Simulation failed", variant: "destructive" }),
  });

  const recConfig: Record<string, { color: string; bg: string; icon: any }> = {
    Deploy: { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", icon: CheckCircle },
    Review: { color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-900/20",    icon: AlertTriangle },
    Abort:  { color: "text-rose-600 dark:text-rose-400",      bg: "bg-rose-50 dark:bg-rose-900/20",      icon: XCircle },
  };

  return (
    <div className="space-y-4" data-testid="tab-simulator">
      <div className="p-4 rounded-xl border bg-gradient-to-r from-violet-500/5 to-blue-500/5">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Business Change Simulator</h3>
        </div>
        <p className="text-xs text-muted-foreground">Simulate any business change before deploying it. AI analyzes expected outcomes, risks, and revenue impact using your actual data.</p>
      </div>

      {/* Presets */}
      <div>
        <p className="text-[10px] text-muted-foreground font-medium mb-1.5">Common changes to simulate:</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p} onClick={() => setChangeDescription(p)}
              className="px-2.5 py-1 rounded-full border text-[10px] bg-card hover:bg-muted transition-colors" data-testid={`sim-preset-${p.slice(0, 15)}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Describe the change you want to simulate *</Label>
          <Textarea value={changeDescription} onChange={e => setChangeDescription(e.target.value)} placeholder="e.g. Enable automated follow-up for all uncontacted leads within 2 hours" className="text-sm min-h-20 resize-none mt-1" data-testid="input-sim-change" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Change Type</Label>
            <Select value={changeType} onValueChange={setChangeType}>
              <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-sim-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["workflow", "agent", "automation", "outreach", "scheduling", "governance"].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Target Metric</Label>
            <Select value={targetMetric} onValueChange={setTargetMetric}>
              <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-sim-metric"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["revenue", "conversion", "retention", "efficiency", "scheduling", "leads"].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => simulateMutation.mutate()} disabled={!changeDescription.trim() || simulateMutation.isPending} className="gap-1.5" data-testid="button-run-simulation">
          <FlaskConical className="h-4 w-4" />{simulateMutation.isPending ? "Simulating..." : "Run Simulation"}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-3" data-testid="simulation-result">
          {/* Recommendation banner */}
          {(() => {
            const rec = result.simulation.recommendation ?? "Review";
            const cfg = recConfig[rec] ?? recConfig.Review;
            const Icon = cfg.icon;
            return (
              <div className={`flex items-center gap-3 p-4 rounded-xl border ${cfg.bg}`}>
                <Icon className={`h-6 w-6 ${cfg.color} shrink-0`} />
                <div>
                  <p className={`text-base font-bold ${cfg.color}`}>Recommendation: {rec}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{result.simulation.reasoning}</p>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Revenue Impact",   value: `${result.simulation.revenueImpact?.direction === "positive" ? "+" : ""}$${Math.abs(result.simulation.revenueImpact?.monthly ?? 0).toLocaleString()}/mo`, color: result.simulation.revenueImpact?.direction === "positive" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400" },
              { label: "Risk Level",       value: result.simulation.riskLevel ?? "moderate",   color: result.simulation.riskLevel === "low" ? "text-emerald-600 dark:text-emerald-400" : result.simulation.riskLevel === "high" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400" },
              { label: "Confidence",       value: `${result.simulation.confidence ?? 0}%`,      color: "text-blue-600 dark:text-blue-400" },
              { label: "Time to Results",  value: result.simulation.timeToSeeResults ?? "—",    color: "text-muted-foreground" },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
                <p className={`text-sm font-bold capitalize mt-0.5 ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(result.simulation.expectedOutcomes ?? []).length > 0 && (
              <div className="p-3 rounded-xl border bg-emerald-50/50 dark:bg-emerald-900/10">
                <p className="text-[9px] font-medium text-emerald-700 dark:text-emerald-300 uppercase tracking-wide mb-2">Expected Outcomes</p>
                {result.simulation.expectedOutcomes.map((o, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs mb-1">
                    <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />{o}
                  </div>
                ))}
              </div>
            )}
            {(result.simulation.sideEffects ?? []).length > 0 && (
              <div className="p-3 rounded-xl border bg-amber-50/50 dark:bg-amber-900/10">
                <p className="text-[9px] font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-2">Side Effects</p>
                {result.simulation.sideEffects.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs mb-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />{s}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-right">Simulated {result.simulatedAt ? formatDistanceToNow(new Date(result.simulatedAt), { addSuffix: true }) : ""}</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Business Memory ──────────────────────────────────────────────────────

function MemoryTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", memoryType: "outcome", outcome: "", outcomeValue: "" });
  const [filter, setFilter] = useState("all");

  const { data: memory = [], isLoading } = useQuery<MemoryEntry[]>({
    queryKey: ["/api/autonomous/memory"],
    staleTime: 2 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => (await apiRequest("POST", "/api/autonomous/memory", payload)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/autonomous/memory"] }); queryClient.invalidateQueries({ queryKey: ["/api/autonomous/dashboard"] }); setShowForm(false); setForm({ title: "", description: "", memoryType: "outcome", outcome: "", outcomeValue: "" }); toast({ title: "Memory saved." }); },
    onError: () => toast({ title: "Failed to save memory", variant: "destructive" }),
  });

  const filtered = filter === "all" ? memory : memory.filter(m => m.memory_type === filter);

  return (
    <div className="space-y-4" data-testid="tab-memory">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {[{ v: "all", l: "All" }, { v: "initiative_success", l: "Successes" }, { v: "initiative_failure", l: "Failures" }, { v: "recommendation_approved", l: "Approved" }, { v: "outcome", l: "Outcomes" }, { v: "insight", l: "Insights" }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              data-testid={`memory-filter-${f.v}`}>
              {f.l}
            </button>
          ))}
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowForm(v => !v)} data-testid="button-add-memory">
          <Plus className="h-3.5 w-3.5" />{showForm ? "Cancel" : "Add Memory"}
        </Button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl border bg-card space-y-3" data-testid="form-add-memory">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Record Business Memory</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Summer outreach campaign — 32% conversion" className="h-8 text-sm mt-1" data-testid="input-memory-title" />
            </div>
            <div>
              <Label className="text-xs">Memory Type</Label>
              <Select value={form.memoryType} onValueChange={v => setForm(f => ({ ...f, memoryType: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1" data-testid="select-memory-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MEMORY_TYPE_CONFIG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Outcome Value ($)</Label>
              <Input type="number" value={form.outcomeValue} onChange={e => setForm(f => ({ ...f, outcomeValue: e.target.value }))} placeholder="0" className="h-8 text-sm mt-1" data-testid="input-memory-value" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Outcome / Lesson</Label>
              <Textarea value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} placeholder="What was the result or lesson learned?" className="text-sm min-h-14 resize-none mt-1" data-testid="input-memory-outcome" />
            </div>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => createMutation.mutate({ ...form, outcomeValue: form.outcomeValue ? Number(form.outcomeValue) : undefined })} disabled={!form.title.trim() || createMutation.isPending} data-testid="button-submit-memory">
            <Database className="h-3.5 w-3.5" />{createMutation.isPending ? "Saving..." : "Save to Memory"}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed">
          <Database className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No business memories yet</p>
          <p className="text-xs text-muted-foreground mt-1">Record outcomes, lessons, and decisions to inform future AI recommendations</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => {
            const cfg = MEMORY_TYPE_CONFIG[m.memory_type] ?? MEMORY_TYPE_CONFIG.outcome;
            const Icon = cfg.icon;
            return (
              <div key={m.id} className="flex items-start gap-3 p-3 rounded-xl border bg-card" data-testid={`memory-${m.id}`}>
                <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{m.title}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cfg.color}`}>{cfg.label}</Badge>
                    {m.outcome_value != null && Number(m.outcome_value) > 0 && (
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">${Number(m.outcome_value).toLocaleString()}</span>
                    )}
                  </div>
                  {m.outcome && <p className="text-[10px] text-muted-foreground mt-0.5">{m.outcome}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {m.created_at ? formatDistanceToNow(new Date(m.created_at), { addSuffix: true }) : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: AI Chief of Staff ────────────────────────────────────────────────────

const CHIEF_PROMPTS = [
  "What is our biggest opportunity right now?",
  "What should I focus on this week?",
  "Why might our conversions be underperforming?",
  "Which goal should we pursue next?",
  "What is our highest-priority risk?",
  "Where should we allocate agent resources?",
  "What initiative would have the highest ROI?",
];

type ChiefMessage = { role: "user" | "assistant"; content: string; time: string };

function ChiefOfStaffTab() {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChiefMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chiefMutation = useMutation({
    mutationFn: async (q: string) => (await apiRequest("POST", "/api/autonomous/chief-of-staff", { question: q })).json(),
    onSuccess: (data: any) => {
      setHistory(prev => [...prev, { role: "assistant", content: data.answer, time: new Date().toLocaleTimeString() }]);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: () => toast({ title: "Failed to get response", variant: "destructive" }),
  });

  const handleAsk = (q: string) => {
    if (!q.trim()) return;
    setHistory(prev => [...prev, { role: "user", content: q.trim(), time: new Date().toLocaleTimeString() }]);
    setQuestion("");
    chiefMutation.mutate(q.trim());
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  return (
    <div className="space-y-4" data-testid="tab-chief">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
        <Cpu className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">AI Chief of Staff</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Your strategic coordinator. Has access to objectives, initiatives, workforce data, revenue pipeline, and business memory. Gives direct, actionable executive guidance.</p>
        </div>
      </div>

      {history.length === 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">Ask the Chief of Staff:</p>
          <div className="flex flex-wrap gap-2">
            {CHIEF_PROMPTS.map(p => (
              <button key={p} onClick={() => handleAsk(p)}
                data-testid={`chief-prompt-${p.slice(0, 15)}`}
                className="px-3 py-1.5 rounded-full border bg-card text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {history.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-emerald-500/10"}`}>
                {msg.role === "user" ? <span className="text-[10px] font-bold">You</span> : <Cpu className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
              </div>
              <div className={`flex-1 max-w-[85%] ${msg.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block p-3 rounded-xl text-sm text-left ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border rounded-tl-sm"}`}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{msg.time}</p>
              </div>
            </div>
          ))}
          {chiefMutation.isPending && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Cpu className="h-4 w-4 text-emerald-600 dark:text-emerald-400 animate-pulse" />
              </div>
              <div className="p-3 rounded-xl border bg-card">
                <div className="flex gap-1">{[0, 1, 2].map(i => <div key={i} className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      )}

      <div className="flex gap-2">
        <Textarea value={question} onChange={e => setQuestion(e.target.value)}
          placeholder="Ask the Chief of Staff a strategic question..."
          className="text-sm min-h-16 max-h-32 resize-none"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(question); } }}
          data-testid="input-chief-question" />
        <Button onClick={() => handleAsk(question)} disabled={!question.trim() || chiefMutation.isPending} className="shrink-0 h-16" data-testid="button-chief-ask">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {history.length > 0 && (
        <button onClick={() => setHistory([])} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear conversation</button>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminAutonomousManagementPage() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  const { data: dashboard } = useQuery<Dashboard>({ queryKey: ["/api/autonomous/dashboard"], staleTime: 2 * 60_000 });

  const activeObjs = dashboard?.objectives.active ?? 0;
  const runningInits = dashboard?.initiatives.running ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-autonomous-management">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/executive-intelligence">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Executive Intelligence
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Autonomous Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            From analysis to execution — set objectives, launch initiatives, simulate changes.
          </p>
        </div>

        {/* Live summary */}
        {dashboard && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Objectives</p>
              <p className="text-2xl font-extrabold text-primary">{activeObjs}</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Initiatives</p>
              <p className="text-2xl font-extrabold text-violet-600 dark:text-violet-400">{runningInits}</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Avg Progress</p>
              <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{dashboard.objectives.avgProgress}%</p>
            </div>
          </div>
        )}
      </div>

      {/* Architecture breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup Wizard",         href: "/admin/ai-workforce" },
          { label: "Workforce Mgmt",        href: "/admin/ai-workforce/settings" },
          { label: "Operations",            href: "/admin/ai-operations" },
          { label: "Executive Intelligence",href: "/admin/executive-intelligence" },
          { label: "Autonomous Mgmt",       href: null, active: true },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href ? (
              <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
            ) : (
              <span className="font-semibold text-foreground">{step.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-autonomous">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = tab.id === "objectives" ? activeObjs : tab.id === "initiatives" ? runningInits : 0;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {badge > 0 && (
                <span className={`h-4 w-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center ml-0.5 ${isActive ? "bg-white/30" : "bg-primary"}`}>
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "dashboard"   && <DashboardTab />}
        {activeTab === "objectives"  && <ObjectivesTab />}
        {activeTab === "initiatives" && <InitiativesTab />}
        {activeTab === "simulator"   && <SimulatorTab />}
        {activeTab === "memory"      && <MemoryTab />}
        {activeTab === "chief"       && <ChiefOfStaffTab />}
      </div>

      {/* Forward navigation → Trust & Attribution */}
      <Link href="/admin/trust-attribution">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-trust-attribution">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Trust & Attribution Layer</p>
            <p className="text-xs text-muted-foreground mt-0.5">Prove ROI, explain decisions, measure outcomes, and maintain complete executive control.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
