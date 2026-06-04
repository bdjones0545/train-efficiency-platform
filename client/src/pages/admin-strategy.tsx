import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, TrendingUp, ChevronRight, Layers, RefreshCw, Plus,
  X, CheckCircle, AlertTriangle, BarChart3, Target, Zap, Star,
  Activity, Building2, Flag, GitMerge, Compass,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Objective = { id: string; title: string; theme: string; owner: string; department: string; priority: string; deadline: string; progress: number; forecast: number; confidence: number; status: string; description: string; keyResults?: KeyResult[]; initiatives?: { id: string; title: string; progress: number; status: string }[] };
type KeyResult = { id: string; objectiveId: string; title: string; target: number; current: number; unit: string; owner: string; status: string };
type Initiative = { id: string; title: string; objectiveIds: string[]; departments: string[]; status: string; progress: number; lead: string; deadline: string; description: string; taskCount: number; completedTasks: number; linkedObjectives?: { id: string; title: string; theme: string }[] };
type Scorecard = { department: string; head: string; score: number; metrics: { name: string; actual: string | number; target: string | number; status: string }[]; alignmentScore: number };
type AlignmentItem = { objectiveId: string; objectiveTitle: string; theme: string; department: string; initiatives: { id: string; title: string; progress: number; status: string }[]; keyResults: number; alignmentScore: number };
type Forecast = { id: string; title: string; owner: string; deadline: string; currentProgress: number; forecastedProgress: number; confidence: number; status: string; theme: string; gap: number; onTimeProb: number; aiRecommendation: string };
type Overview = { totalObjectives: number; onTrack: number; atRisk: number; ahead: number; avgProgress: number; strategicAlignmentScore: number; totalKeyResults: number; achievedKeyResults: number; totalInitiatives: number; activeInitiatives: number; generatedAt: string };
type Analytics = { totalObjectives: number; totalKeyResults: number; totalInitiatives: number; byTheme: Record<string, number>; byStatus: Record<string, number>; krByStatus: Record<string, number>; initiativesByStatus: Record<string, number>; avgObjectiveProgress: number; avgDepartmentScore: number; strategicAlignmentScore: number; initiativeCompletionRate: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  on_track: { label: "On Track",  color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  at_risk:  { label: "At Risk",   color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"             },
  ahead:    { label: "Ahead",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"             },
  achieved: { label: "Achieved",  color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"     },
  active:   { label: "Active",    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"         },
  completed:{ label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  exceeded: { label: "Exceeded",  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"             },
};
const PRIORITY_COLORS: Record<string, string> = { critical: "text-rose-500", high: "text-amber-600 dark:text-amber-400", medium: "text-blue-600 dark:text-blue-400", low: "text-muted-foreground" };
const THEME_COLORS: Record<string, string> = { Growth: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", Expansion: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", Retention: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", Efficiency: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", Activation: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" };

function StatusBadge({ s }: { s: string }) {
  const cfg = STATUS_CONFIG[s] ?? { label: s, color: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg.color}`}>{cfg.label}</Badge>;
}
function ThemeBadge({ theme }: { theme: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${THEME_COLORS[theme] ?? "bg-muted text-muted-foreground"}`}>{theme}</Badge>;
}
function ProgressBar({ value, color = "bg-primary", height = "h-2" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}
function AgentDot({ name }: { name: string }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Director": "bg-emerald-600", "Operations Director": "bg-blue-600", "Marketing Director": "bg-violet-600", "CS Director": "bg-cyan-600", "Finance Director": "bg-amber-600", "Partnerships Director": "bg-rose-600", "Product Director": "bg-teal-600", "Governance Director": "bg-slate-600", "Revenue Agent": "bg-emerald-400", "CS Agent": "bg-cyan-400", "Scheduling Agent": "bg-blue-400" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  return <div className={`h-5 w-5 ${color} rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0`}>{initials}</div>;
}
function krProgress(kr: KeyResult): number {
  if (kr.status === "achieved") return 100;
  if (kr.target === 0) return 100;
  if (kr.unit === "%" && kr.title.toLowerCase().includes("churn")) {
    return Math.round(Math.max(0, Math.min(100, ((kr.target - kr.current) / kr.target) * 200)));
  }
  return Math.round(Math.min(100, (kr.current / kr.target) * 100));
}
function krBarColor(status: string): string {
  return status === "achieved" ? "bg-violet-500" : status === "on_track" ? "bg-emerald-500" : status === "at_risk" ? "bg-rose-500" : "bg-primary";
}
function formatKRValue(kr: KeyResult): string {
  if (kr.unit === "USD")          return `$${kr.current.toLocaleString()} / $${kr.target.toLocaleString()}`;
  if (kr.unit === "%" || kr.unit === "score" || kr.unit === "NPS") return `${kr.current} / ${kr.target} ${kr.unit}`;
  if (kr.unit === "violations")   return `${kr.current} violations`;
  return `${kr.current} / ${kr.target} ${kr.unit}`;
}

// ─── Objective Card ────────────────────────────────────────────────────────────

function ObjectiveCard({ obj, showKRs = false }: { obj: Objective; showKRs?: boolean }) {
  const [open, setOpen] = useState(false);
  const krs = obj.keyResults ?? [];
  const progressColor = obj.status === "ahead" ? "bg-blue-500" : obj.status === "at_risk" ? "bg-rose-500" : "bg-emerald-500";
  return (
    <div className="rounded-xl border bg-card overflow-hidden" data-testid={`obj-card-${obj.id}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5"><Target className="h-4 w-4 text-primary" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <p className="text-xs font-bold flex-1 truncate">{obj.title}</p>
              <StatusBadge s={obj.status} />
              <ThemeBadge theme={obj.theme} />
              <span className={`text-[9px] font-semibold ${PRIORITY_COLORS[obj.priority]}`}>{obj.priority}</span>
            </div>
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
              <div className="flex items-center gap-1"><AgentDot name={obj.owner} /><span>{obj.owner}</span></div>
              <span>·</span><span>{obj.department}</span>
              <span>·</span><span>Due {new Date(obj.deadline).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}</span>
              <span>·</span><span className="font-bold text-primary">{obj.confidence}% confidence</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <ProgressBar value={obj.progress} color={progressColor} />
              <span className="text-[10px] font-bold w-8 text-right shrink-0">{obj.progress}%</span>
            </div>
            {obj.forecast !== obj.progress && (
              <div className="flex items-center gap-2">
                <ProgressBar value={obj.forecast} color="bg-muted-foreground/30" height="h-1" />
                <span className="text-[9px] text-muted-foreground w-8 text-right shrink-0">{obj.forecast}% ↗</span>
              </div>
            )}
          </div>
          {showKRs && krs.length > 0 && (
            <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors shrink-0 text-[8px]" data-testid={`toggle-krs-${obj.id}`}>{open ? "▴" : "▾"}</button>
          )}
        </div>
      </div>
      {showKRs && open && krs.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2.5 bg-muted/10" data-testid={`krs-panel-${obj.id}`}>
          <p className="text-[8px] text-muted-foreground uppercase tracking-wide">Key Results ({krs.length})</p>
          {krs.map(kr => (
            <div key={kr.id} className="space-y-1" data-testid={`kr-inline-${kr.id}`}>
              <div className="flex items-center gap-2">
                <p className="text-[9px] flex-1">{kr.title}</p>
                <span className="text-[8px] text-muted-foreground shrink-0">{formatKRValue(kr)}</span>
                <StatusBadge s={kr.status} />
              </div>
              <ProgressBar value={krProgress(kr)} color={krBarColor(kr.status)} height="h-1.5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Objective Modal ──────────────────────────────────────────────────────

function NewObjectiveModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", theme: "Growth", owner: "AI COO", department: "Revenue", priority: "high", deadline: "", description: "" });
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/strategy/create-objective", form),
    onSuccess: () => { toast({ title: "Objective created" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to create objective", variant: "destructive" }),
  });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="new-obj-modal">
      <div className="bg-background rounded-2xl border shadow-xl w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold flex items-center gap-2"><Target className="h-4 w-4 text-primary" />New Strategic Objective</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-obj-modal"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2.5">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Objective title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-obj-title" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Description — what does success look like?…" className="w-full h-16 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="textarea-obj-description" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Theme</p>
              <select value={form.theme} onChange={e => setForm(p => ({ ...p, theme: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs" data-testid="select-obj-theme">
                {["Growth","Expansion","Retention","Efficiency","Activation"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Priority</p>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs" data-testid="select-obj-priority">
                {["low","medium","high","critical"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Owner</p>
              <input value={form.owner} onChange={e => setForm(p => ({ ...p, owner: e.target.value }))} placeholder="e.g. Revenue Director" className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs" data-testid="input-obj-owner" />
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Deadline</p>
              <input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs" data-testid="input-obj-deadline" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-obj">Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!form.title.trim() || mutation.isPending} data-testid="button-confirm-obj">
            {mutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Target className="h-3.5 w-3.5 mr-1.5" />}
            Create Objective
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview",              icon: Compass    },
  { id: "objectives",  label: "Objectives",            icon: Target     },
  { id: "keyresults",  label: "Key Results",           icon: Flag       },
  { id: "initiatives", label: "Initiatives",           icon: Zap        },
  { id: "scorecards",  label: "Dept Scorecards",       icon: Building2  },
  { id: "alignment",   label: "Alignment",             icon: GitMerge   },
  { id: "forecasting", label: "Forecasting",           icon: TrendingUp },
  { id: "analytics",   label: "Analytics",             icon: BarChart3  },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/strategy/overview"], staleTime: 60_000 });
  const { data: objData } = useQuery<{ objectives: Objective[] }>({ queryKey: ["/api/strategy/objectives"], staleTime: 30_000 });

  return (
    <div className="space-y-5" data-testid="tab-overview-strategy">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "On Track",         value: data?.onTrack ?? "—",                            color: "text-emerald-600 dark:text-emerald-400" },
          { label: "At Risk",          value: data?.atRisk ?? "—",                             color: (data?.atRisk ?? 0) > 0 ? "text-rose-500" : "text-muted-foreground" },
          { label: "Avg Progress",     value: data ? `${data.avgProgress}%` : "—",             color: "text-primary" },
          { label: "Alignment Score",  value: data ? `${data.strategicAlignmentScore}` : "—",  color: "text-violet-600 dark:text-violet-400" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`strategy-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Overall progress */}
      {data && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Objective Status</p>
            {[
              { label: "Ahead",     value: data.ahead,   color: "bg-blue-500",    textColor: "text-blue-600 dark:text-blue-400" },
              { label: "On Track",  value: data.onTrack, color: "bg-emerald-500", textColor: "text-emerald-600 dark:text-emerald-400" },
              { label: "At Risk",   value: data.atRisk,  color: "bg-rose-500",    textColor: "text-rose-500" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 mb-2">
                <span className="text-[9px] w-16">{s.label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${s.color}`} style={{ width: `${(s.value / data.totalObjectives) * 100}%` }} />
                </div>
                <span className={`text-[9px] font-bold w-4 text-right ${s.textColor}`}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Key Results Progress</p>
            <div className="text-center py-2">
              <p className="text-3xl font-extrabold text-violet-600 dark:text-violet-400">{data.achievedKeyResults}<span className="text-lg text-muted-foreground font-normal">/{data.totalKeyResults}</span></p>
              <p className="text-[9px] text-muted-foreground mt-1">Key Results Achieved</p>
            </div>
            <div className="mt-3">
              <ProgressBar value={Math.round((data.achievedKeyResults / data.totalKeyResults) * 100)} color="bg-violet-500" height="h-2.5" />
              <p className="text-[9px] text-muted-foreground text-center mt-1">{Math.round((data.achievedKeyResults / data.totalKeyResults) * 100)}% complete</p>
            </div>
          </div>
        </div>
      )}

      {/* Objectives quick view */}
      {objData && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Strategic Objectives</p>
            <button onClick={() => setTab("objectives")} className="text-[9px] text-primary hover:underline" data-testid="link-view-objectives">View all →</button>
          </div>
          <div className="space-y-2">
            {objData.objectives.map(obj => (
              <div key={obj.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`obj-quick-${obj.id}`}>
                <Target className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold truncate">{obj.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <ProgressBar value={obj.progress} color={obj.status === "ahead" ? "bg-blue-500" : obj.status === "at_risk" ? "bg-rose-500" : "bg-emerald-500"} height="h-1.5" />
                    <span className="text-[9px] font-bold shrink-0 w-8 text-right">{obj.progress}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <ThemeBadge theme={obj.theme} />
                  <StatusBadge s={obj.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {isLoading && <Skeleton className="h-48 rounded-xl" />}
    </div>
  );
}

// ─── Tab: Objectives ──────────────────────────────────────────────────────────

function ObjectivesTab() {
  const { data, isLoading } = useQuery<{ objectives: Objective[] }>({ queryKey: ["/api/strategy/objectives"], staleTime: 30_000 });
  const [filter, setFilter] = useState("all");
  const objectives = data?.objectives ?? [];
  const themes = [...new Set(objectives.map(o => o.theme))];
  const filtered = objectives.filter(o => filter === "all" || o.theme === filter);

  return (
    <div className="space-y-4" data-testid="tab-objectives">
      <div className="flex flex-wrap gap-1">
        {["all", ...themes].map(t => (
          <button key={t} onClick={() => setFilter(t)} data-testid={`filter-theme-${t}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {filtered.map(obj => <ObjectiveCard key={obj.id} obj={obj} showKRs />)}
          {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No objectives match.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Key Results ─────────────────────────────────────────────────────────

function KeyResultsTab() {
  const { data: objData } = useQuery<{ objectives: Objective[] }>({ queryKey: ["/api/strategy/objectives"], staleTime: 30_000 });
  const { data, isLoading } = useQuery<{ keyResults: KeyResult[]; total: number; byStatus: Record<string, number> }>({ queryKey: ["/api/strategy/key-results"], staleTime: 30_000 });
  const [filter, setFilter] = useState("all");
  const krs = data?.keyResults ?? [];
  const filtered = krs.filter(kr => filter === "all" || kr.status === filter);

  return (
    <div className="space-y-4" data-testid="tab-keyresults">
      {data && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Achieved",  value: data.byStatus.achieved  ?? 0, color: "text-violet-600 dark:text-violet-400" },
            { label: "On Track",  value: data.byStatus.on_track  ?? 0, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "At Risk",   value: data.byStatus.at_risk   ?? 0, color: "text-rose-500" },
            { label: "Total",     value: data.total,                   color: "text-primary" },
          ].map(k => (
            <div key={k.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`kr-stat-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {["all", "achieved", "on_track", "at_risk"].map(s => (
          <button key={s} onClick={() => setFilter(s)} data-testid={`filter-kr-status-${s}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${filter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s.replace("_", " ")}
          </button>
        ))}
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {filtered.map(kr => {
            const obj = objData?.objectives.find(o => o.id === kr.objectiveId);
            const pct = krProgress(kr);
            return (
              <div key={kr.id} className="p-4 rounded-xl border bg-card" data-testid={`kr-card-${kr.id}`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${kr.status === "achieved" ? "bg-violet-100 dark:bg-violet-900/30" : kr.status === "at_risk" ? "bg-rose-100 dark:bg-rose-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}`}>
                    <Flag className={`h-3.5 w-3.5 ${kr.status === "achieved" ? "text-violet-500" : kr.status === "at_risk" ? "text-rose-500" : "text-emerald-500"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <p className="text-[10px] font-bold flex-1 truncate">{kr.title}</p>
                      <StatusBadge s={kr.status} />
                    </div>
                    {obj && <p className="text-[8px] text-muted-foreground mb-1.5">↳ <ThemeBadge theme={obj.theme} /> {obj.title.substring(0, 50)}…</p>}
                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
                      <div className="flex items-center gap-1"><AgentDot name={kr.owner} /><span>{kr.owner}</span></div>
                      <span>·</span>
                      <span className="font-semibold text-foreground">{formatKRValue(kr)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={pct} color={krBarColor(kr.status)} height="h-2" />
                      <span className="text-[9px] font-bold shrink-0 w-8 text-right">{pct}%</span>
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

// ─── Tab: Initiatives ─────────────────────────────────────────────────────────

function InitiativesTab() {
  const { data, isLoading } = useQuery<{ initiatives: Initiative[]; total: number; active: number }>({ queryKey: ["/api/strategy/initiatives"], staleTime: 30_000 });

  return (
    <div className="space-y-4" data-testid="tab-initiatives">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.active}</p>
            <p className="text-[9px] text-muted-foreground">Active</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{data.initiatives.filter(i => i.status === "completed").length}</p>
            <p className="text-[9px] text-muted-foreground">Completed</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-muted-foreground">{data.total}</p>
            <p className="text-[9px] text-muted-foreground">Total</p>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.initiatives ?? []).map(init => (
            <div key={init.id} className="rounded-xl border bg-card overflow-hidden" data-testid={`init-card-${init.id}`}>
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${init.status === "completed" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
                    <Zap className={`h-4 w-4 ${init.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <p className="text-xs font-bold flex-1 truncate">{init.title}</p>
                      <StatusBadge s={init.status} />
                    </div>
                    <p className="text-[9px] text-muted-foreground mb-2 leading-relaxed">{init.description}</p>
                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
                      <div className="flex items-center gap-1"><AgentDot name={init.lead} /><span>Lead: {init.lead}</span></div>
                      <span>·</span>
                      <span>Due {new Date(init.deadline).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}</span>
                      <span>·</span>
                      <span>{init.completedTasks}/{init.taskCount} tasks</span>
                    </div>
                    {/* Linked objectives */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(init.linkedObjectives ?? []).map(obj => <ThemeBadge key={obj.id} theme={obj.theme} />)}
                    </div>
                    {/* Departments */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {init.departments.map(dept => <Badge key={dept} variant="outline" className="text-[8px] px-1.5 py-0 h-4">{dept}</Badge>)}
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={init.progress} color={init.status === "completed" ? "bg-emerald-500" : "bg-primary"} height="h-2" />
                      <span className="text-[10px] font-bold shrink-0 w-8 text-right">{init.progress}%</span>
                    </div>
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

// ─── Tab: Department Scorecards ───────────────────────────────────────────────

function ScorecardsTab() {
  const { data, isLoading } = useQuery<{ scorecards: Scorecard[]; avgScore: number; topDepartment: string; lowestDepartment: string }>({ queryKey: ["/api/strategy/scorecards"], staleTime: 60_000 });

  const METRIC_STATUS_COLORS: Record<string, string> = { exceeded: "text-blue-600 dark:text-blue-400", on_track: "text-emerald-600 dark:text-emerald-400", at_risk: "text-rose-500" };

  return (
    <div className="space-y-4" data-testid="tab-scorecards">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.avgScore}</p>
            <p className="text-[9px] text-muted-foreground">Avg Score</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 truncate">{data.topDepartment}</p>
            <p className="text-[9px] text-muted-foreground">Top Dept</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400 truncate">{data.lowestDepartment}</p>
            <p className="text-[9px] text-muted-foreground">Needs Attention</p>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.scorecards ?? []).sort((a, b) => b.score - a.score).map(sc => (
            <div key={sc.department} className="rounded-xl border bg-card overflow-hidden" data-testid={`scorecard-${sc.department.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5"><Building2 className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <p className="text-xs font-bold">{sc.department}</p>
                      <span className="text-[9px] text-muted-foreground">{sc.head}</span>
                      <span className="ml-auto text-sm font-extrabold text-primary">{sc.score}<span className="text-muted-foreground text-[9px] font-normal">/100</span></span>
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between mb-1">
                        <span className="text-[8px] text-muted-foreground">Dept Score</span>
                        <span className="text-[8px] text-muted-foreground">Alignment: {sc.alignmentScore}%</span>
                      </div>
                      <ProgressBar value={sc.score} color={sc.score >= 90 ? "bg-emerald-500" : sc.score >= 75 ? "bg-primary" : "bg-amber-500"} height="h-2" />
                    </div>
                    <div className="space-y-1.5">
                      {sc.metrics.map(m => (
                        <div key={m.name} className="flex items-center gap-2" data-testid={`metric-${sc.department.toLowerCase().replace(/\s+/g, "-")}-${m.name.toLowerCase().replace(/\s+/g, "-")}`}>
                          <span className="text-[8px] text-muted-foreground w-32 shrink-0 truncate">{m.name}</span>
                          <span className={`text-[9px] font-bold flex-1 ${METRIC_STATUS_COLORS[m.status] ?? "text-foreground"}`}>{m.actual}</span>
                          <span className="text-[8px] text-muted-foreground">target: {m.target}</span>
                          <StatusBadge s={m.status} />
                        </div>
                      ))}
                    </div>
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

// ─── Tab: Alignment ───────────────────────────────────────────────────────────

function AlignmentTab() {
  const { data, isLoading } = useQuery<{ alignmentMap: AlignmentItem[]; strategicAlignmentScore: number; departmentAlignment: { department: string; alignmentScore: number; score: number }[]; misaligned: { department: string; alignmentScore: number }[] }>({ queryKey: ["/api/strategy/alignment"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-alignment">
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border bg-card text-center">
              <p className="text-xl font-extrabold text-primary">{data.strategicAlignmentScore}%</p>
              <p className="text-[9px] text-muted-foreground">Strategic Alignment</p>
            </div>
            <div className="p-3 rounded-xl border bg-card text-center">
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{data.departmentAlignment.filter(d => d.alignmentScore >= 80).length}</p>
              <p className="text-[9px] text-muted-foreground">Aligned Depts</p>
            </div>
            <div className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${data.misaligned.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{data.misaligned.length}</p>
              <p className="text-[9px] text-muted-foreground">Need Alignment</p>
            </div>
          </div>

          {/* Dept alignment bars */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Department Alignment Scores</p>
            <div className="space-y-2.5">
              {data.departmentAlignment.sort((a, b) => b.alignmentScore - a.alignmentScore).map(d => (
                <div key={d.department} className="flex items-center gap-2" data-testid={`alignment-dept-${d.department.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-[9px] w-32 shrink-0 truncate">{d.department}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${d.alignmentScore >= 90 ? "bg-emerald-500" : d.alignmentScore >= 80 ? "bg-primary" : "bg-amber-500"}`} style={{ width: `${d.alignmentScore}%` }} />
                  </div>
                  <span className={`text-[9px] font-bold w-8 text-right shrink-0 ${d.alignmentScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : d.alignmentScore >= 80 ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}>{d.alignmentScore}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Objective → Initiative alignment map */}
          <div className="space-y-3">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Objective → Initiative Alignment</p>
            {data.alignmentMap.map(item => (
              <div key={item.objectiveId} className="p-4 rounded-xl border bg-card" data-testid={`alignment-obj-${item.objectiveId}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <Target className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-[10px] font-bold flex-1 truncate">{item.objectiveTitle}</p>
                  <ThemeBadge theme={item.theme} />
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{item.keyResults} KRs</Badge>
                </div>
                {item.initiatives.length > 0 ? (
                  <div className="ml-5 space-y-1.5">
                    {item.initiatives.map(init => (
                      <div key={init.id} className="flex items-center gap-2" data-testid={`alignment-init-${init.id}`}>
                        <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                        <p className="text-[9px] flex-1 truncate">{init.title}</p>
                        <StatusBadge s={init.status} />
                        <span className="text-[8px] font-bold text-muted-foreground">{init.progress}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-amber-600 dark:text-amber-400 ml-5">⚠ No initiatives linked — alignment gap</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {isLoading && <Skeleton className="h-64 rounded-xl" />}
    </div>
  );
}

// ─── Tab: Forecasting ─────────────────────────────────────────────────────────

function ForecastingTab() {
  const { data, isLoading } = useQuery<{ forecasts: Forecast[]; avgForecastedProgress: number; atRiskCount: number }>({ queryKey: ["/api/strategy/forecasting"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-forecasting">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{data.avgForecastedProgress}%</p>
            <p className="text-[9px] text-muted-foreground">Avg Forecasted Progress</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className={`text-xl font-extrabold ${data.atRiskCount > 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}`}>{data.atRiskCount}</p>
            <p className="text-[9px] text-muted-foreground">At-Risk Objectives</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400">{data.forecasts.filter(f => f.status === "ahead").length}</p>
            <p className="text-[9px] text-muted-foreground">Ahead of Schedule</p>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.forecasts ?? []).map(f => (
            <div key={f.id} className="p-4 rounded-xl border bg-card" data-testid={`forecast-${f.id}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${f.status === "ahead" ? "bg-blue-100 dark:bg-blue-900/30" : f.status === "at_risk" ? "bg-rose-100 dark:bg-rose-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}`}>
                  <TrendingUp className={`h-3.5 w-3.5 ${f.status === "ahead" ? "text-blue-500" : f.status === "at_risk" ? "text-rose-500" : "text-emerald-500"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-[10px] font-bold flex-1 truncate">{f.title}</p>
                    <StatusBadge s={f.status} />
                    <ThemeBadge theme={f.theme} />
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2.5 flex-wrap">
                    <div className="flex items-center gap-1"><AgentDot name={f.owner} /><span>{f.owner}</span></div>
                    <span>·</span>
                    <span>Due {new Date(f.deadline).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}</span>
                    <span>·</span>
                    <span className="font-bold text-foreground">{f.confidence}% confidence</span>
                    <span>·</span>
                    <span className={f.onTimeProb >= 75 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-rose-500 font-bold"}>{f.onTimeProb}% on-time prob.</span>
                  </div>
                  {/* Progress vs forecast */}
                  <div className="space-y-1 mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-muted-foreground w-16 shrink-0">Current</span>
                      <ProgressBar value={f.currentProgress} color={f.status === "ahead" ? "bg-blue-500" : f.status === "at_risk" ? "bg-rose-500" : "bg-emerald-500"} height="h-2" />
                      <span className="text-[9px] font-bold w-8 text-right shrink-0">{f.currentProgress}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-muted-foreground w-16 shrink-0">Forecast</span>
                      <ProgressBar value={f.forecastedProgress} color="bg-muted-foreground/40" height="h-1.5" />
                      <span className="text-[9px] font-bold text-muted-foreground w-8 text-right shrink-0">{f.forecastedProgress}%</span>
                    </div>
                  </div>
                  {/* AI recommendation */}
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/20">
                    <Star className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[8px] text-muted-foreground italic">{f.aiRecommendation}</p>
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

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<Analytics>({ queryKey: ["/api/strategy/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-strategy">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Objectives",        value: data?.totalObjectives ?? "—",                        color: "text-primary" },
          { label: "Avg Progress",      value: data ? `${data.avgObjectiveProgress}%` : "—",        color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Dept Avg Score",    value: data ? `${data.avgDepartmentScore}/100` : "—",       color: "text-violet-600 dark:text-violet-400" },
          { label: "Alignment Score",   value: data ? `${data.strategicAlignmentScore}%` : "—",    color: "text-blue-600 dark:text-blue-400" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`analytics-strategy-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* By theme */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Objectives by Theme</p>
              <div className="space-y-2">
                {Object.entries(data.byTheme).map(([theme, count]) => (
                  <div key={theme} className="flex items-center gap-2">
                    <ThemeBadge theme={theme} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / data.totalObjectives) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* By status */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Objectives by Status</p>
              <div className="space-y-2">
                {Object.entries(data.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <StatusBadge s={status} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / data.totalObjectives) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* KR status breakdown */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Key Results by Status</p>
              <div className="space-y-2">
                {Object.entries(data.krByStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <StatusBadge s={status} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / data.totalKeyResults) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Initiative status */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Initiative Completion</p>
              <div className="text-center py-3">
                <p className="text-3xl font-extrabold text-primary">{data.initiativeCompletionRate}%</p>
                <p className="text-[9px] text-muted-foreground mt-1">initiatives completed</p>
              </div>
              <ProgressBar value={data.initiativeCompletionRate} color="bg-emerald-500" height="h-2.5" />
            </div>
          </div>

          {/* Strategic summary */}
          <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Star className="h-3 w-3 text-amber-500" />AI COO Strategic Assessment</p>
            <div className="space-y-1.5">
              {[
                { text: "Revenue trajectory on track for 78% of target — 3 KRs need acceleration.", ok: true  },
                { text: "Partnerships objective is at risk — white-label partner sign rate is behind forecast.", ok: false },
                { text: "Operations dept is the top-aligned department (96%) and ahead on agent productivity.", ok: true  },
                { text: "Customer Success churn at 6.2% vs 5% target — Day-3 protocol coverage needs to reach 100%.", ok: false },
                { text: "Governance and Finance departments are fully aligned with zero policy violations.", ok: true  },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  {item.ok ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />}
                  <p className={`text-[9px] ${item.ok ? "" : "text-amber-700 dark:text-amber-300"}`}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminStrategyPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showNewObj, setShowNewObj] = useState(false);
  const qc = useQueryClient();

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/strategy/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-strategy">
      {showNewObj && <NewObjectiveModal onClose={() => setShowNewObj(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["/api/strategy/objectives"] }); qc.invalidateQueries({ queryKey: ["/api/strategy/overview"] }); }} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/organization">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Organization Center
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Strategy Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Company objectives, OKRs, and strategic initiatives — every agent action aligned to measurable business outcomes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overview && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "On Track", value: overview.onTrack,                       color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Alignment",value: `${overview.strategicAlignmentScore}%`, color: "text-primary" },
                { label: "Progress", value: `${overview.avgProgress}%`,             color: "text-violet-600 dark:text-violet-400" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setShowNewObj(true)} data-testid="button-new-objective">
            <Plus className="h-4 w-4" />New Objective
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Governance",   href: "/admin/governance"   },
          { label: "Organization", href: "/admin/organization" },
          { label: "Strategy",     href: null                  },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="strategy-status-bar">
        {[
          { label: "Objectives",   value: overview?.totalObjectives ?? "—",          color: "text-primary",                                icon: <Target       className="h-3.5 w-3.5 text-primary" />,    tab: "objectives"  as TabId },
          { label: "Key Results",  value: overview?.totalKeyResults ?? "—",          color: "text-violet-600 dark:text-violet-400",        icon: <Flag         className="h-3.5 w-3.5 text-violet-500" />,  tab: "keyresults"  as TabId },
          { label: "Initiatives",  value: overview?.activeInitiatives ?? "—",        color: "text-amber-600 dark:text-amber-400",          icon: <Zap          className="h-3.5 w-3.5 text-amber-500" />,   tab: "initiatives" as TabId },
          { label: "At Risk",      value: overview?.atRisk ?? "—",                   color: (overview?.atRisk ?? 0) > 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400", icon: <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />, tab: "forecasting" as TabId },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-strategy">
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
        {activeTab === "overview"    && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "objectives"  && <ObjectivesTab />}
        {activeTab === "keyresults"  && <KeyResultsTab />}
        {activeTab === "initiatives" && <InitiativesTab />}
        {activeTab === "scorecards"  && <ScorecardsTab />}
        {activeTab === "alignment"   && <AlignmentTab />}
        {activeTab === "forecasting" && <ForecastingTab />}
        {activeTab === "analytics"   && <AnalyticsTab />}
      </div>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5" data-testid="architecture-complete-20">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Organizational Performance & Strategic Alignment — Phase 20 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">The digital organization is now strategically aligned. Every department, agent, task, decision, SOP, and initiative is tied to measurable company objectives. Organization answers who owns the work. Strategy answers why it exists.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace","Org Memory","SOP System","Governance","Organization","Strategy",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 24 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
