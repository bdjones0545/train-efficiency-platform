import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Building2, ChevronRight, Layers, RefreshCw, Plus,
  X, CheckCircle, AlertTriangle, BarChart3, TrendingUp, Users,
  Activity, Shield, GitBranch, Network, Target, Star, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Department = { id: string; name: string; description: string; head: string; status: string; capacity: number; utilization: number; memberCount: number; kpis: string[]; color: string; roles: Role[]; responsibilities: number };
type Role = { id: string; title: string; departmentId: string | null; reportsTo: string | null; authorityLevel: string; responsibilityScope: string; department?: string | null };
type OrgNode = Role & { reports: OrgNode[]; department: string | null };
type Responsibility = { id: string; responsibility: string; ownerDepartment: string; ownerRole: string; secondaryOwner: string; criticality: string; status: string };
type DecisionRight = { id: string; decisionCategory: string; proposeRole: string; reviewRole: string; approveRole: string; executeRole: string };
type CapacityDept = { id: string; name: string; head: string; capacity: number; utilization: number; memberCount: number; backlog: number; openRoles: number; riskLevel: string; expansionReady: boolean; hiringNeeded: boolean };
type CollabPair = { pair: string; handoffs: number; avgResponseHours: number; escalations: number; collaborationScore: number; bottleneck: boolean };
type Overview = { totalDepartments: number; totalRoles: number; totalResponsibilities: number; totalDecisionRights: number; avgUtilization: number; collaborationScore: number; bottlenecks: number; orgMaturityScore: number; orgEfficiencyScore: number; enterpriseReadinessScore: number; generatedAt: string };
type Analytics = { orgMaturityScore: number; orgEfficiencyScore: number; enterpriseReadinessScore: number; avgUtilization: number; responsibilityCoveragePercent: number; avgCollaborationScore: number; decisionVelocityDays: number; spanOfControl: number; utilizationByDepartment: { name: string; utilization: number; memberCount: number }[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AUTHORITY_COLORS: Record<string, string> = { Contributor: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", Manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Director: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", Executive: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", Enterprise: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200" };
const CRIT_COLORS: Record<string, string> = { low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", critical: "bg-rose-200 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" };
const RISK_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-500", critical: "text-rose-700 dark:text-rose-300" };
const DEPT_COLORS: Record<string, string> = { emerald: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300", blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", violet: "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300", cyan: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300", amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300", rose: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300", teal: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300", slate: "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300" };
const DEPT_BAR_COLORS: Record<string, string> = { emerald: "bg-emerald-500", blue: "bg-blue-500", violet: "bg-violet-500", cyan: "bg-cyan-500", amber: "bg-amber-500", rose: "bg-rose-500", teal: "bg-teal-500", slate: "bg-slate-500" };
const UTIL_BAR: (u: number) => string = u => u >= 95 ? "bg-rose-500" : u >= 88 ? "bg-amber-500" : u >= 75 ? "bg-primary" : "bg-emerald-500";

function AuthBadge({ level }: { level: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${AUTHORITY_COLORS[level] ?? "bg-muted text-muted-foreground"}`}>{level}</Badge>;
}
function CritBadge({ c }: { c: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${CRIT_COLORS[c] ?? "bg-muted text-muted-foreground"}`}>{c}</Badge>;
}
function AgentDot({ name }: { name: string }) {
  const COLORS: Record<string, string> = { "CEO Heartbeat": "bg-primary", "AI COO": "bg-violet-500", "Revenue Director": "bg-emerald-600", "Operations Director": "bg-blue-600", "Marketing Director": "bg-violet-600", "CS Director": "bg-cyan-600", "Finance Director": "bg-amber-600", "Partnerships Director": "bg-rose-600", "Product Director": "bg-teal-600", "Governance Director": "bg-slate-600", "Revenue Agent": "bg-emerald-400", "Research Agent": "bg-amber-400", "Scheduling Agent": "bg-blue-400", "Email Agent": "bg-indigo-400", "Customer Success Agent": "bg-cyan-400", "Partnership Agent": "bg-rose-400" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  return <div className={`h-5 w-5 ${color} rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0`}>{initials}</div>;
}

// ─── Org Tree Node ─────────────────────────────────────────────────────────────

function OrgTreeNode({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasReports = node.reports.length > 0;
  return (
    <div className={depth > 0 ? "ml-6 border-l border-dashed border-muted-foreground/20 pl-3" : ""} data-testid={`org-node-${node.id}`}>
      <div className="flex items-start gap-2 py-1.5">
        {hasReports && (
          <button onClick={() => setExpanded(!expanded)} className="mt-1 text-muted-foreground hover:text-foreground shrink-0" data-testid={`toggle-org-${node.id}`}>
            {expanded ? <span className="text-[8px]">▾</span> : <span className="text-[8px]">▸</span>}
          </button>
        )}
        {!hasReports && <div className="w-3 shrink-0" />}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AgentDot name={node.title} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold truncate">{node.title}</p>
            {node.department && <p className="text-[8px] text-muted-foreground">{node.department} dept</p>}
          </div>
          <AuthBadge level={node.authorityLevel} />
          {hasReports && <span className="text-[8px] text-muted-foreground shrink-0">{node.reports.length} direct</span>}
        </div>
      </div>
      {expanded && hasReports && node.reports.map(child => (
        <OrgTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",      label: "Overview",         icon: Building2    },
  { id: "departments",   label: "Departments",      icon: Users        },
  { id: "orgchart",      label: "Org Chart",        icon: GitBranch    },
  { id: "responsibilities", label: "Responsibilities", icon: Target    },
  { id: "rights",        label: "Decision Rights",  icon: Shield       },
  { id: "capacity",      label: "Capacity",         icon: Activity     },
  { id: "collaboration", label: "Collaboration",    icon: Network      },
  { id: "analytics",     label: "Analytics",        icon: BarChart3    },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── New Department Modal ─────────────────────────────────────────────────────

function NewDeptModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", description: "", head: "", capacity: 3 });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/organization/create-department", form),
    onSuccess: () => { toast({ title: "Department created" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to create department", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="new-dept-modal">
      <div className="bg-background rounded-2xl border shadow-xl w-full max-w-md space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />New Department</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-dept-modal"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2.5">
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Department name…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-dept-name" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Department purpose and scope…" className="w-full h-16 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="textarea-dept-description" />
          <input value={form.head} onChange={e => setForm(p => ({ ...p, head: e.target.value }))} placeholder="Department head title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-dept-head" />
          <div>
            <p className="text-[9px] text-muted-foreground mb-1">Capacity (agent seats): {form.capacity}</p>
            <input type="range" min={1} max={12} value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: +e.target.value }))} className="w-full" data-testid="range-dept-capacity" />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-dept">Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!form.name.trim() || mutation.isPending} data-testid="button-confirm-dept">
            {mutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Create Department
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/organization/overview"], staleTime: 60_000 });
  const { data: deptData } = useQuery<{ departments: Department[] }>({ queryKey: ["/api/organization/departments"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-overview-org">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Departments",         value: data?.totalDepartments ?? "—",              color: "text-primary" },
          { label: "Roles Defined",       value: data?.totalRoles ?? "—",                   color: "text-blue-600 dark:text-blue-400" },
          { label: "Avg Utilization",     value: data ? `${data.avgUtilization}%` : "—",    color: data && data.avgUtilization >= 85 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
          { label: "Collab Score",        value: data ? `${data.collaborationScore}` : "—", color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`org-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Org maturity scores */}
      {data && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Organizational Maturity</p>
          {[
            { label: "Org Maturity Score",          value: data.orgMaturityScore,          color: "bg-primary" },
            { label: "Org Efficiency Score",         value: data.orgEfficiencyScore,        color: "bg-emerald-500" },
            { label: "Enterprise Readiness Score",   value: data.enterpriseReadinessScore,  color: "bg-violet-500" },
          ].map(bar => (
            <div key={bar.label} className="mb-2.5">
              <div className="flex justify-between mb-1">
                <span className="text-[9px]">{bar.label}</span>
                <span className="text-[9px] font-bold">{bar.value}/100</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${bar.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Department grid preview */}
      {deptData && (
        <div className="grid sm:grid-cols-2 gap-3">
          {deptData.departments.map(d => {
            const colorClass = DEPT_COLORS[d.color] ?? "bg-muted text-muted-foreground";
            const barColor   = DEPT_BAR_COLORS[d.color] ?? "bg-primary";
            return (
              <button key={d.id} onClick={() => setTab("departments")} className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left" data-testid={`dept-preview-${d.id}`}>
                <div className={`p-2 rounded-lg shrink-0 ${colorClass}`}>
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold truncate">{d.name}</p>
                  <p className="text-[8px] text-muted-foreground">{d.head} · {d.memberCount} agents</p>
                  <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden w-full">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${d.utilization}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${UTIL_BAR(d.utilization) === "bg-emerald-500" ? "text-emerald-600 dark:text-emerald-400" : UTIL_BAR(d.utilization) === "bg-amber-500" ? "text-amber-600 dark:text-amber-400" : "text-rose-500"}`}>{d.utilization}%</p>
                  <p className="text-[8px] text-muted-foreground">util.</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {isLoading && <Skeleton className="h-48 rounded-xl" />}
    </div>
  );
}

// ─── Tab: Departments ─────────────────────────────────────────────────────────

function DepartmentsTab() {
  const { data, isLoading } = useQuery<{ departments: Department[] }>({ queryKey: ["/api/organization/departments"], staleTime: 60_000 });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3" data-testid="tab-departments">
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (data?.departments ?? []).map(d => {
        const colorClass = DEPT_COLORS[d.color] ?? "bg-muted text-muted-foreground";
        const barColor   = DEPT_BAR_COLORS[d.color] ?? "bg-primary";
        const isOpen = expanded === d.id;
        return (
          <div key={d.id} className="rounded-xl border bg-card overflow-hidden" data-testid={`dept-card-${d.id}`}>
            <button className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/10 transition-colors" onClick={() => setExpanded(isOpen ? null : d.id)} data-testid={`toggle-dept-${d.id}`}>
              <div className={`p-2.5 rounded-lg shrink-0 ${colorClass}`}>
                <Building2 className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <p className="text-xs font-bold">{d.name}</p>
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{d.status}</Badge>
                  {d.utilization >= 90 && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">High Load</Badge>}
                </div>
                <p className="text-[9px] text-muted-foreground mb-2 leading-relaxed line-clamp-2">{d.description}</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <p className="text-[8px] text-muted-foreground">Head</p>
                    <p className="text-[9px] font-semibold">{d.head}</p>
                  </div>
                  <div>
                    <p className="text-[8px] text-muted-foreground">Agents</p>
                    <p className="text-[9px] font-semibold">{d.memberCount}</p>
                  </div>
                  <div>
                    <p className="text-[8px] text-muted-foreground">Responsibilities</p>
                    <p className="text-[9px] font-semibold">{d.responsibilities}</p>
                  </div>
                  <div className="flex-1 min-w-24">
                    <div className="flex justify-between mb-0.5">
                      <p className="text-[8px] text-muted-foreground">Utilization</p>
                      <p className="text-[8px] font-bold">{d.utilization}%</p>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${UTIL_BAR(d.utilization)}`} style={{ width: `${d.utilization}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0">{isOpen ? "▴" : "▾"}</span>
            </button>
            {isOpen && (
              <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
                {/* KPIs */}
                <div>
                  <p className="text-[8px] text-muted-foreground uppercase tracking-wide mb-1.5">Key Performance Indicators</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {d.kpis.map(kpi => <Badge key={kpi} variant="secondary" className="text-[8px] px-2 py-0 h-5">{kpi}</Badge>)}
                  </div>
                </div>
                {/* Roles */}
                {d.roles.length > 0 && (
                  <div>
                    <p className="text-[8px] text-muted-foreground uppercase tracking-wide mb-1.5">Team Members</p>
                    <div className="space-y-1.5">
                      {d.roles.map(r => (
                        <div key={r.id} className="flex items-center gap-2" data-testid={`role-${r.id}`}>
                          <AgentDot name={r.title} />
                          <p className="text-[9px] font-medium flex-1 truncate">{r.title}</p>
                          <AuthBadge level={r.authorityLevel} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Org Chart ───────────────────────────────────────────────────────────

function OrgChartTab() {
  const { data, isLoading } = useQuery<{ tree: OrgNode[]; roles: Role[] }>({ queryKey: ["/api/organization/org-chart"], staleTime: 60_000 });
  const authorityLevels = ["Enterprise", "Executive", "Director", "Manager", "Contributor"];
  return (
    <div className="space-y-5" data-testid="tab-orgchart">
      {/* Authority legend */}
      <div className="flex flex-wrap gap-1.5">
        {authorityLevels.map(l => <AuthBadge key={l} level={l} />)}
      </div>
      {/* Tree */}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />Reporting Hierarchy
          </p>
          {(data?.tree ?? []).map(node => <OrgTreeNode key={node.id} node={node} depth={0} />)}
        </div>
      )}
      {/* Span summary */}
      {data && (
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.roles.length}</p>
            <p className="text-[9px] text-muted-foreground">Total Roles</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-violet-600 dark:text-violet-400">{data.roles.filter(r => r.authorityLevel === "Director").length}</p>
            <p className="text-[9px] text-muted-foreground">Directors</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{data.roles.filter(r => r.authorityLevel === "Contributor").length}</p>
            <p className="text-[9px] text-muted-foreground">Contributors</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Responsibilities ────────────────────────────────────────────────────

function ResponsibilitiesTab() {
  const { data, isLoading } = useQuery<{ responsibilities: Responsibility[]; total: number; byDepartment: Record<string, number>; byCriticality: Record<string, number> }>({ queryKey: ["/api/organization/responsibilities"], staleTime: 60_000 });
  const [filter, setFilter] = useState("all");
  const departments = data ? [...new Set(data.responsibilities.map(r => r.ownerDepartment))] : [];
  const filtered = (data?.responsibilities ?? []).filter(r => filter === "all" || r.ownerDepartment === filter);

  return (
    <div className="space-y-4" data-testid="tab-responsibilities">
      {data && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Critical", value: data.byCriticality.critical ?? 0, color: "text-rose-700 dark:text-rose-300" },
            { label: "High",     value: data.byCriticality.high     ?? 0, color: "text-rose-500" },
            { label: "Medium",   value: data.byCriticality.medium   ?? 0, color: "text-amber-600 dark:text-amber-400" },
            { label: "Low",      value: data.byCriticality.low      ?? 0, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(k => (
            <div key={k.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`resp-crit-${k.label.toLowerCase()}`}>
              <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {["all", ...departments].map(dept => (
          <button key={dept} onClick={() => setFilter(dept)} data-testid={`filter-dept-resp-${dept}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === dept ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {dept}
          </button>
        ))}
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {filtered.map(r => (
            <div key={r.id} className="flex items-start gap-3 p-3.5 rounded-xl border bg-card" data-testid={`resp-card-${r.id}`}>
              <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-[10px] font-semibold flex-1 truncate">{r.responsibility}</p>
                  <CritBadge c={r.criticality} />
                </div>
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground flex-wrap">
                  <span>Dept: <span className="text-foreground font-medium">{r.ownerDepartment}</span></span>
                  <span>·</span>
                  <div className="flex items-center gap-1"><AgentDot name={r.ownerRole} /><span className="font-medium text-foreground">{r.ownerRole}</span></div>
                  {r.secondaryOwner && <><span>·</span><span>Backup: <span className="font-medium text-foreground">{r.secondaryOwner}</span></span></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Decision Rights ─────────────────────────────────────────────────────

function DecisionRightsTab() {
  const { data, isLoading } = useQuery<{ decisionRights: DecisionRight[]; total: number }>({ queryKey: ["/api/organization/decision-rights"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-rights">
      <div className="p-3 rounded-xl border bg-card">
        <p className="text-[9px] text-muted-foreground mb-2">Each row defines who has authority at each stage of the decision process.</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {["Propose", "Review", "Approve", "Execute"].map(stage => (
            <div key={stage} className="p-1.5 rounded-lg bg-muted">
              <p className="text-[9px] font-semibold">{stage}</p>
            </div>
          ))}
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {(data?.decisionRights ?? []).map(dr => (
            <div key={dr.id} className="rounded-xl border bg-card overflow-hidden" data-testid={`rights-card-${dr.id}`}>
              <div className="px-4 py-2.5 border-b bg-muted/10">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-[10px] font-bold">{dr.decisionCategory}</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-0 divide-x">
                {[
                  { label: "Propose",  value: dr.proposeRole,  color: "text-blue-600 dark:text-blue-400" },
                  { label: "Review",   value: dr.reviewRole,   color: "text-amber-600 dark:text-amber-400" },
                  { label: "Approve",  value: dr.approveRole,  color: "text-emerald-600 dark:text-emerald-400" },
                  { label: "Execute",  value: dr.executeRole,  color: "text-violet-600 dark:text-violet-400" },
                ].map(col => (
                  <div key={col.label} className="p-2.5 text-center" data-testid={`right-${dr.id}-${col.label.toLowerCase()}`}>
                    <p className="text-[8px] text-muted-foreground mb-0.5">{col.label}</p>
                    <p className={`text-[9px] font-semibold leading-snug ${col.color}`}>{col.value}</p>
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

// ─── Tab: Capacity Planning ───────────────────────────────────────────────────

function CapacityTab() {
  const { data, isLoading } = useQuery<{ departments: CapacityDept[]; avgUtilization: number; atRisk: number }>({ queryKey: ["/api/organization/capacity"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-capacity">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.avgUtilization}%</p>
            <p className="text-[9px] text-muted-foreground">Avg Utilization</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className={`text-xl font-extrabold ${data.atRisk > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{data.atRisk}</p>
            <p className="text-[9px] text-muted-foreground">Depts at Risk</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400">{data.departments.filter(d => d.hiringNeeded).length}</p>
            <p className="text-[9px] text-muted-foreground">Hiring Needed</p>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.departments ?? []).sort((a, b) => b.utilization - a.utilization).map(d => (
            <div key={d.id} className="p-4 rounded-xl border bg-card" data-testid={`capacity-${d.id}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${d.riskLevel === "critical" || d.riskLevel === "high" ? "bg-rose-100 dark:bg-rose-900/30" : d.riskLevel === "medium" ? "bg-amber-100 dark:bg-amber-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}`}>
                  <Activity className={`h-3.5 w-3.5 ${d.riskLevel === "critical" || d.riskLevel === "high" ? "text-rose-500" : d.riskLevel === "medium" ? "text-amber-500" : "text-emerald-500"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-[10px] font-bold">{d.name}</p>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${RISK_COLORS[d.riskLevel] === "text-emerald-600 dark:text-emerald-400" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : RISK_COLORS[d.riskLevel] === "text-amber-600 dark:text-amber-400" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>{d.riskLevel} risk</Badge>
                    {d.hiringNeeded && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Hiring Needed</Badge>}
                    {d.expansionReady && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">Expansion Ready</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
                    <span>{d.memberCount} agents · Capacity {d.capacity}</span>
                    {d.backlog > 0 && <span className="text-amber-600 dark:text-amber-400">Backlog: {d.backlog}</span>}
                    {d.openRoles > 0 && <span className="text-blue-600 dark:text-blue-400">{d.openRoles} open role{d.openRoles > 1 ? "s" : ""}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${UTIL_BAR(d.utilization)}`} style={{ width: `${d.utilization}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold shrink-0 w-10 text-right ${RISK_COLORS[d.riskLevel]}`}>{d.utilization}%</span>
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

// ─── Tab: Collaboration ───────────────────────────────────────────────────────

function CollaborationTab() {
  const { data, isLoading } = useQuery<{ pairs: CollabPair[]; avgCollaborationScore: number; bottleneckCount: number; totalHandoffs: number; totalEscalations: number }>({ queryKey: ["/api/organization/collaboration"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-collaboration">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Avg Collab Score",  value: data.avgCollaborationScore,      color: "text-primary" },
            { label: "Total Handoffs",    value: data.totalHandoffs,              color: "text-blue-600 dark:text-blue-400" },
            { label: "Escalations",       value: data.totalEscalations,           color: data.totalEscalations > 5 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Bottlenecks",       value: data.bottleneckCount,            color: data.bottleneckCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
          ].map(k => (
            <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`collab-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2.5">
          {(data?.pairs ?? []).sort((a, b) => b.collaborationScore - a.collaborationScore).map((pair, i) => (
            <div key={i} className={`p-4 rounded-xl border bg-card ${pair.bottleneck ? "border-amber-200 dark:border-amber-800" : ""}`} data-testid={`collab-pair-${i}`}>
              <div className="flex items-center gap-3 mb-2.5">
                <Network className={`h-4 w-4 shrink-0 ${pair.bottleneck ? "text-amber-500" : "text-primary"}`} />
                <p className="text-[10px] font-bold flex-1">{pair.pair}</p>
                {pair.bottleneck && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Bottleneck</Badge>}
                <span className={`text-sm font-extrabold shrink-0 ${pair.collaborationScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : pair.collaborationScore >= 80 ? "text-primary" : pair.collaborationScore >= 70 ? "text-amber-600 dark:text-amber-400" : "text-rose-500"}`}>{pair.collaborationScore}</span>
              </div>
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
                <span>{pair.handoffs} handoffs/mo</span>
                <span>·</span>
                <span>{pair.avgResponseHours}h avg response</span>
                <span>·</span>
                <span className={pair.escalations > 2 ? "text-rose-500" : ""}>{pair.escalations} escalations</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${pair.collaborationScore >= 90 ? "bg-emerald-500" : pair.collaborationScore >= 80 ? "bg-primary" : pair.collaborationScore >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pair.collaborationScore}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<Analytics>({ queryKey: ["/api/organization/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-org">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Org Maturity",           value: data ? `${data.orgMaturityScore}/100` : "—",         color: "text-primary" },
          { label: "Org Efficiency",          value: data ? `${data.orgEfficiencyScore}/100` : "—",       color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Enterprise Readiness",    value: data ? `${data.enterpriseReadinessScore}/100` : "—", color: "text-violet-600 dark:text-violet-400" },
          { label: "Decision Velocity",       value: data ? `${data.decisionVelocityDays}d` : "—",       color: "text-muted-foreground" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`analytics-org-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          {/* Score breakdown */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Organizational Health Scores</p>
            {[
              { label: "Org Maturity Score",           value: data.orgMaturityScore,           color: "bg-primary" },
              { label: "Org Efficiency Score",          value: data.orgEfficiencyScore,         color: "bg-emerald-500" },
              { label: "Enterprise Readiness",          value: data.enterpriseReadinessScore,   color: "bg-violet-500" },
              { label: "Responsibility Coverage",       value: data.responsibilityCoveragePercent, color: "bg-teal-500" },
              { label: "Avg Collaboration Score",       value: data.avgCollaborationScore,      color: "bg-blue-500" },
            ].map(bar => (
              <div key={bar.label} className="mb-2.5">
                <div className="flex justify-between mb-1">
                  <span className="text-[9px]">{bar.label}</span>
                  <span className="text-[9px] font-bold">{bar.value}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${bar.value}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Utilization by department */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Utilization by Department</p>
            <div className="space-y-2.5">
              {data.utilizationByDepartment.sort((a, b) => b.utilization - a.utilization).map(d => (
                <div key={d.name} className="flex items-center gap-2" data-testid={`util-dept-${d.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-[9px] w-32 shrink-0 truncate">{d.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${UTIL_BAR(d.utilization)}`} style={{ width: `${d.utilization}%` }} />
                  </div>
                  <span className={`text-[9px] font-bold w-10 text-right shrink-0 ${d.utilization >= 90 ? "text-rose-500" : d.utilization >= 80 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{d.utilization}%</span>
                  <span className="text-[8px] text-muted-foreground w-12 shrink-0">{d.memberCount} agents</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key metrics */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Key Ratios</p>
              <div className="space-y-2">
                {[
                  { label: "Span of Control",           value: `${data.spanOfControl} direct reports (AI COO)` },
                  { label: "Decision Velocity",         value: `${data.decisionVelocityDays} days avg` },
                  { label: "Resp. Coverage",            value: `${data.responsibilityCoveragePercent}% with backup owner` },
                  { label: "Avg Utilization",           value: `${data.avgUtilization}% across all depts` },
                ].map(m => (
                  <div key={m.label} className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground">{m.label}</span>
                    <span className="text-[9px] font-semibold">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Maturity Benchmarks</p>
              <div className="space-y-1.5">
                {[
                  { label: "Formal dept structure",       met: true  },
                  { label: "Responsibility matrix",        met: true  },
                  { label: "Decision rights defined",      met: true  },
                  { label: "Full capacity monitoring",     met: true  },
                  { label: "Cross-dept collab tracking",   met: true  },
                  { label: "100% backup ownership",        met: false },
                ].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    {m.met ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                    <span className={`text-[9px] ${m.met ? "" : "text-amber-600 dark:text-amber-400"}`}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminOrganizationPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showNewDept, setShowNewDept] = useState(false);
  const qc = useQueryClient();

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/organization/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-organization">
      {showNewDept && <NewDeptModal onClose={() => setShowNewDept(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/organization/departments"] })} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/governance">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Governance Center
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Organization Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The formal organizational architecture — departments, reporting structures, decision rights, and accountability maps for the digital enterprise.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overview && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "Depts",       value: overview.totalDepartments,                              color: "text-primary" },
                { label: "Maturity",    value: `${overview.orgMaturityScore}`,                        color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Collab",      value: `${overview.collaborationScore}`,                      color: "text-blue-600 dark:text-blue-400" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setShowNewDept(true)} data-testid="button-new-department">
            <Plus className="h-4 w-4" />New Department
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Org Memory",  href: "/admin/organizational-memory" },
          { label: "SOPs",        href: "/admin/procedures"            },
          { label: "Governance",  href: "/admin/governance"            },
          { label: "Organization",href: null                           },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="org-status-bar">
        {[
          { label: "Departments",      value: overview?.totalDepartments ?? "—",           color: "text-primary",                               icon: <Building2 className="h-3.5 w-3.5 text-primary" />,              tab: "departments"    as TabId },
          { label: "Roles",            value: overview?.totalRoles ?? "—",                 color: "text-blue-600 dark:text-blue-400",            icon: <Users     className="h-3.5 w-3.5 text-blue-500" />,             tab: "orgchart"       as TabId },
          { label: "Bottlenecks",      value: overview?.bottlenecks ?? "—",               color: (overview?.bottlenecks ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, tab: "collaboration" as TabId },
          { label: "Responsibilities", value: overview?.totalResponsibilities ?? "—",      color: "text-violet-600 dark:text-violet-400",        icon: <Target    className="h-3.5 w-3.5 text-violet-500" />,           tab: "responsibilities" as TabId },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-org">
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
        {activeTab === "overview"          && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "departments"       && <DepartmentsTab />}
        {activeTab === "orgchart"          && <OrgChartTab />}
        {activeTab === "responsibilities"  && <ResponsibilitiesTab />}
        {activeTab === "rights"            && <DecisionRightsTab />}
        {activeTab === "capacity"          && <CapacityTab />}
        {activeTab === "collaboration"     && <CollaborationTab />}
        {activeTab === "analytics"         && <AnalyticsTab />}
      </div>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5" data-testid="architecture-complete-19-6">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Organizational Structure — Phase 19.6 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">Every department has a head, every responsibility has an owner, every decision has a defined authority chain. The digital organization is now formally structured.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace","Org Memory","SOP System","Governance","Organization",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 23 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
