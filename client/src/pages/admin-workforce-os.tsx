import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Users, GitBranch, Star, Activity, Target, TrendingUp,
  BookOpen, DollarSign, Briefcase, BarChart3, ChevronRight,
  CheckCircle, AlertTriangle, Clock, Zap, ArrowUpRight, UserPlus,
  UserMinus, RefreshCw, Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmpStatus = "active" | "on_leave" | "retired";
type DigEmp = { id: string; name: string; role: string; level: string; department: string; manager: string; hireDate: string; status: EmpStatus; performanceScore: number; trustScore: number; workloadPct: number; toolAccess: string[]; revenue30d: number; actionsLast30d: number; successRate: number; avatar: string };
type EmployeesData = { employees: DigEmp[]; totalRevenue: number; avgPerformanceScore: number; overloadedCount: number; underutilizedCount: number; generatedAt: string };
type OrgNode = { name: string; role: string; performanceScore: number; trustScore: number; avatar: string; children: OrgNode[] };
type OrgData = { tree: OrgNode; generatedAt: string };
type Review = { weekly: any; monthly: any; quarterly: any; employeeId: string; employeeName: string; avatar: string; role: string };
type ReviewsData = { reviews: Review[]; generatedAt: string };
type Workload = { employeeId: string; employeeName: string; avatar: string; role: string; department: string; capacityPct: number; activeAssignments: number; throughputPerDay: number; queueSize: number; status: string; recommendation: string };
type WorkloadsData = { workloads: Workload[]; overloaded: number; underutilized: number; healthy: number; generatedAt: string };
type Goal = { id: string; employeeId: string; employeeName: string; avatar: string; objective: string; target: number; current: number; unit: string; deadline: string; status: string; forecast: string };
type GoalsData = { goals: Goal[]; onTrack: number; atRisk: number; behind: number; avgCompletion: number; generatedAt: string };
type PromPath = { employeeId: string; name: string; avatar: string; currentLevel: string; nextLevel: string; performanceCriteria: number; trustCriteria: number; impactCriteria: number; eligibilityScore: number; readyForPromotion: boolean; path: string[]; promotionEta: string };
type PromData = { paths: PromPath[]; readyNow: number; generatedAt: string };
type TrainingEntry = { employeeId: string; name: string; avatar: string; skills: { skill: string; level: number }[]; recommendations: string[]; trainingHistory: string[] };
type TrainingData = { training: TrainingEntry[]; generatedAt: string };
type CompEntry = { employeeId: string; name: string; avatar: string; role: string; level: string; revenueGenerated: number; equivalentEmployeeCost: number; roi: number; surplus: number };
type CompData = { compensation: CompEntry[]; totalGenerated: number; totalEquivalentCost: number; platformRoi: number; annualizedGenerated: number; annualizedCost: number; generatedAt: string };
type PlanGap = { role: string; department: string; priority: string; reason: string; estimatedRevImpact: string; readinessScore: number };
type PlanForecast = { quarter: string; hires: number; projected: string[]; estimatedRevLift: number };
type PlanData = { gaps: PlanGap[]; forecast: PlanForecast[]; currentHeadcount: number; recommendedHeadcount: number; capacityUtilization: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = { "C-Suite": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", Director: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Senior: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", Mid: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", Junior: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[level] ?? "bg-muted text-muted-foreground"}`}>{level}</Badge>;
}

function ScoreBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  const auto = value >= 90 ? "bg-emerald-500" : value >= 75 ? "bg-blue-500" : value >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${color === "bg-primary" ? auto : color}`} style={{ width: `${Math.min(value, 100)}%` }} /></div>
      <span className="text-[9px] font-bold text-muted-foreground w-6">{value}</span>
    </div>
  );
}

function RatingBadge({ r }: { r: string }) {
  const cfg: Record<string, string> = { Exceptional: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", Strong: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", "Needs Improvement": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[r] ?? "bg-muted text-muted-foreground"}`}>{r}</Badge>;
}

