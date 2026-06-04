import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, CheckSquare, ChevronRight, Layers, RefreshCw,
  AlertTriangle, Clock, CheckCircle, Play, X, ArrowRightLeft,
  BarChart3, GitBranch, Users, Bot, TrendingUp, Activity,
  Plus, Shield,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Task = {
  id: string; title: string; description: string;
  createdByAgent: string; assignedToAgent: string;
  department: string; taskType: string; priority: string; status: string;
  dueDate: string | null; estimatedEffort: string | null; actualEffort: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null;
};
type TaskData = { tasks: Task[]; counts: Record<string, number>; total: number; generatedAt: string };

type Dep = { id: string; taskId: string; dependsOnTaskId: string; dependencyType: string; status: string; blockedTask: string; blockedBy: string };
type DepData = { dependencies: Dep[]; criticalPath: string[]; blockedCount: number; total: number; generatedAt: string };

type DeptStat = { department: string; created: number; completed: number; inProgress: number; blocked: number; sla: number; throughput: number };
type AgentProd  = { agent: string; tasksCompleted: number; avgTime: string; successScore: number; activeNow: number };
type Analytics  = { tasksCreated: number; tasksCompleted: number; completionRate: number; avgCompletionTimeHours: number; slaCompliance: number; escalationRate: number; blockedTasks: number; avgVerificationScore: number; departmentStats: DeptStat[]; agentProductivity: AgentProd[]; crossDeptHandoffs: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PriorityBadge({ p }: { p: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[p] ?? "bg-muted text-muted-foreground"}`}>{p}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { draft: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", pending_acceptance: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", accepted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", in_progress: "bg-primary/10 text-primary", blocked: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", escalated: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", archived: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s.replace("_", " ")}</Badge>;
}

function TypeBadge({ t }: { t: string }) {
  const cfg: Record<string, string> = { research: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", outreach: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", analysis: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", scheduling: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300", intervention: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", reporting: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", verification: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", maintenance: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", general: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[t] ?? "bg-muted text-muted-foreground"}`}>{t}</Badge>;
}

function AgentAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Agent": "bg-emerald-500", "Email Agent": "bg-blue-500", "Research Agent": "bg-amber-500", "Scheduling Agent": "bg-teal-500", "PAIL Engine": "bg-indigo-500", "CEO Heartbeat": "bg-primary", "Intelligence Engine": "bg-rose-500", "Platform Brain": "bg-orange-500", "Customer Success Agent": "bg-cyan-500", "Autonomy Engine": "bg-pink-500", "Human Admin": "bg-slate-600" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  const sizeClass = size === "xs" ? "h-5 w-5 text-[8px]" : "h-7 w-7 text-[10px]";
  return <div className={`${sizeClass} ${color} rounded-full flex items-center justify-center text-white font-bold shrink-0`}>{initials}</div>;
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "board",      label: "Task Board",        icon: CheckSquare  },
  { id: "assigned",   label: "Assigned",          icon: Users        },
  { id: "pending",    label: "Pending Acceptance",icon: Clock        },
  { id: "progress",   label: "In Progress",       icon: Play         },
  { id: "completed",  label: "Completed",         icon: CheckCircle  },
  { id: "blocked",    label: "Blocked",           icon: AlertTriangle},
  { id: "deps",       label: "Dependencies",      icon: GitBranch    },
  { id: "analytics",  label: "Analytics",         icon: BarChart3    },
] as const;
type TabId = typeof TABS[number]["id"];

