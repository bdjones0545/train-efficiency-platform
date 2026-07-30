import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ClipboardList, ChevronRight, Layers, RefreshCw, Plus,
  X, CheckCircle, AlertTriangle, BarChart3, GitBranch, Play,
  Shield, Clock, TrendingUp, CheckSquare, Star, Activity,
  ChevronDown, ChevronUp, Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = { stepNumber: number; title: string; instructions: string; required: boolean; verificationMethod: string };
type Procedure = { id: string; title: string; department: string; procedureType: string; description: string; version: string; status: string; createdBy: string; approvedBy: string | null; complianceScore: number; executionCount: number; avgCompletionTime: string; roi: string; createdAt: string; updatedAt: string; steps: Step[] };
type LibraryData = { procedures: Procedure[]; total: number; generatedAt: string };
type Overview = { total: number; active: number; avgComplianceScore: number; totalExecutions: number; departmentCoverage: number; topRoiSop: { title: string; roi: string }; needsReview: number; generatedAt: string };

type DeptCompliance = { department: string; avgCompliance: number; sopCount: number };
type AgentCompliance = { agent: string; avgCompliance: number; executions: number; fullyCompliant: number };
type ComplianceData = { orgComplianceScore: number; departmentCompliance: DeptCompliance[]; agentCompliance: AgentCompliance[]; fullyCompliant: number; partialCompliant: number; nonCompliant: number; generatedAt: string };

type VersionEntry = { id: string; versionNumber: string; changeSummary: string; reasonForChange: string; performanceImpact: string; createdAt: string };
type ProcedureWithVersions = { id: string; title: string; department: string; currentVersion: string; versions: VersionEntry[] };
type VersionsData = { procedures: ProcedureWithVersions[]; totalVersionEvents: number; generatedAt: string };