function GoalStatus({ s }: { s: string }) {
  const cfg: Record<string, string> = { on_track: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", at_risk: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", behind: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  const labels: Record<string, string> = { on_track: "On Track", at_risk: "At Risk", behind: "Behind" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{labels[s] ?? s}</Badge>;
}

function SkillDots({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full ${i < level ? "bg-primary" : "bg-muted"}`} />
      ))}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "directory",    label: "Directory",    icon: Users },
  { id: "orgchart",     label: "Org Chart",    icon: GitBranch },
  { id: "reviews",      label: "Reviews",      icon: Star },
  { id: "workloads",    label: "Workloads",    icon: Activity },
  { id: "goals",        label: "Goals",        icon: Target },
  { id: "promotions",   label: "Promotions",   icon: TrendingUp },
  { id: "training",     label: "Training",     icon: BookOpen },
  { id: "compensation", label: "Compensation", icon: DollarSign },
  { id: "hr",           label: "HR",           icon: Briefcase },
  { id: "planning",     label: "Planning",     icon: BarChart3 },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Directory ───────────────────────────────────────────────────────────

function DirectoryTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<EmployeesData>({ queryKey: ["/api/workforce-os/employees"], staleTime: 60_000 });
  const [dept, setDept] = useState("all");
  const depts = [...new Set((data?.employees ?? []).map(e => e.department))];
  const filtered = (data?.employees ?? []).filter(e => dept === "all" || e.department === dept);

  return (
    <div className="space-y-4" data-testid="tab-directory">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Employees",  value: data.employees.length,                              color: "text-primary",                                  onClick: () => {} },
            { label: "Revenue (30d)",    value: `$${(data.totalRevenue / 1000).toFixed(0)}k`,       color: "text-emerald-600 dark:text-emerald-400",         onClick: () => setTab("compensation") },
            { label: "Avg Performance",  value: data.avgPerformanceScore,                           color: data.avgPerformanceScore >= 85 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400", onClick: () => setTab("reviews") },
            { label: "Overloaded",       value: data.overloadedCount,                               color: data.overloadedCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground", onClick: () => setTab("workloads") },
          ].map(m => (
            <button key={m.label} onClick={m.onClick} className="p-3 rounded-xl border bg-card text-center hover:bg-muted/30 transition-colors group" data-testid={`dir-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", ...depts].map(d => (
          <button key={d} onClick={() => setDept(d)} data-testid={`filter-dept-${d.toLowerCase()}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${dept === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{d === "all" ? "All Depts" : d}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(emp => (
            <div key={emp.id} className="p-4 rounded-xl border bg-card" data-testid={`emp-card-${emp.id}`}>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0">{emp.avatar}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-bold">{emp.name}</p>
                    <LevelBadge level={emp.level} />
                    <Badge variant={emp.status === "active" ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4 capitalize">{emp.status}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1 truncate">{emp.role}</p>
                  <p className="text-[9px] text-muted-foreground">{emp.department} · Reports to {emp.manager}</p>
                  <p className="text-[9px] text-muted-foreground">Hired {formatDistanceToNow(new Date(emp.hireDate), { addSuffix: true })}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-[9px]">
                <div>
                  <p className="text-muted-foreground mb-0.5">Performance</p>
                  <ScoreBar value={emp.performanceScore} />
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Trust</p>
                  <ScoreBar value={emp.trustScore} />
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Workload</p>
                  <ScoreBar value={emp.workloadPct} color={emp.workloadPct >= 90 ? "bg-amber-500" : emp.workloadPct <= 40 ? "bg-slate-400" : "bg-blue-500"} />
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t">
                <span className="text-[9px] text-muted-foreground">{emp.actionsLast30d.toLocaleString()} actions · {emp.successRate}% success</span>
                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">${emp.revenue30d.toLocaleString()}/mo</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Org Chart ───────────────────────────────────────────────────────────

function OrgChartTab() {
  const { data, isLoading } = useQuery<OrgData>({ queryKey: ["/api/workforce-os/orgchart"], staleTime: 60_000 });

  function OrgNode({ node, depth }: { node: OrgNode; depth: number }) {
    const borderColor = node.performanceScore >= 90 ? "border-emerald-300 dark:border-emerald-700" : node.performanceScore >= 75 ? "border-blue-300 dark:border-blue-700" : "border-amber-300 dark:border-amber-700";
    return (
      <div className={`flex flex-col items-center ${depth > 0 ? "mt-4" : ""}`} data-testid={`orgnode-${node.name.replace(/\s+/g, "-").toLowerCase()}`}>
        <div className={`relative px-3 py-2 rounded-xl border-2 ${borderColor} bg-card shadow-sm min-w-28 text-center`}>
          <p className="text-lg leading-none mb-0.5">{node.avatar}</p>
          <p className="text-[10px] font-bold">{node.name}</p>
          <p className="text-[8px] text-muted-foreground mb-1">{node.role}</p>
          <div className="flex justify-center gap-2 text-[8px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{node.performanceScore}</span>
            <span className="text-muted-foreground">perf</span>
            <span className="text-blue-600 dark:text-blue-400 font-bold">{node.trustScore}</span>
            <span className="text-muted-foreground">trust</span>
          </div>
        </div>
        {node.children.length > 0 && (
          <>
            <div className="w-px h-4 bg-border" />
            <div className="relative flex gap-4 items-start">
              {node.children.length > 1 && <div className="absolute top-0 left-0 right-0 h-px bg-border" style={{ top: "1px" }} />}
              {node.children.map((child, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className="w-px h-4 bg-border" />
                  <OrgNode node={child} depth={depth + 1} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="tab-orgchart">
      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="rounded-xl border bg-card overflow-x-auto p-6">
          {data && <OrgNode node={data.tree} depth={0} />}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Reviews ─────────────────────────────────────────────────────────────

function ReviewsTab() {
  const { data, isLoading } = useQuery<ReviewsData>({ queryKey: ["/api/workforce-os/reviews"], staleTime: 60_000 });
  const [period, setPeriod] = useState<"weekly" | "monthly" | "quarterly">("monthly");

  const METRICS = ["productivity", "successRate", "revenueImpact", "goalCompletion", "trustScore"];
  const METRIC_LABELS: Record<string, string> = { productivity: "Productivity", successRate: "Success Rate", revenueImpact: "Revenue Impact ($)", goalCompletion: "Goal Completion", trustScore: "Trust Score" };

  return (
    <div className="space-y-4" data-testid="tab-reviews">
      <div className="flex gap-1.5">
        {(["weekly", "monthly", "quarterly"] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)} data-testid={`review-period-${p}`}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium capitalize transition-colors ${period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{p}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.reviews ?? []).map(rev => {
            const r = rev[period];
            return (
              <div key={rev.employeeId} className="p-4 rounded-xl border bg-card" data-testid={`review-${rev.employeeId}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xl">{rev.avatar}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-bold">{rev.employeeName}</p>
                      <RatingBadge r={r.rating} />
                    </div>
                    <p className="text-[9px] text-muted-foreground">{rev.role} · Reviewed {formatDistanceToNow(new Date(r.reviewedAt), { addSuffix: true })}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[9px]">
                  {METRICS.map(m => (
                    <div key={m}>
                      <p className="text-muted-foreground mb-0.5">{METRIC_LABELS[m]}</p>
                      {m === "revenueImpact"
                        ? <p className="font-bold text-emerald-600 dark:text-emerald-400">${r[m].toLocaleString()}</p>
                        : <ScoreBar value={Math.min(r[m], 100)} />}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Workloads ───────────────────────────────────────────────────────────

function WorkloadsTab() {
  const { data, isLoading } = useQuery<WorkloadsData>({ queryKey: ["/api/workforce-os/workloads"], staleTime: 60_000 });

  const STATUS_COLORS: Record<string, string> = { overloaded: "border-amber-200 dark:border-amber-900 bg-amber-500/5", underutilized: "border-slate-200 dark:border-slate-700 bg-slate-500/5", healthy: "" };
  const STATUS_ICONS: Record<string, any> = { overloaded: AlertTriangle, underutilized: Zap, healthy: CheckCircle };
  const STATUS_COLORS2: Record<string, string> = { overloaded: "text-amber-500", underutilized: "text-slate-400", healthy: "text-emerald-500" };

  return (
    <div className="space-y-4" data-testid="tab-workloads">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Overloaded",   value: data.overloaded,   color: data.overloaded > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
            { label: "Healthy",      value: data.healthy,      color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Underutilized",value: data.underutilized,color: data.underutilized > 0 ? "text-slate-500" : "text-muted-foreground" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.workloads ?? []).map(w => {
            const Icon = STATUS_ICONS[w.status] ?? CheckCircle;
            return (
              <div key={w.employeeId} className={`p-4 rounded-xl border bg-card ${STATUS_COLORS[w.status]}`} data-testid={`workload-${w.employeeId}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${STATUS_COLORS2[w.status]}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-xs font-semibold">{w.employeeName}</p>
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{w.department}</Badge>
                      <span className={`text-[9px] font-medium capitalize ml-auto ${STATUS_COLORS2[w.status]}`}>{w.status.replace("_", " ")}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mb-2 text-[9px]">
                      {[
                        { label: "Capacity",    value: `${w.capacityPct}%` },
                        { label: "Assignments", value: w.activeAssignments },
                        { label: "Throughput",  value: `${w.throughputPerDay}/day` },
                        { label: "Queue",       value: w.queueSize },
                      ].map(m => (
                        <div key={m.label}>
                          <p className="text-muted-foreground">{m.label}</p>
                          <p className="font-bold">{m.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mb-1">
                      <div className={`h-2 rounded-full bg-muted overflow-hidden`}>
                        <div className={`h-full rounded-full ${w.capacityPct >= 90 ? "bg-amber-500" : w.capacityPct <= 40 ? "bg-slate-400" : "bg-emerald-500"}`} style={{ width: `${w.capacityPct}%` }} />
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground">{w.recommendation}</p>
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

// ─── Tab: Goals ───────────────────────────────────────────────────────────────

function GoalsTab() {
  const { data, isLoading } = useQuery<GoalsData>({ queryKey: ["/api/workforce-os/goals"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-goals">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "On Track",         value: data.onTrack,         color: "text-emerald-600 dark:text-emerald-400" },
            { label: "At Risk",          value: data.atRisk,          color: "text-amber-600 dark:text-amber-400" },
            { label: "Behind",           value: data.behind,          color: "text-rose-600 dark:text-rose-400" },
            { label: "Avg Completion",   value: `${data.avgCompletion}%`, color: "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.goals ?? []).map(g => {
            const pct = Math.min(Math.round((g.current / g.target) * 100), 100);
            return (
              <div key={g.id} className="p-4 rounded-xl border bg-card" data-testid={`goal-${g.id}`}>
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0">{g.avatar}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-xs font-semibold">{g.employeeName}</p>
                      <GoalStatus s={g.status} />
                      <span className="text-[9px] text-muted-foreground ml-auto">Due {formatDistanceToNow(new Date(g.deadline), { addSuffix: true })}</span>
                    </div>
                    <p className="text-xs mb-2">{g.objective}</p>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${g.status === "on_track" ? "bg-emerald-500" : g.status === "at_risk" ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] font-bold shrink-0">{pct}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>{typeof g.current === "number" && g.unit === "$" ? `$${g.current.toLocaleString()}` : `${g.current} ${g.unit}`} of {g.unit === "$" ? `$${g.target.toLocaleString()}` : `${g.target} ${g.unit}`}</span>
                      <span className="italic">{g.forecast}</span>
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

// ─── Tab: Promotions ──────────────────────────────────────────────────────────

function PromotionsTab() {
  const { data, isLoading } = useQuery<PromData>({ queryKey: ["/api/workforce-os/promotions"], staleTime: 60_000 });
  const { toast } = useToast();
  const qc = useQueryClient();

  const promoteMutation = useMutation({
    mutationFn: (p: PromPath) => apiRequest("POST", "/api/workforce-os/promote", { employeeId: p.employeeId, newLevel: p.nextLevel }),
    onSuccess: (_d, p) => { qc.invalidateQueries({ queryKey: ["/api/workforce-os/employees"] }); qc.invalidateQueries({ queryKey: ["/api/workforce-os/promotions"] }); toast({ title: `${p.name} promoted to ${p.nextLevel}!` }); },
    onError: () => toast({ title: "Promotion failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="tab-promotions">
      {data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5">
          <TrendingUp className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs"><span className="font-bold text-primary">{data.readyNow}</span> agent{data.readyNow !== 1 ? "s" : ""} ready for promotion now based on performance, trust, and impact criteria.</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.paths ?? []).map(p => (
            <div key={p.employeeId} className={`p-4 rounded-xl border bg-card ${p.readyForPromotion ? "border-emerald-200 dark:border-emerald-800 bg-emerald-500/5" : ""}`} data-testid={`promo-${p.employeeId}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{p.avatar}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-bold">{p.name}</p>
                    <LevelBadge level={p.currentLevel} />
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <LevelBadge level={p.nextLevel} />
                    {p.readyForPromotion && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Ready Now</Badge>}
                  </div>

                  <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1">
                    {p.path.map((step, i) => (
                      <div key={step} className="flex items-center gap-1 shrink-0">
                        {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${step === p.currentLevel ? "bg-primary text-primary-foreground font-bold" : step === p.nextLevel ? "bg-muted text-foreground font-medium" : "text-muted-foreground"}`}>{step}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-2 text-[9px]">
                    {[
                      { label: "Performance",  value: p.performanceCriteria },
                      { label: "Trust",        value: p.trustCriteria },
                      { label: "Eligibility",  value: p.eligibilityScore },
                    ].map(m => (
                      <div key={m.label}>
                        <p className="text-muted-foreground mb-0.5">{m.label}</p>
                        <ScoreBar value={m.value} />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{p.promotionEta}</span>
                    {p.readyForPromotion && (
                      <Button size="sm" className="h-7 gap-1 text-[10px]" onClick={() => promoteMutation.mutate(p)} disabled={promoteMutation.isPending} data-testid={`button-promote-${p.employeeId}`}>
                        <TrendingUp className="h-3 w-3" />Promote Now
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Training ────────────────────────────────────────────────────────────

function TrainingTab() {
  const { data, isLoading } = useQuery<TrainingData>({ queryKey: ["/api/workforce-os/training"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-training">
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.training ?? []).map(t => (
            <div key={t.employeeId} className="p-4 rounded-xl border bg-card" data-testid={`training-${t.employeeId}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">{t.avatar}</span>
                <div>
                  <p className="text-xs font-bold">{t.name}</p>
                  <p className="text-[9px] text-muted-foreground">{t.skills.length} tracked skills</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Skill Levels</p>
                  <div className="space-y-1.5">
                    {t.skills.map(s => (
                      <div key={s.skill} className="flex items-center gap-2" data-testid={`skill-${t.employeeId}-${s.skill.replace(/\s+/g, "-").toLowerCase()}`}>
                        <span className="text-[9px] text-muted-foreground w-28 truncate shrink-0">{s.skill}</span>
                        <SkillDots level={s.level} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Recommendations</p>
                  <div className="space-y-1.5">
                    {t.recommendations.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <ArrowUpRight className="h-2.5 w-2.5 text-primary shrink-0 mt-0.5" />
                        <p className="text-[9px]">{r}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-2 mb-1.5">Training History</p>
                  <div className="space-y-1">
                    {t.trainingHistory.map((h, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <CheckCircle className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                        <p className="text-[9px] text-muted-foreground">{h}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Compensation ────────────────────────────────────────────────────────

function CompensationTab() {
  const { data, isLoading } = useQuery<CompData>({ queryKey: ["/api/workforce-os/compensation"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-compensation">
      {data && (
        <div className="p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Platform ROI vs Equivalent Human Workforce</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Revenue Generated", value: `$${(data.totalGenerated / 1000).toFixed(0)}k/mo`,    color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Equiv. Staff Cost",  value: `$${(data.totalEquivalentCost / 1000).toFixed(0)}k/mo`, color: "text-muted-foreground" },
              { label: "Platform ROI",       value: `${data.platformRoi}%`,                               color: "text-primary" },
              { label: "Annual Revenue",     value: `$${(data.annualizedGenerated / 1000).toFixed(0)}k`,  color: "text-emerald-600 dark:text-emerald-400" },
            ].map(m => (
              <div key={m.label}>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
                <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-7 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
            <span className="col-span-2">Employee</span>
            <span className="col-span-1 text-right">Revenue</span>
            <span className="col-span-1 text-right">Equiv Cost</span>
            <span className="col-span-1 text-right">ROI</span>
            <span className="col-span-2 text-right">Surplus</span>
          </div>
          <div className="divide-y">
            {(data?.compensation ?? []).sort((a, b) => b.roi - a.roi).map(c => (
              <div key={c.employeeId} className="grid grid-cols-7 items-center px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`comp-${c.employeeId}`}>
                <div className="col-span-2 flex items-center gap-2">
                  <span className="text-base">{c.avatar}</span>
                  <div>
                    <p className="text-xs font-medium">{c.name}</p>
                    <LevelBadge level={c.level} />
                  </div>
                </div>
                <span className="col-span-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 text-right">${c.revenueGenerated.toLocaleString()}</span>
                <span className="col-span-1 text-xs text-muted-foreground text-right">${c.equivalentEmployeeCost.toLocaleString()}</span>
                <span className={`col-span-1 text-xs font-bold text-right ${c.roi >= 150 ? "text-emerald-600 dark:text-emerald-400" : c.roi >= 100 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>{c.roi}%</span>
                <span className="col-span-2 text-xs font-bold text-right text-emerald-600 dark:text-emerald-400">+${c.surplus.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: HR ──────────────────────────────────────────────────────────────────

function HrTab() {
  const { data, isLoading } = useQuery<EmployeesData>({ queryKey: ["/api/workforce-os/employees"], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [hireRole, setHireRole] = useState("");
  const [hireDept, setHireDept] = useState("Revenue");
  const [selectedEmp, setSelectedEmp] = useState("");
  const [reassignDept, setReassignDept] = useState("Operations");

  const hireMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/workforce-os/hire", { roleName: hireRole, department: hireDept }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/workforce-os/employees"] }); toast({ title: `${hireRole} hired successfully` }); setHireRole(""); },
    onError: () => toast({ title: "Hire failed", variant: "destructive" }),
  });

  const retireMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/workforce-os/retire", { employeeId: id }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["/api/workforce-os/employees"] }); toast({ title: "Agent retired", description: "Responsibilities reassigned automatically." }); },
    onError: () => toast({ title: "Retire failed", variant: "destructive" }),
  });

  const reassignMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/workforce-os/reassign", { employeeId: selectedEmp, newDepartment: reassignDept }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/workforce-os/employees"] }); toast({ title: `Agent reassigned to ${reassignDept}` }); setSelectedEmp(""); },
    onError: () => toast({ title: "Reassign failed", variant: "destructive" }),
  });

  const DEPTS = ["Revenue", "Operations", "Finance", "Marketing", "Client Success", "HR"];

  return (
    <div className="space-y-4" data-testid="tab-hr">
      {/* Hire */}
      <div className="p-4 rounded-xl border bg-card">
        <div className="flex items-center gap-2 mb-3"><UserPlus className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">Hire New Agent</h3></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={hireRole} onChange={e => setHireRole(e.target.value)} placeholder="Role name (e.g. Content Agent)" className="h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-hire-role" />
          <select value={hireDept} onChange={e => setHireDept(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-hire-dept">
            {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => hireMutation.mutate()} disabled={!hireRole || hireMutation.isPending} data-testid="button-hire">
            {hireMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}Hire Agent
          </Button>
        </div>
      </div>

      {/* Reassign */}
      <div className="p-4 rounded-xl border bg-card">
        <div className="flex items-center gap-2 mb-3"><RefreshCw className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">Reassign Agent</h3></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-reassign-emp">
            <option value="">Select agent...</option>
            {(data?.employees ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={reassignDept} onChange={e => setReassignDept(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-reassign-dept">
            {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => reassignMutation.mutate()} disabled={!selectedEmp || reassignMutation.isPending} data-testid="button-reassign">
            {reassignMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Reassign
          </Button>
        </div>
      </div>

      {/* Active Roster with retire actions */}
      <div className="rounded-xl border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2"><Briefcase className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">Active Roster</h3></div>
        {isLoading ? <div className="p-4"><Skeleton className="h-32 rounded-xl" /></div> : (
          <div className="divide-y">
            {(data?.employees ?? []).filter(e => e.status === "active").map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`hr-row-${e.id}`}>
                <span className="text-base">{e.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">{e.name}</p>
                    <LevelBadge level={e.level} />
                  </div>
                  <p className="text-[9px] text-muted-foreground">{e.department} · {e.role}</p>
                </div>
                <div className="text-center mr-2">
                  <p className="text-xs font-bold">{e.performanceScore}</p>
                  <p className="text-[8px] text-muted-foreground">perf</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[10px] text-muted-foreground hover:text-rose-500 shrink-0" onClick={() => retireMutation.mutate(e.id)} disabled={retireMutation.isPending} data-testid={`button-retire-${e.id}`}>
                  <UserMinus className="h-3 w-3" />Retire
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Planning ────────────────────────────────────────────────────────────

function PlanningTab() {
  const { data, isLoading } = useQuery<PlanData>({ queryKey: ["/api/workforce-os/planning"], staleTime: 60_000 });
  const { toast } = useToast();
  const qc = useQueryClient();

  const hireMutation = useMutation({
    mutationFn: (gap: PlanGap) => apiRequest("POST", "/api/workforce-os/hire", { roleName: gap.role, department: gap.department }),
    onSuccess: (_d, gap) => { qc.invalidateQueries({ queryKey: ["/api/workforce-os/employees"] }); toast({ title: `${gap.role} added to workforce`, description: "Configure capabilities in the HR tab." }); },
    onError: () => toast({ title: "Hire failed", variant: "destructive" }),
  });

  const PRIORITY_COLORS: Record<string, string> = { high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

  return (
    <div className="space-y-4" data-testid="tab-planning">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Current Headcount",   value: data.currentHeadcount,    color: "text-primary" },
            { label: "Recommended",         value: data.recommendedHeadcount, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Capacity Utilization",value: `${data.capacityUtilization}%`, color: data.capacityUtilization < 70 ? "text-amber-600 dark:text-amber-400" : "text-primary" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /><h3 className="text-xs font-semibold">Workforce Gaps</h3></div>
        {isLoading ? <div className="p-4"><Skeleton className="h-48 rounded-xl" /></div> : (
          <div className="divide-y">
            {(data?.gaps ?? []).map((gap, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`gap-${i}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-semibold">{gap.role}</p>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${PRIORITY_COLORS[gap.priority]}`}>{gap.priority}</Badge>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{gap.department}</Badge>
                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 ml-auto">{gap.estimatedRevImpact}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1">{gap.reason}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground">Readiness: {gap.readinessScore}%</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-24"><div className="h-full rounded-full bg-primary" style={{ width: `${gap.readinessScore}%` }} /></div>
                  </div>
                </div>
                <Button size="sm" className="h-7 gap-1 text-[10px] shrink-0" onClick={() => hireMutation.mutate(gap)} disabled={hireMutation.isPending} data-testid={`button-hire-gap-${i}`}>
                  <UserPlus className="h-3 w-3" />Hire
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {data && (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">Hiring Forecast</h3></div>
          <div className="divide-y">
            {data.forecast.map((f, i) => (
              <div key={i} className="px-4 py-3" data-testid={`forecast-${i}`}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xs font-bold">{f.quarter}</span>
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">+{f.hires} hires</Badge>
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 ml-auto">+${(f.estimatedRevLift / 1000).toFixed(1)}k/mo</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {f.projected.map(r => <Badge key={r} variant="secondary" className="text-[8px] px-1.5 py-0 h-4">{r}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminWorkforceOsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("directory");
  const { data: empData } = useQuery<EmployeesData>({ queryKey: ["/api/workforce-os/employees"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-workforce-os">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/integrations">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Integrations
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Digital Employees &amp; Agent Workforce OS
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage AI agents as persistent digital employees with roles, reviews, OKRs, career paths, and workforce planning.
          </p>
        </div>
        {empData && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Employees",  value: empData.employees.length },
              { label: "Avg Perf",   value: empData.avgPerformanceScore },
              { label: "Revenue",    value: `$${(empData.totalRevenue / 1000).toFixed(0)}k` },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className="text-base font-extrabold text-primary">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Execution",    href: "/admin/execution-center" },
          { label: "Ecosystem",    href: "/admin/ecosystem" },
          { label: "Integrations", href: "/admin/integrations" },
          { label: "Workforce OS", href: null },
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

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-workforce-os">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "directory"    && <DirectoryTab setTab={setActiveTab} />}
        {activeTab === "orgchart"     && <OrgChartTab />}
        {activeTab === "reviews"      && <ReviewsTab />}
        {activeTab === "workloads"    && <WorkloadsTab />}
        {activeTab === "goals"        && <GoalsTab />}
        {activeTab === "promotions"   && <PromotionsTab />}
        {activeTab === "training"     && <TrainingTab />}
        {activeTab === "compensation" && <CompensationTab />}
        {activeTab === "hr"           && <HrTab />}
        {activeTab === "planning"     && <PlanningTab />}
      </div>
    </div>
  );
}