const AGENTS = ["Research Agent","Email Agent","Revenue Agent","Scheduling Agent","Intelligence Engine","Platform Brain","PAIL Engine","AI COO"];
const DEPARTMENTS = ["Revenue","Operations","Marketing","Customer Success","Intelligence","Engineering","Partnerships"];

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", description: "", assignedToAgent: AGENTS[0], department: DEPARTMENTS[0], taskType: "research", priority: "medium", estimatedEffort: "2h", dueDate: "" });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-tasks/create", { ...form, createdByAgent: "Human Admin" }),
    onSuccess: () => { toast({ title: "Task created and assigned" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="create-task-modal">
      <div className="bg-background rounded-2xl border shadow-xl w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Create New Task</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-modal"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-2.5">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Task title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-task-title" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Task description and success criteria…" className="w-full h-20 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="input-task-description" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Assign To</p>
              <select value={form.assignedToAgent} onChange={e => setForm(p => ({ ...p, assignedToAgent: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-assign-agent">
                {AGENTS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Department</p>
              <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-department">
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Priority</p>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-priority">
                {["low","medium","high","critical"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Task Type</p>
              <select value={form.taskType} onChange={e => setForm(p => ({ ...p, taskType: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-task-type">
                {["research","outreach","analysis","scheduling","intervention","reporting","verification","maintenance","general"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Est. Effort</p>
              <input value={form.estimatedEffort} onChange={e => setForm(p => ({ ...p, estimatedEffort: e.target.value }))} placeholder="e.g. 2h" className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-estimated-effort" />
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Due Date</p>
              <input type="datetime-local" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-due-date" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-create">Cancel</Button>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending} data-testid="button-confirm-create">
            {createMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Create Task
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, compact = false }: { task: Task; compact?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/agent-tasks/tasks"] });

  const acceptMutation = useMutation({ mutationFn: () => apiRequest("POST", "/api/agent-tasks/accept", { taskId: task.id }), onSuccess: () => { toast({ title: "Task accepted" }); invalidate(); } });
  const completeMutation = useMutation({ mutationFn: () => apiRequest("POST", "/api/agent-tasks/complete", { taskId: task.id, outcomeSummary: "Task completed by agent." }), onSuccess: () => { toast({ title: "Task marked complete" }); invalidate(); } });
  const rejectMutation = useMutation({ mutationFn: () => apiRequest("POST", "/api/agent-tasks/reject", { taskId: task.id, reason: "Capacity not available" }), onSuccess: () => { toast({ title: "Task rejected — returned to AI COO" }); invalidate(); } });

  const PRIORITY_BORDER: Record<string, string> = { critical: "border-l-4 border-l-rose-500", high: "border-l-4 border-l-amber-400", medium: "", low: "" };
  const overdue = isOverdue(task.dueDate) && task.status !== "completed";

  return (
    <div className={`p-3.5 rounded-xl border bg-card ${PRIORITY_BORDER[task.priority] ?? ""} ${overdue ? "bg-rose-50/30 dark:bg-rose-950/20" : ""}`} data-testid={`task-card-${task.id}`}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold leading-tight mb-1">{task.title}</p>
          <div className="flex flex-wrap gap-1 items-center">
            <StatusBadge s={task.status} />
            <PriorityBadge p={task.priority} />
            <TypeBadge t={task.taskType} />
            {overdue && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">Overdue</Badge>}
          </div>
        </div>
      </div>

      {!compact && <p className="text-[9px] text-muted-foreground mb-2 line-clamp-2">{task.description}</p>}

      <div className="flex items-center gap-2 mb-2.5">
        <AgentAvatar name={task.createdByAgent} size="xs" />
        <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        <AgentAvatar name={task.assignedToAgent} size="xs" />
        <span className="text-[9px] text-muted-foreground truncate">{task.assignedToAgent}</span>
        {task.dueDate && (
          <span className={`text-[9px] ml-auto shrink-0 ${overdue ? "text-rose-500 font-bold" : "text-muted-foreground"}`}>
            {overdue ? "Overdue" : `Due ${formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}`}
          </span>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {task.status === "pending_acceptance" && (
          <>
            <Button size="sm" className="h-5 text-[8px] px-1.5 gap-0.5" onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending} data-testid={`button-accept-${task.id}`}>
              <CheckCircle className="h-2.5 w-2.5" />Accept
            </Button>
            <Button size="sm" variant="outline" className="h-5 text-[8px] px-1.5 gap-0.5" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending} data-testid={`button-reject-${task.id}`}>
              <X className="h-2.5 w-2.5" />Reject
            </Button>
          </>
        )}
        {(task.status === "accepted" || task.status === "in_progress") && (
          <Button size="sm" className="h-5 text-[8px] px-1.5 gap-0.5" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} data-testid={`button-complete-${task.id}`}>
            <CheckCircle className="h-2.5 w-2.5" />{completeMutation.isPending ? "…" : "Mark Complete"}
          </Button>
        )}
        {task.status === "blocked" && (
          <Button size="sm" variant="outline" className="h-5 text-[8px] px-1.5 gap-0.5 border-rose-200 text-rose-600" onClick={() => toast({ title: "Escalation sent to AI COO" })} data-testid={`button-escalate-${task.id}`}>
            <AlertTriangle className="h-2.5 w-2.5" />Escalate
          </Button>
        )}
        {task.estimatedEffort && (
          <span className="text-[8px] text-muted-foreground ml-auto self-center">Est: {task.estimatedEffort}{task.actualEffort ? ` · Act: ${task.actualEffort}` : ""}</span>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Task Board (Kanban) ─────────────────────────────────────────────────

function BoardTab({ tasks }: { tasks: Task[] }) {
  const COLUMNS: { id: string; label: string; statuses: string[]; color: string }[] = [
    { id: "draft",    label: "Draft",      statuses: ["draft"],                        color: "bg-slate-100 dark:bg-slate-800/50" },
    { id: "pending",  label: "Pending",    statuses: ["pending_acceptance","accepted"], color: "bg-amber-50 dark:bg-amber-950/20"  },
    { id: "active",   label: "Active",     statuses: ["in_progress"],                  color: "bg-blue-50 dark:bg-blue-950/20"    },
    { id: "blocked",  label: "Blocked",    statuses: ["blocked","escalated"],           color: "bg-rose-50 dark:bg-rose-950/20"    },
    { id: "done",     label: "Completed",  statuses: ["completed","archived"],          color: "bg-emerald-50 dark:bg-emerald-950/20" },
  ];

  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-board">
      <div className="flex gap-3 min-w-max pb-2">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => col.statuses.includes(t.status));
          return (
            <div key={col.id} className={`w-64 rounded-xl p-3 ${col.color}`} data-testid={`kanban-col-${col.id}`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide">{col.label}</p>
                <Badge variant="secondary" className="text-[8px] h-4 px-1.5">{colTasks.length}</Badge>
              </div>
              <div className="space-y-2">
                {colTasks.map(t => <TaskCard key={t.id} task={t} compact />)}
                {colTasks.length === 0 && <p className="text-[9px] text-muted-foreground text-center py-4">No tasks</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Assigned ────────────────────────────────────────────────────────────

function AssignedTab({ tasks }: { tasks: Task[] }) {
  const agentGroups = tasks.reduce((acc, t) => {
    if (!acc[t.assignedToAgent]) acc[t.assignedToAgent] = [];
    acc[t.assignedToAgent].push(t);
    return acc;
  }, {} as Record<string, Task[]>);

  const LOAD_COLOR = (n: number) => n === 0 ? "text-muted-foreground" : n <= 1 ? "text-emerald-600 dark:text-emerald-400" : n <= 3 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";

  return (
    <div className="space-y-4" data-testid="tab-assigned">
      {Object.entries(agentGroups).sort((a, b) => b[1].length - a[1].length).map(([agent, agentTasks]) => {
        const active = agentTasks.filter(t => ["in_progress","accepted"].includes(t.status)).length;
        const pending = agentTasks.filter(t => t.status === "pending_acceptance").length;
        return (
          <div key={agent} className="p-4 rounded-xl border bg-card" data-testid={`assigned-agent-${agent.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="flex items-center gap-3 mb-3">
              <AgentAvatar name={agent} />
              <div className="flex-1">
                <p className="text-xs font-bold">{agent}</p>
                <div className="flex items-center gap-3 text-[9px]">
                  <span className={LOAD_COLOR(active)}>{active} active</span>
                  {pending > 0 && <span className="text-amber-600 dark:text-amber-400">{pending} pending</span>}
                  <span className="text-muted-foreground">{agentTasks.length} total</span>
                </div>
              </div>
              {/* Load bar */}
              <div className="w-24 flex items-center gap-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${active === 0 ? "bg-muted-foreground/30" : active <= 1 ? "bg-emerald-500" : active <= 3 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(active * 25, 100)}%` }} />
                </div>
                <span className="text-[8px] text-muted-foreground shrink-0">{active}/4</span>
              </div>
            </div>
            <div className="space-y-2">
              {agentTasks.filter(t => t.status !== "completed" && t.status !== "archived").map(t => <TaskCard key={t.id} task={t} compact />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Filtered task lists ─────────────────────────────────────────────────

function FilteredTasksTab({ tasks, status, emptyMsg }: { tasks: Task[]; status: string | string[]; emptyMsg: string }) {
  const statuses = Array.isArray(status) ? status : [status];
  const filtered = tasks.filter(t => statuses.includes(t.status));
  return (
    <div className="space-y-2" data-testid={`tab-filtered-${Array.isArray(status) ? status[0] : status}`}>
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">{emptyMsg}</div>
      ) : filtered.map(t => <TaskCard key={t.id} task={t} />)}
    </div>
  );
}

// ─── Tab: Dependencies ────────────────────────────────────────────────────────

function DepsTab({ tasks }: { tasks: Task[] }) {
  const { data, isLoading } = useQuery<DepData>({ queryKey: ["/api/agent-tasks/dependencies"], staleTime: 60_000 });

  const DEP_TYPE_COLORS: Record<string, string> = { blocking: "border-rose-300 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/30", sequential: "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30", optional: "border-slate-200 bg-muted/10" };

  const getTask = (id: string) => tasks.find(t => t.id === id);

  return (
    <div className="space-y-4" data-testid="tab-deps">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-rose-500">{data.blockedCount}</p>
            <p className="text-[9px] text-muted-foreground">Blocking Dependencies</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.total}</p>
            <p className="text-[9px] text-muted-foreground">Total Dependencies</p>
          </div>
          <div className="p-3 rounded-xl border bg-card sm:col-span-1 col-span-2">
            <p className="text-[9px] text-muted-foreground mb-1.5">Critical Path</p>
            <div className="space-y-1">
              {data.criticalPath.map(p => (
                <div key={p} className="flex items-center gap-1.5 text-[9px]">
                  <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                  <span className="font-mono">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.dependencies ?? []).map(dep => {
            const blockedTask = getTask(dep.taskId);
            const sourceTask  = getTask(dep.dependsOnTaskId);
            return (
              <div key={dep.id} className={`p-4 rounded-xl border ${DEP_TYPE_COLORS[dep.dependencyType] ?? "border-muted"}`} data-testid={`dep-${dep.id}`}>
                <div className="flex items-start gap-3">
                  <GitBranch className={`h-4 w-4 shrink-0 mt-0.5 ${dep.dependencyType === "blocking" ? "text-rose-500" : dep.dependencyType === "sequential" ? "text-amber-500" : "text-muted-foreground"}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Badge className={`text-[8px] px-1.5 py-0 h-4 ${dep.dependencyType === "blocking" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" : dep.dependencyType === "sequential" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{dep.dependencyType}</Badge>
                      {dep.status === "blocking" && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">Currently Blocking</Badge>}
                      {dep.status === "resolved" && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Resolved</Badge>}
                    </div>
                    {/* Source → Blocked */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[9px]">
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        <span className="text-muted-foreground">Requires:</span>
                        <span className="font-medium">{dep.blockedBy}</span>
                        {sourceTask && <StatusBadge s={sourceTask.status} />}
                      </div>
                      <div className="flex items-center gap-2 text-[9px]">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">Before:</span>
                        <span className="font-medium">{dep.blockedTask}</span>
                        {blockedTask && <StatusBadge s={blockedTask.status} />}
                      </div>
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

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<Analytics>({ queryKey: ["/api/agent-tasks/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-tasks">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Tasks Created",     value: data?.tasksCreated ?? "—",                             color: "text-primary" },
          { label: "Completed",         value: data?.tasksCompleted ?? "—",                           color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Completion Rate",   value: data ? `${data.completionRate}%` : "—",                color: "text-blue-600 dark:text-blue-400" },
          { label: "SLA Compliance",    value: data ? `${data.slaCompliance}%` : "—",                 color: data && data.slaCompliance >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          { label: "Avg Completion",    value: data ? `${data.avgCompletionTimeHours}h` : "—",        color: "text-muted-foreground" },
          { label: "Escalation Rate",   value: data ? `${data.escalationRate}%` : "—",               color: "text-amber-600 dark:text-amber-400" },
          { label: "Blocked Tasks",     value: data?.blockedTasks ?? "—",                             color: data && data.blockedTasks > 0 ? "text-rose-500" : "text-muted-foreground" },
          { label: "Verification Score",value: data ? `${data.avgVerificationScore}/100` : "—",      color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`task-metric-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && <>
        {/* Department stats */}
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Department Performance</p>
          <div className="space-y-3">
            {data.departmentStats.filter(d => d.created > 0).map(dept => (
              <div key={dept.department} data-testid={`dept-stat-${dept.department.toLowerCase()}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold">{dept.department}</p>
                  <div className="flex items-center gap-3 text-[9px]">
                    <span className="text-emerald-600 dark:text-emerald-400">{dept.completed} done</span>
                    {dept.inProgress > 0 && <span className="text-blue-600 dark:text-blue-400">{dept.inProgress} active</span>}
                    {dept.blocked > 0 && <span className="text-rose-500">{dept.blocked} blocked</span>}
                    <span className={`font-bold ${dept.sla >= 90 ? "text-emerald-600 dark:text-emerald-400" : dept.sla >= 70 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{dept.sla}% SLA</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: dept.created > 0 ? `${(dept.completed / dept.created) * 100}%` : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent productivity */}
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Agent Productivity</p>
          <div className="space-y-2.5">
            {data.agentProductivity.map((agent, i) => (
              <div key={agent.agent} className="flex items-center gap-3" data-testid={`productivity-${i}`}>
                <AgentAvatar name={agent.agent} size="xs" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-[10px] font-medium truncate">{agent.agent}</p>
                    <div className="flex items-center gap-3 text-[9px] shrink-0">
                      <span className="text-muted-foreground">{agent.tasksCompleted} done · avg {agent.avgTime}</span>
                      {agent.activeNow > 0 && <span className="text-blue-600 dark:text-blue-400">{agent.activeNow} active</span>}
                      {agent.successScore > 0 && <span className="font-bold text-primary">{agent.successScore}/100</span>}
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: agent.successScore > 0 ? `${agent.successScore}%` : "5%" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cross-dept handoffs */}
        <div className="p-3.5 rounded-xl border bg-card flex items-center gap-3">
          <ArrowRightLeft className="h-5 w-5 text-violet-500 shrink-0" />
          <div>
            <p className="text-xs font-bold">{data.crossDeptHandoffs} Cross-Department Handoffs</p>
            <p className="text-[9px] text-muted-foreground">Tasks successfully delegated across department boundaries this week</p>
          </div>
        </div>
      </>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentTasksPage() {
  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [showCreate, setShowCreate]= useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<TaskData>({ queryKey: ["/api/agent-tasks/tasks"], staleTime: 30_000 });
  const tasks = data?.tasks ?? [];

  const pendingCount   = tasks.filter(t => t.status === "pending_acceptance").length;
  const blockedCount   = tasks.filter(t => t.status === "blocked").length;
  const progressCount  = tasks.filter(t => t.status === "in_progress").length;
  const completedCount = tasks.filter(t => t.status === "completed").length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-agent-tasks">

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/agent-tasks/tasks"] })} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/agent-communications">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Agent Communications
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Agent Task Marketplace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI workforce accountability — agents assign, accept, execute, verify, and complete work across departments with full dependency tracking and AI COO oversight.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "Total",     value: data.total,          color: "text-primary" },
                { label: "Active",    value: progressCount,       color: "text-blue-600 dark:text-blue-400" },
                { label: "Completed", value: completedCount,      color: "text-emerald-600 dark:text-emerald-400" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setShowCreate(true)} data-testid="button-create-task">
            <Plus className="h-4 w-4" />New Task
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Command Center",       href: "/admin/command-center" },
          { label: "Agent Communications", href: "/admin/agent-communications" },
          { label: "Task Marketplace",     href: null },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Status banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="task-status-banner">
        {[
          { label: "Pending Acceptance",  value: pendingCount,  color: "text-amber-600 dark:text-amber-400",    icon: <Clock          className="h-3.5 w-3.5 text-amber-500"  />, tab: "pending"  as TabId },
          { label: "In Progress",         value: progressCount, color: "text-blue-600 dark:text-blue-400",      icon: <Play           className="h-3.5 w-3.5 text-blue-500"    />, tab: "progress" as TabId },
          { label: "Blocked",             value: blockedCount,  color: blockedCount > 0 ? "text-rose-500" : "text-muted-foreground", icon: <AlertTriangle  className="h-3.5 w-3.5 text-rose-500"   />, tab: "blocked"  as TabId },
          { label: "Completed This Week", value: completedCount,color: "text-emerald-600 dark:text-emerald-400",icon: <CheckCircle    className="h-3.5 w-3.5 text-emerald-500" />, tab: "completed" as TabId },
        ].map(stat => (
          <button key={stat.label} onClick={() => setActiveTab(stat.tab)} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left" data-testid={`status-stat-${stat.tab}`}>
            <div className="p-1.5 rounded-lg bg-muted shrink-0">{stat.icon}</div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${stat.color}`}>{stat.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-tasks">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const dot = (tab.id === "pending" && pendingCount > 0) || (tab.id === "blocked" && blockedCount > 0);
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`tab-button-${tab.id}`}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
              {dot && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-rose-500" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-96">
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : <>
          {activeTab === "board"     && <BoardTab tasks={tasks} />}
          {activeTab === "assigned"  && <AssignedTab tasks={tasks} />}
          {activeTab === "pending"   && <FilteredTasksTab tasks={tasks} status="pending_acceptance"       emptyMsg="No tasks pending acceptance." />}
          {activeTab === "progress"  && <FilteredTasksTab tasks={tasks} status="in_progress"              emptyMsg="No tasks currently in progress." />}
          {activeTab === "completed" && <FilteredTasksTab tasks={tasks} status={["completed","archived"]} emptyMsg="No completed tasks yet." />}
          {activeTab === "blocked"   && <FilteredTasksTab tasks={tasks} status={["blocked","escalated"]}  emptyMsg="No blocked tasks — all clear!" />}
          {activeTab === "deps"      && <DepsTab tasks={tasks} />}
          {activeTab === "analytics" && <AnalyticsTab />}
        </>}
      </div>

      {/* Forward nav → Organizational Memory */}
      <Link href="/admin/organizational-memory">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-organizational-memory">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Shared Organizational Memory &amp; Knowledge Network</p>
            <p className="text-xs text-muted-foreground mt-0.5">Decisions, lessons, playbooks, policies, and research — the institutional memory that makes every agent smarter over time.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-indigo-500/5" data-testid="architecture-complete-19-2">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Accountable AI Workforce — Phase 19.2 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">Communication moves information. Tasks move outcomes. Agents now delegate, accept, execute, verify, and complete real work with ownership, deadlines, dependencies, and full AI COO oversight.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 19 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