type Execution = { id: string; procedureId: string; procedureTitle: string; agentId: string; executionStatus: string; complianceScore: number; stepsCompleted: number; totalSteps: number; startedAt: string; completedAt: string | null };
type AnalyticsData = { totalProcedures: number; activeProcedures: number; avgComplianceScore: number; totalExecutions: number; mostUsedSops: { id: string; title: string; executionCount: number; complianceScore: number }[]; highestRoiSops: { id: string; title: string; roi: string; department: string }[]; needsReview: Procedure[]; byDepartment: Record<string, number>; recentExecutions: Execution[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEPT_COLORS: Record<string, string> = { Revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", Operations: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Marketing: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", "Customer Success": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", Finance: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300", Governance: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", Partnerships: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" };
const STATUS_COLORS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", deprecated: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", archived: "bg-muted text-muted-foreground" };

function DeptBadge({ d }: { d: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${DEPT_COLORS[d] ?? "bg-muted text-muted-foreground"}`}>{d}</Badge>;
}
function StatusBadge({ s }: { s: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${STATUS_COLORS[s] ?? "bg-muted text-muted-foreground"}`}>{s}</Badge>;
}
function ComplianceScore({ score }: { score: number }) {
  const color = score >= 95 ? "text-emerald-600 dark:text-emerald-400" : score >= 85 ? "text-primary" : score >= 70 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";
  return <span className={`font-bold ${color}`}>{score}%</span>;
}
function AgentDot({ name }: { name: string }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Agent": "bg-emerald-500", "Email Agent": "bg-blue-500", "Research Agent": "bg-amber-500", "Scheduling Agent": "bg-teal-500", "Customer Success Agent": "bg-cyan-500", "CEO Heartbeat": "bg-primary", "Intelligence Engine": "bg-rose-500" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  return <div className={`h-5 w-5 ${color} rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0`}>{initials}</div>;
}

// ─── SOP Card ─────────────────────────────────────────────────────────────────

function SopCard({ proc, showSteps = false }: { proc: Procedure; showSteps?: boolean }) {
  const [open, setOpen] = useState(showSteps);
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});
  const { toast } = useToast();
  const qc = useQueryClient();

  const executeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procedures/execute", { procedureId: proc.id, agentId: "Human Admin" }),
    onSuccess: () => { toast({ title: `Executing: ${proc.title}` }); qc.invalidateQueries({ queryKey: ["/api/procedures/analytics"] }); },
    onError: () => toast({ title: "Failed to start execution", variant: "destructive" }),
  });

  const checkedCount = Object.values(checklist).filter(Boolean).length;
  const totalRequired = proc.steps.filter(s => s.required).length;

  return (
    <div className="rounded-xl border bg-card overflow-hidden" data-testid={`sop-card-${proc.id}`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
            <ClipboardList className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <p className="text-xs font-bold truncate">{proc.title}</p>
              <StatusBadge s={proc.status} />
              <DeptBadge d={proc.department} />
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">v{proc.version}</Badge>
            </div>
            <p className="text-[9px] text-muted-foreground mb-2 line-clamp-2">{proc.description}</p>
            <div className="flex items-center gap-4 text-[9px] flex-wrap">
              <div className="flex items-center gap-1">
                <Shield className="h-2.5 w-2.5 text-muted-foreground" />
                <span>Compliance <ComplianceScore score={proc.complianceScore} /></span>
              </div>
              <div className="flex items-center gap-1">
                <Activity className="h-2.5 w-2.5 text-muted-foreground" />
                <span>{proc.executionCount} executions</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                <span>Avg {proc.avgCompletionTime}</span>
              </div>
              {proc.roi && (
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="h-2.5 w-2.5" />
                  <span className="font-bold">{proc.roi}</span>
                </div>
              )}
              <span className="text-muted-foreground ml-auto">{proc.steps.length} steps</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" className="h-6 text-[9px] px-2 gap-1" onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending} data-testid={`button-execute-${proc.id}`}>
              {executeMutation.isPending ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}Execute
            </Button>
            <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors" data-testid={`toggle-sop-${proc.id}`}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Steps checklist */}
      {open && (
        <div className="border-t px-4 py-3 bg-muted/10 space-y-2" data-testid={`sop-steps-${proc.id}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Procedure Steps</p>
            <span className="text-[9px] text-muted-foreground">{checkedCount}/{proc.steps.length} completed</span>
          </div>
          {proc.steps.map(step => (
            <div key={step.stepNumber} className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${checklist[step.stepNumber] ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-800" : "bg-card border-border"}`} data-testid={`step-${proc.id}-${step.stepNumber}`}>
              <button onClick={() => setChecklist(p => ({ ...p, [step.stepNumber]: !p[step.stepNumber] }))} className="shrink-0 mt-0.5" data-testid={`check-step-${proc.id}-${step.stepNumber}`}>
                <div className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${checklist[step.stepNumber] ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`}>
                  {checklist[step.stepNumber] && <CheckCircle className="h-2.5 w-2.5 text-white" />}
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8px] font-bold text-muted-foreground">{step.stepNumber}.</span>
                  <p className="text-[9px] font-semibold">{step.title}</p>
                  {!step.required && <Badge variant="outline" className="text-[7px] px-1 py-0 h-3">optional</Badge>}
                </div>
                <p className="text-[8px] text-muted-foreground">{step.instructions}</p>
                <p className="text-[8px] text-primary/70 mt-1">✓ {step.verificationMethod}</p>
              </div>
            </div>
          ))}
          {checkedCount === proc.steps.length && proc.steps.length > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 mt-2" data-testid={`sop-complete-${proc.id}`}>
              <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
              <p className="text-[9px] text-emerald-700 dark:text-emerald-300 font-medium">All steps completed — ready for verification</p>
              <Button size="sm" className="h-5 text-[8px] px-2 ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => toast({ title: "Execution verified and logged" })} data-testid={`button-verify-${proc.id}`}>
                Verify
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",   label: "Overview",          icon: ClipboardList },
  { id: "library",    label: "SOP Library",       icon: ClipboardList },
  { id: "builder",    label: "Procedure Builder",  icon: Plus         },
  { id: "execution",  label: "Execution",         icon: Play          },
  { id: "compliance", label: "Compliance",        icon: Shield        },
  { id: "versions",   label: "Version Control",   icon: GitBranch     },
  { id: "checklists", label: "Checklists",        icon: CheckSquare   },
  { id: "analytics",  label: "Analytics",         icon: BarChart3     },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/procedures/overview"], staleTime: 60_000 });
  const { data: lib } = useQuery<LibraryData>({ queryKey: ["/api/procedures/library"], staleTime: 30_000 });

  return (
    <div className="space-y-5" data-testid="tab-overview-procs">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Active SOPs",          value: data?.active ?? "—",                                     color: "text-primary" },
          { label: "Compliance Score",      value: data ? `${data.avgComplianceScore}%` : "—",             color: data && data.avgComplianceScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          { label: "Total Executions",      value: data?.totalExecutions ?? "—",                           color: "text-blue-600 dark:text-blue-400" },
          { label: "Dept Coverage",         value: data ? `${data.departmentCoverage} depts` : "—",        color: "text-muted-foreground" },
          { label: "Needs Review",          value: data?.needsReview ?? "—",                               color: data && (data.needsReview ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
          { label: "Total SOPs",            value: data?.total ?? "—",                                     color: "text-muted-foreground" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`overview-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {data?.topRoiSop && (
        <div className="p-4 rounded-xl border bg-gradient-to-r from-emerald-500/5 to-primary/5">
          <div className="flex items-center gap-2 mb-1">
            <Star className="h-4 w-4 text-emerald-500" />
            <p className="text-xs font-bold">Highest ROI SOP</p>
          </div>
          <p className="text-sm font-semibold text-primary">{data.topRoiSop.title}</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold mt-1">{data.topRoiSop.roi}</p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : lib && (
        <div className="space-y-2">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">All Procedures</p>
          {lib.procedures.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`overview-proc-${p.id}`}>
              <ClipboardList className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold truncate">{p.title}</p>
                <div className="flex items-center gap-2 text-[8px] text-muted-foreground">
                  <span>v{p.version}</span>
                  <span>·</span>
                  <span>{p.executionCount} runs</span>
                </div>
              </div>
              <DeptBadge d={p.department} />
              <StatusBadge s={p.status} />
              <div className="text-right shrink-0">
                <ComplianceScore score={p.complianceScore} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: SOP Library ─────────────────────────────────────────────────────────

function LibraryTab() {
  const { data, isLoading } = useQuery<LibraryData>({ queryKey: ["/api/procedures/library"], staleTime: 30_000 });
  const [deptFilter, setDeptFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const procs = data?.procedures ?? [];
  const depts = [...new Set(procs.map(p => p.department))];
  const types = [...new Set(procs.map(p => p.procedureType))];
  const filtered = procs.filter(p => (deptFilter === "all" || p.department === deptFilter) && (typeFilter === "all" || p.procedureType === typeFilter));

  return (
    <div className="space-y-4" data-testid="tab-library">
      <div className="flex flex-wrap gap-1.5">
        <div className="flex gap-1 flex-wrap">
          {["all", ...depts].map(d => (
            <button key={d} onClick={() => setDeptFilter(d)} data-testid={`filter-dept-${d}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${deptFilter === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all", ...types].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} data-testid={`filter-type-${t}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {filtered.map(p => <SopCard key={p.id} proc={p} />)}
          {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No SOPs match the selected filters.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Procedure Builder ───────────────────────────────────────────────────

function BuilderTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [convertSource, setConvertSource] = useState({ sourceTitle: "", department: "Revenue", sourceType: "memory" });
  const [newSop, setNewSop] = useState({ title: "", department: "Revenue", procedureType: "sales", description: "" });
  const [steps, setSteps] = useState<{ title: string; instructions: string; required: boolean }[]>([{ title: "", instructions: "", required: true }]);

  const convertMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procedures/convert", convertSource),
    onSuccess: () => { toast({ title: "Converted to draft SOP — edit and activate" }); setConvertSource(p => ({ ...p, sourceTitle: "" })); },
    onError: () => toast({ title: "Conversion failed", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procedures/create", { ...newSop, steps: steps.map((s, i) => ({ stepNumber: i + 1, ...s, verificationMethod: "" })) }),
    onSuccess: () => { toast({ title: "SOP created — status: Draft" }); qc.invalidateQueries({ queryKey: ["/api/procedures/library"] }); },
    onError: () => toast({ title: "Failed to create SOP", variant: "destructive" }),
  });

  return (
    <div className="space-y-5" data-testid="tab-builder">
      {/* Convert from memory */}
      <div className="p-4 rounded-xl border bg-card space-y-3">
        <p className="text-xs font-bold flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 text-primary" />Convert Knowledge to SOP</p>
        <p className="text-[9px] text-muted-foreground">Transform a playbook, lesson, or completed task from Organisational Memory directly into a structured SOP.</p>
        <div className="flex gap-2 flex-wrap">
          <select value={convertSource.sourceType} onChange={e => setConvertSource(p => ({ ...p, sourceType: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-source-type">
            {["memory", "playbook", "lesson", "task", "campaign"].map(t => <option key={t}>{t}</option>)}
          </select>
          <input value={convertSource.sourceTitle} onChange={e => setConvertSource(p => ({ ...p, sourceTitle: e.target.value }))} placeholder="Source title (e.g. Lead Recovery Playbook)…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary min-w-[180px]" data-testid="input-convert-title" />
          <select value={convertSource.department} onChange={e => setConvertSource(p => ({ ...p, department: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-convert-dept">
            {["Revenue","Operations","Marketing","Customer Success","Finance","Governance","Partnerships"].map(d => <option key={d}>{d}</option>)}
          </select>
          <Button className="h-8 gap-1.5 shrink-0 text-xs" onClick={() => convertMutation.mutate()} disabled={!convertSource.sourceTitle.trim() || convertMutation.isPending} data-testid="button-convert">
            {convertMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Convert
          </Button>
        </div>
      </div>

      {/* Build from scratch */}
      <div className="p-4 rounded-xl border bg-card space-y-3">
        <p className="text-xs font-bold flex items-center gap-2"><Plus className="h-3.5 w-3.5 text-primary" />Build New SOP</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <input value={newSop.title} onChange={e => setNewSop(p => ({ ...p, title: e.target.value }))} placeholder="SOP title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-sop-title" />
          </div>
          <select value={newSop.department} onChange={e => setNewSop(p => ({ ...p, department: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-sop-dept">
            {["Revenue","Operations","Marketing","Customer Success","Finance","Governance","Partnerships"].map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={newSop.procedureType} onChange={e => setNewSop(p => ({ ...p, procedureType: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-proc-type">
            {["sales","operations","marketing","customer_success","finance","governance","hr"].map(t => <option key={t}>{t}</option>)}
          </select>
          <div className="col-span-2">
            <textarea value={newSop.description} onChange={e => setNewSop(p => ({ ...p, description: e.target.value }))} placeholder="What does this SOP govern? When does it apply?" className="w-full h-16 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="textarea-sop-desc" />
          </div>
        </div>

        {/* Steps */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Procedure Steps</p>
            <button onClick={() => setSteps(p => [...p, { title: "", instructions: "", required: true }])} className="text-[9px] text-primary hover:underline flex items-center gap-0.5" data-testid="button-add-step">
              <Plus className="h-2.5 w-2.5" />Add Step
            </button>
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border bg-muted/20" data-testid={`builder-step-${i}`}>
                <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0 mt-2">{i + 1}.</span>
                <div className="flex-1 space-y-1.5">
                  <input value={step.title} onChange={e => setSteps(p => p.map((s, j) => j === i ? { ...s, title: e.target.value } : s))} placeholder="Step title…" className="w-full h-7 px-2.5 rounded border bg-background text-[10px] focus:outline-none focus:ring-1 focus:ring-primary" data-testid={`step-title-${i}`} />
                  <input value={step.instructions} onChange={e => setSteps(p => p.map((s, j) => j === i ? { ...s, instructions: e.target.value } : s))} placeholder="Instructions…" className="w-full h-7 px-2.5 rounded border bg-background text-[10px] focus:outline-none focus:ring-1 focus:ring-primary" data-testid={`step-instructions-${i}`} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0 mt-1.5">
                  <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={step.required} onChange={e => setSteps(p => p.map((s, j) => j === i ? { ...s, required: e.target.checked } : s))} className="h-3 w-3" data-testid={`step-required-${i}`} />
                    Required
                  </label>
                  {steps.length > 1 && (
                    <button onClick={() => setSteps(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-500 transition-colors" data-testid={`remove-step-${i}`}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button className="gap-1.5 h-8 text-xs" onClick={() => createMutation.mutate()} disabled={!newSop.title.trim() || createMutation.isPending} data-testid="button-create-sop">
            {createMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create SOP (Draft)
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Execution ───────────────────────────────────────────────────────────

function ExecutionTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({ queryKey: ["/api/procedures/analytics"], staleTime: 30_000 });
  const { data: lib } = useQuery<LibraryData>({ queryKey: ["/api/procedures/library"], staleTime: 30_000 });
  const { toast } = useToast();

  const STATUS_ICON: Record<string, React.ReactNode> = {
    completed:   <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />,
    in_progress: <Play        className="h-4 w-4 text-blue-500 shrink-0"    />,
    failed:      <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0"  />,
  };

  return (
    <div className="space-y-4" data-testid="tab-execution">
      {/* Quick execute */}
      {lib && (
        <div className="p-4 rounded-xl border bg-card space-y-2">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Execute a Procedure</p>
          <div className="flex gap-2 flex-wrap">
            {lib.procedures.filter(p => p.status === "active").map(p => (
              <button key={p.id} onClick={() => { apiRequest("POST", "/api/procedures/execute", { procedureId: p.id, agentId: "Human Admin" }).then(() => toast({ title: `Executing: ${p.title}` })); }} data-testid={`quick-execute-${p.id}`}
                className="px-2.5 py-1 rounded-lg border text-[10px] bg-card hover:bg-muted/20 transition-colors flex items-center gap-1.5">
                <Play className="h-2.5 w-2.5 text-primary" />
                {p.title.split(" SOP")[0].substring(0, 30)}{p.title.length > 40 ? "…" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent executions */}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Recent Executions</p>
          {(data?.recentExecutions ?? []).map(ex => {
            const pct = ex.totalSteps > 0 ? Math.round((ex.stepsCompleted / ex.totalSteps) * 100) : 0;
            return (
              <div key={ex.id} className="p-3.5 rounded-xl border bg-card" data-testid={`execution-${ex.id}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5">{STATUS_ICON[ex.executionStatus] ?? <Play className="h-4 w-4 text-muted-foreground shrink-0" />}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <p className="text-[10px] font-bold truncate">{ex.procedureTitle}</p>
                      <Badge className={`text-[8px] px-1.5 py-0 h-4 ${ex.executionStatus === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : ex.executionStatus === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
                        {ex.executionStatus.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <AgentDot name={ex.agentId} />
                      <span className="text-[9px] text-muted-foreground">{ex.agentId}</span>
                      <span className="text-[8px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(ex.startedAt), { addSuffix: true })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${ex.executionStatus === "completed" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[8px] text-muted-foreground shrink-0">{ex.stepsCompleted}/{ex.totalSteps} steps</span>
                      {ex.complianceScore > 0 && <ComplianceScore score={ex.complianceScore} />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Compliance ──────────────────────────────────────────────────────────

function ComplianceTab() {
  const { data, isLoading } = useQuery<ComplianceData>({ queryKey: ["/api/procedures/compliance"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-compliance">
      {/* Org score */}
      {data && (
        <div className="p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Organization Compliance Score</p>
          <p className="text-5xl font-extrabold text-primary">{data.orgComplianceScore}%</p>
          <div className="flex justify-center gap-6 mt-3 text-[9px]">
            <div className="text-center">
              <p className="font-bold text-emerald-600 dark:text-emerald-400">{data.fullyCompliant}</p>
              <p className="text-muted-foreground">Fully Compliant</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-amber-600 dark:text-amber-400">{data.partialCompliant}</p>
              <p className="text-muted-foreground">Partial</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-rose-500">{data.nonCompliant}</p>
              <p className="text-muted-foreground">Non-Compliant</p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          {/* Department compliance */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Department Compliance</p>
            <div className="space-y-3">
              {data.departmentCompliance.sort((a, b) => b.avgCompliance - a.avgCompliance).map(dept => (
                <div key={dept.department} data-testid={`dept-compliance-${dept.department.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <DeptBadge d={dept.department} />
                      <span className="text-[9px] text-muted-foreground">{dept.sopCount} SOP{dept.sopCount !== 1 ? "s" : ""}</span>
                    </div>
                    <ComplianceScore score={dept.avgCompliance} />
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${dept.avgCompliance >= 95 ? "bg-emerald-500" : dept.avgCompliance >= 85 ? "bg-primary" : dept.avgCompliance >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${dept.avgCompliance}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent compliance */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Agent Compliance</p>
            <div className="space-y-2.5">
              {data.agentCompliance.sort((a, b) => b.avgCompliance - a.avgCompliance).map((agent, i) => (
                <div key={agent.agent} className="flex items-center gap-3" data-testid={`agent-compliance-${i}`}>
                  <AgentDot name={agent.agent} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] font-medium truncate">{agent.agent}</span>
                      <div className="flex items-center gap-3 text-[9px] shrink-0">
                        <span className="text-muted-foreground">{agent.executions} runs</span>
                        <ComplianceScore score={agent.avgCompliance} />
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${agent.avgCompliance >= 95 ? "bg-emerald-500" : agent.avgCompliance >= 85 ? "bg-primary" : "bg-amber-500"}`} style={{ width: `${agent.avgCompliance}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Version Control ─────────────────────────────────────────────────────

function VersionsTab() {
  const { data, isLoading } = useQuery<VersionsData>({ queryKey: ["/api/procedures/versions"], staleTime: 60_000 });
  const { toast } = useToast();
  const [newVersionForm, setNewVersionForm] = useState({ procedureId: "", changeSummary: "", reasonForChange: "", performanceImpact: "" });

  const versionMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/procedures/update-version", newVersionForm),
    onSuccess: (data: any) => { toast({ title: `Version updated → v${data?.newVersion}` }); setNewVersionForm(p => ({ ...p, changeSummary: "", reasonForChange: "", performanceImpact: "" })); },
    onError: () => toast({ title: "Failed to update version", variant: "destructive" }),
  });

  return (
    <div className="space-y-5" data-testid="tab-versions">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border bg-card text-center">
          <p className="text-xl font-extrabold text-primary">{data?.procedures.length ?? "—"}</p>
          <p className="text-[9px] text-muted-foreground">SOPs with Version History</p>
        </div>
        <div className="p-3 rounded-xl border bg-card text-center">
          <p className="text-xl font-extrabold text-violet-600 dark:text-violet-400">{data?.totalVersionEvents ?? "—"}</p>
          <p className="text-[9px] text-muted-foreground">Total Version Events</p>
        </div>
      </div>

      {/* New version form */}
      <div className="p-4 rounded-xl border bg-card space-y-2.5">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Create New Version</p>
        <div className="grid grid-cols-2 gap-2">
          <select value={newVersionForm.procedureId} onChange={e => setNewVersionForm(p => ({ ...p, procedureId: e.target.value }))} className="col-span-2 h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-proc-version">
            <option value="">Select SOP…</option>
            {(data?.procedures ?? []).map(p => <option key={p.id} value={p.id}>{p.title} (v{p.currentVersion})</option>)}
          </select>
          <input value={newVersionForm.changeSummary} onChange={e => setNewVersionForm(p => ({ ...p, changeSummary: e.target.value }))} placeholder="What changed?" className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-change-summary" />
          <input value={newVersionForm.reasonForChange} onChange={e => setNewVersionForm(p => ({ ...p, reasonForChange: e.target.value }))} placeholder="Why the change?" className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-change-reason" />
          <input value={newVersionForm.performanceImpact} onChange={e => setNewVersionForm(p => ({ ...p, performanceImpact: e.target.value }))} placeholder="Expected performance impact…" className="col-span-2 h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-perf-impact" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => versionMutation.mutate()} disabled={!newVersionForm.procedureId || !newVersionForm.changeSummary || versionMutation.isPending} data-testid="button-create-version">
            {versionMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
            Create Version
          </Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-4">
          {(data?.procedures ?? []).map(proc => (
            <div key={proc.id} className="p-4 rounded-xl border bg-card" data-testid={`version-proc-${proc.id}`}>
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="h-4 w-4 text-primary shrink-0" />
                <p className="text-xs font-bold flex-1">{proc.title}</p>
                <DeptBadge d={proc.department} />
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">v{proc.currentVersion}</Badge>
              </div>
              <div className="space-y-2 pl-6 border-l-2 border-muted ml-2">
                {[...proc.versions].reverse().map((v, i) => (
                  <div key={v.id} className={`p-2.5 rounded-lg ${i === 0 ? "bg-primary/5 border border-primary/20" : "bg-muted/20"}`} data-testid={`version-entry-${v.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={i === 0 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">v{v.versionNumber}</Badge>
                      {i === 0 && <span className="text-[8px] text-primary font-semibold">Current</span>}
                      <span className="text-[8px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                    </div>
                    <p className="text-[9px] font-semibold">{v.changeSummary}</p>
                    {v.reasonForChange && <p className="text-[8px] text-muted-foreground mt-0.5">Reason: {v.reasonForChange}</p>}
                    {v.performanceImpact && <p className="text-[8px] text-emerald-600 dark:text-emerald-400 mt-0.5">Impact: {v.performanceImpact}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Checklists ──────────────────────────────────────────────────────────

function ChecklistsTab() {
  const { data, isLoading } = useQuery<LibraryData>({ queryKey: ["/api/procedures/library"], staleTime: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);

  const procs = data?.procedures ?? [];
  const selectedProc = procs.find(p => p.id === selected);

  return (
    <div className="space-y-4" data-testid="tab-checklists">
      <p className="text-[9px] text-muted-foreground">Select a procedure to view its auto-generated checklist. Check off steps as they are completed.</p>
      <div className="flex flex-wrap gap-1.5">
        {procs.map(p => (
          <button key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)} data-testid={`checklist-select-${p.id}`}
            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium transition-colors flex items-center gap-1.5 ${selected === p.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted/20"}`}>
            <ClipboardList className="h-2.5 w-2.5" />
            {p.title.replace(" SOP", "").substring(0, 28)}{p.title.length > 35 ? "…" : ""}
          </button>
        ))}
      </div>

      {isLoading && <Skeleton className="h-48 rounded-xl" />}

      {selectedProc && <SopCard proc={selectedProc} showSteps />}

      {!selected && !isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">Select a procedure above to generate its checklist.</div>
      )}
    </div>
  );
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({ queryKey: ["/api/procedures/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-procs">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total SOPs",        value: data?.totalProcedures ?? "—",                               color: "text-primary" },
          { label: "Active SOPs",       value: data?.activeProcedures ?? "—",                              color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Avg Compliance",    value: data ? `${data.avgComplianceScore}%` : "—",                 color: data && data.avgComplianceScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          { label: "Total Executions",  value: data?.totalExecutions ?? "—",                               color: "text-blue-600 dark:text-blue-400" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`analytics-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Most used */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Most Executed SOPs</p>
              <div className="space-y-2.5">
                {data.mostUsedSops.map((sop, i) => (
                  <div key={sop.id} className="flex items-center gap-2" data-testid={`most-used-${i}`}>
                    <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                    <p className="text-[9px] flex-1 truncate">{sop.title.replace(" SOP", "")}</p>
                    <div className="flex items-center gap-2 shrink-0 text-[9px]">
                      <span className="font-bold">{sop.executionCount}</span>
                      <ComplianceScore score={sop.complianceScore} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Highest ROI */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Highest ROI SOPs</p>
              <div className="space-y-2.5">
                {data.highestRoiSops.map((sop, i) => (
                  <div key={sop.id} className="flex items-center gap-2" data-testid={`highest-roi-${i}`}>
                    <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                    <p className="text-[9px] flex-1 truncate">{sop.title.replace(" SOP", "")}</p>
                    <DeptBadge d={sop.department} />
                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{sop.roi}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Needs review */}
          {data.needsReview.length > 0 && (
            <div className="p-4 rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <p className="text-[9px] text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />Procedures Needing Review (compliance &lt;90%)
              </p>
              <div className="space-y-1.5">
                {data.needsReview.map(p => (
                  <div key={p.id} className="flex items-center gap-2" data-testid={`needs-review-${p.id}`}>
                    <ClipboardList className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <p className="text-[9px] flex-1 truncate">{p.title}</p>
                    <DeptBadge d={p.department} />
                    <ComplianceScore score={p.complianceScore} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By department */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">SOPs by Department</p>
            <div className="space-y-2">
              {Object.entries(data.byDepartment).sort((a, b) => b[1] - a[1]).map(([dept, count]) => {
                const max = Math.max(...Object.values(data.byDepartment));
                return (
                  <div key={dept} className="flex items-center gap-2">
                    <span className="text-[9px] w-28 shrink-0 truncate">{dept}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminProceduresPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showCreate, setShowCreate] = useState(false);
  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/procedures/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-procedures">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/organizational-memory">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Organizational Memory
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            SOP Operating System
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Knowledge into execution — all organizational procedures, checklists, compliance tracking, and version control in one system.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overview && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "Active SOPs",  value: overview.active,                        color: "text-primary" },
                { label: "Compliance",   value: `${overview.avgComplianceScore}%`,       color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Executions",   value: overview.totalExecutions,               color: "text-blue-600 dark:text-blue-400" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setActiveTab("builder")} data-testid="button-new-sop">
            <Plus className="h-4 w-4" />New SOP
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Task Marketplace",     href: "/admin/agent-tasks"           },
          { label: "Organizational Memory",href: "/admin/organizational-memory" },
          { label: "SOP System",           href: null                           },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="procedures-status-bar">
        {[
          { label: "Active SOPs",      value: overview?.active ?? "—",              color: "text-primary",                                  icon: <ClipboardList className="h-3.5 w-3.5 text-primary"      />, tab: "library"    as TabId },
          { label: "Compliance Score", value: overview ? `${overview.avgComplianceScore}%` : "—", color: "text-emerald-600 dark:text-emerald-400", icon: <Shield className="h-3.5 w-3.5 text-emerald-500" />, tab: "compliance"  as TabId },
          { label: "Needs Review",     value: overview?.needsReview ?? "—",         color: (overview?.needsReview ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, tab: "analytics" as TabId },
          { label: "Total Executions", value: overview?.totalExecutions ?? "—",     color: "text-blue-600 dark:text-blue-400",               icon: <Activity      className="h-3.5 w-3.5 text-blue-500"    />, tab: "execution"   as TabId },
        ].map(stat => (
          <button key={stat.label} onClick={() => setActiveTab(stat.tab)} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left" data-testid={`stat-${stat.tab}`}>
            <div className="p-1.5 rounded-lg bg-muted shrink-0">{stat.icon}</div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${stat.color}`}>{stat.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-procs">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-96">
        {activeTab === "overview"   && <OverviewTab />}
        {activeTab === "library"    && <LibraryTab />}
        {activeTab === "builder"    && <BuilderTab />}
        {activeTab === "execution"  && <ExecutionTab />}
        {activeTab === "compliance" && <ComplianceTab />}
        {activeTab === "versions"   && <VersionsTab />}
        {activeTab === "checklists" && <ChecklistsTab />}
        {activeTab === "analytics"  && <AnalyticsTab />}
      </div>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-orange-500/5" data-testid="architecture-complete-19-4">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Standardized Operations — Phase 19.4 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">Knowledge explains what works. Procedures ensure it happens consistently. Every department now operates from documented, versioned, compliance-tracked standards.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace","Org Memory","SOP System",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 21 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
                  {i + 1}. {layer}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
