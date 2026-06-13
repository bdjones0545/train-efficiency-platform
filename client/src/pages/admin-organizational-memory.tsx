import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Brain, ChevronRight, Layers, RefreshCw, Search,
  BookOpen, CheckSquare, Lightbulb, Shield, GitBranch, BarChart3,
  X, Plus, TrendingUp, Star, Activity, Users, AlertTriangle,
  CheckCircle, ArrowRightLeft, ClipboardList, Zap, Clock, Tag,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Memory = { id: string; title: string; memoryType: string; category: string; department: string; content: string; source: string; createdByAgent: string; confidenceScore: number; impactScore: number; usageCount: number; createdAt: string; updatedAt: string; isAutoLearning?: boolean };
type Overview = { total: number; autoLearnings?: number; byType: Record<string, number>; avgConfidenceScore: number; totalUsageEvents: number; knowledgeHealthScore: number; learningVelocity: number; institutionalIntelligenceScore: number; relationships: number; generatedAt: string };
type SearchResult = { results: Memory[]; query: string; total: number; generatedAt: string };
type PlaybooksData = { playbooks: Memory[]; policies: Memory[]; totalPlaybooks: number; totalPolicies: number; generatedAt: string };
type GraphNode = { id: string; label: string; type: string; department: string; confidenceScore: number; usageCount: number };
type GraphEdge = { id: string; sourceMemoryId: string; relatedMemoryId: string; relationshipType: string; sourceTitle: string; relatedTitle: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; total: number; relationships: number; generatedAt: string };
type AnalyticsData = { totalMemories: number; autoLearnings?: number; totalRelationships: number; avgConfidenceScore: number; avgImpactScore: number; totalUsageEvents: number; knowledgeHealthScore: number; learningVelocity: number; institutionalIntelligenceScore: number; byDepartment: Record<string, number>; byType: Record<string, number>; topReferencedMemories: { id: string; title: string; usageCount: number; memoryType: string }[]; highImpactMemories: { id: string; title: string; impactScore: number; memoryType: string }[]; generatedAt: string };

type HermesLearning = {
  id: string; orgId: string; domain: string; metric: string | null; delta: string | null;
  outcome: string; observation: string; learning: string; source: string;
  memoryType: string; department: string; category: string;
  confidenceScore: number; impactScore: number;
  relatedEntityType: string | null; relatedEntityId: string | null;
  createdAt: string; updatedAt: string;
};
type HermesLearningsData = {
  learnings: HermesLearning[];
  total: number;
  bySource: Record<string, number>;
  byDomain: Record<string, number>;
  generatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  decision:  { label: "Decision",  color: "bg-primary/10 text-primary",                                     icon: <CheckSquare  className="h-3.5 w-3.5" /> },
  lesson:    { label: "Lesson",    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",   icon: <Lightbulb    className="h-3.5 w-3.5" /> },
  playbook:  { label: "Playbook",  color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: <BookOpen  className="h-3.5 w-3.5" /> },
  policy:    { label: "Policy",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",    icon: <Shield    className="h-3.5 w-3.5" /> },
  procedure: { label: "Procedure", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",            icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
  research:  { label: "Research",  color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",            icon: <Search    className="h-3.5 w-3.5" /> },
  insight:   { label: "Insight",   color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",            icon: <TrendingUp className="h-3.5 w-3.5" /> },
  outcome:   { label: "Outcome",   color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",           icon: <Activity  className="h-3.5 w-3.5" /> },
};

function TypeBadge({ t }: { t: string }) {
  const cfg = TYPE_CONFIG[t] ?? { label: t, color: "bg-muted text-muted-foreground", icon: null };
  return (
    <Badge className={`text-[8px] px-1.5 py-0 h-4 flex items-center gap-0.5 ${cfg.color}`}>
      {cfg.icon}<span>{cfg.label}</span>
    </Badge>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 75 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";
  return <span className={`text-[9px] font-bold ${color}`}>{score}%</span>;
}

function AgentDot({ name }: { name: string }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Agent": "bg-emerald-500", "Email Agent": "bg-blue-500", "Research Agent": "bg-amber-500", "Scheduling Agent": "bg-teal-500", "PAIL Engine": "bg-indigo-500", "CEO Heartbeat": "bg-primary", "Intelligence Engine": "bg-rose-500", "Customer Success Agent": "bg-cyan-500" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  return <div className={`h-5 w-5 ${color} rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0`}>{initials}</div>;
}

// ─── Memory Card ──────────────────────────────────────────────────────────────

function MemoryCard({ memory, expanded = false }: { memory: Memory; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  return (
    <div className="p-4 rounded-xl border bg-card" data-testid={`memory-card-${memory.id}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
          {TYPE_CONFIG[memory.memoryType]?.icon ?? <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <p className="text-xs font-bold flex-1 truncate">{memory.title}</p>
            <TypeBadge t={memory.memoryType} />
            <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{memory.department}</Badge>
          </div>
          <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
            <div className="flex items-center gap-1">
              <AgentDot name={memory.createdByAgent} />
              <span>{memory.createdByAgent}</span>
            </div>
            <span>·</span>
            <span>Confidence <ConfidenceBadge score={memory.confidenceScore} /></span>
            <span>·</span>
            <span>Impact <span className="font-bold text-foreground">{memory.impactScore}</span></span>
            <span>·</span>
            <span><span className="font-bold text-foreground">{memory.usageCount}</span> uses</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(memory.updatedAt), { addSuffix: true })}</span>
          </div>
          {open ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">{memory.content}</p>
          ) : (
            <p className="text-[10px] text-muted-foreground line-clamp-2">{memory.content}</p>
          )}
          <button onClick={() => setOpen(!open)} className="mt-1.5 text-[9px] text-primary hover:underline" data-testid={`toggle-memory-${memory.id}`}>
            {open ? "Show less" : "Read full memory"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",   label: "Overview",        icon: Brain        },
  { id: "hermes",     label: "Hermes Learnings",icon: Zap          },
  { id: "knowledge",  label: "Knowledge Base",  icon: BookOpen     },
  { id: "decisions",  label: "Decisions",       icon: CheckSquare  },
  { id: "lessons",    label: "Lessons Learned", icon: Lightbulb    },
  { id: "playbooks",  label: "Playbooks",       icon: BookOpen     },
  { id: "policies",   label: "Policies",        icon: Shield       },
  { id: "search",     label: "Search",          icon: Search       },
  { id: "graph",      label: "Knowledge Graph", icon: GitBranch    },
  { id: "analytics",  label: "Analytics",       icon: BarChart3    },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Create Memory Modal ──────────────────────────────────────────────────────

function CreateMemoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", content: "", memoryType: "lesson", category: "", department: "Revenue", confidenceScore: 80 });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/organizational-memory/create", { ...form, createdByAgent: "Human Admin", source: "Human Admin" }),
    onSuccess: () => { toast({ title: "Memory saved to knowledge base" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to save memory", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="create-memory-modal">
      <div className="bg-background rounded-2xl border shadow-xl w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Add to Organizational Memory</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-memory-modal"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2.5">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Knowledge title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-memory-title" />
          <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="Full knowledge content — the more detail, the more useful this becomes as institutional memory…" className="w-full h-28 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="input-memory-content" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Memory Type</p>
              <select value={form.memoryType} onChange={e => setForm(p => ({ ...p, memoryType: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-memory-type">
                {Object.keys(TYPE_CONFIG).map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Department</p>
              <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-memory-dept">
                {["Revenue","Operations","Marketing","Customer Success","Intelligence","Engineering","Partnerships"].map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Category</p>
              <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. Pricing, Sales, Email…" className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-memory-category" />
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Confidence ({form.confidenceScore}%)</p>
              <input type="range" min={0} max={100} value={form.confidenceScore} onChange={e => setForm(p => ({ ...p, confidenceScore: +e.target.value }))} className="w-full mt-1" data-testid="range-confidence" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-memory">Cancel</Button>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={!form.title.trim() || !form.content.trim() || createMutation.isPending} data-testid="button-confirm-memory">
            {createMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Save Memory
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/organizational-memory/overview"], staleTime: 60_000 });

  const TYPE_ICONS: Record<string, React.ReactNode> = {
    decision:  <CheckSquare className="h-3.5 w-3.5 text-primary" />,
    lesson:    <Lightbulb   className="h-3.5 w-3.5 text-amber-500" />,
    playbook:  <BookOpen    className="h-3.5 w-3.5 text-emerald-500" />,
    policy:    <Shield      className="h-3.5 w-3.5 text-violet-500" />,
    research:  <Search      className="h-3.5 w-3.5 text-teal-500" />,
    insight:   <TrendingUp  className="h-3.5 w-3.5 text-rose-500" />,
    outcome:   <Activity    className="h-3.5 w-3.5 text-muted-foreground" />,
  };

  return (
    <div className="space-y-5" data-testid="tab-overview-memory">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Memories",          value: data?.total ?? "—",                                      color: "text-primary" },
          { label: "Auto-Learnings",           value: data?.autoLearnings ?? 0,                                color: "text-amber-600 dark:text-amber-400" },
          { label: "Knowledge Health",         value: data ? `${data.knowledgeHealthScore}/100` : "—",         color: data && data.knowledgeHealthScore >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          { label: "Learning Velocity",        value: data ? `${data.learningVelocity}/wk` : "—",             color: "text-blue-600 dark:text-blue-400" },
          { label: "Intelligence Score",       value: data ? `${data.institutionalIntelligenceScore}/100` : "—", color: "text-primary" },
          { label: "Knowledge Relationships",  value: data?.relationships ?? "—",                              color: "text-violet-600 dark:text-violet-400" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : data && (
        <>
          {/* By type breakdown */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Memory by Type</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(data.byType).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
                  <span className="shrink-0">{TYPE_ICONS[type] ?? <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />}</span>
                  <div>
                    <p className="text-xs font-bold">{count}</p>
                    <p className="text-[8px] text-muted-foreground capitalize">{type}s</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Health bars */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Knowledge Health Indicators</p>
            <div className="space-y-3">
              {[
                { label: "Knowledge Health Score",         value: data.knowledgeHealthScore,          max: 100, color: "bg-emerald-500" },
                { label: "Avg Confidence Score",           value: data.avgConfidenceScore,            max: 100, color: "bg-primary" },
                { label: "Institutional Intelligence",     value: data.institutionalIntelligenceScore,max: 100, color: "bg-violet-500" },
                { label: "Learning Velocity (×10 scale)",  value: Math.min(data.learningVelocity * 10, 100), max: 100, color: "bg-amber-500" },
              ].map(bar => (
                <div key={bar.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px]">{bar.label}</span>
                    <span className="text-[9px] font-bold">{bar.label.includes("Velocity") ? `${data.learningVelocity}/wk` : `${bar.value}%`}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${bar.color} transition-all`} style={{ width: `${(bar.value / bar.max) * 100}%` }} />
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

// ─── Tab: Hermes Auto-Learnings ───────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  ceo_heartbeat:                    { label: "CEO Heartbeat",       color: "bg-primary/10 text-primary border-primary/20" },
  workflow_execution:               { label: "Workflow",            color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  agentmail_decision:               { label: "AgentMail",          color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  agentmail_reply_classification:   { label: "Reply Intel",        color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  human_admin:                      { label: "Human Admin",        color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-800" },
  software_improvement_task_created:{ label: "Software Fix",       color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
  communication_outcome_recorded:   { label: "Comms Outcome",      color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-800" },
};

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_CONFIG[source] ?? { label: source.replace(/_/g, " "), color: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 h-4 border ${cfg.color}`}>
      {cfg.label}
    </Badge>
  );
}

function HermesLearningCard({ learning }: { learning: HermesLearning }) {
  const [open, setOpen] = useState(false);
  const conf = learning.confidenceScore;
  const confColor = conf >= 90 ? "text-emerald-600 dark:text-emerald-400" : conf >= 75 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";

  return (
    <div className="p-4 rounded-xl border bg-card" data-testid={`hermes-card-${learning.id}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/5 border border-primary/10 shrink-0 mt-0.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <p className="text-xs font-semibold flex-1 truncate">{learning.domain}</p>
            <SourceBadge source={learning.source} />
            <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{learning.department}</Badge>
          </div>
          <div className="flex items-center gap-2.5 text-[9px] text-muted-foreground mb-2 flex-wrap">
            <span className={`font-bold ${confColor}`}>{conf}% conf</span>
            <span>·</span>
            <span className="capitalize">{learning.memoryType}</span>
            {learning.metric && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5"><Tag className="h-2.5 w-2.5" />{learning.metric}{learning.delta ? `: ${learning.delta}` : ""}</span>
              </>
            )}
            <span>·</span>
            <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{formatDistanceToNow(new Date(learning.createdAt), { addSuffix: true })}</span>
          </div>
          <p className="text-[10px] font-semibold text-foreground mb-0.5">Outcome: <span className="font-normal text-muted-foreground">{learning.outcome}</span></p>
          {open && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px]"><span className="font-semibold">Observation:</span> <span className="text-muted-foreground">{learning.observation}</span></p>
              <p className="text-[10px]"><span className="font-semibold">Learning:</span> <span className="text-muted-foreground">{learning.learning}</span></p>
              {learning.relatedEntityType && (
                <p className="text-[9px] text-muted-foreground">Related: {learning.relatedEntityType} {learning.relatedEntityId ? `· ${learning.relatedEntityId.slice(0, 12)}…` : ""}</p>
              )}
            </div>
          )}
          <button onClick={() => setOpen(!open)} className="mt-1.5 text-[9px] text-primary hover:underline" data-testid={`toggle-hermes-${learning.id}`}>
            {open ? "Show less" : "Read full learning"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HermesLearningsTab() {
  const [sourceFilter, setSourceFilter] = useState("all");
  const { data, isLoading, refetch } = useQuery<HermesLearningsData>({
    queryKey: ["/api/organizational-memory/hermes-learnings", sourceFilter],
    queryFn: () => fetchJson(`/api/organizational-memory/hermes-learnings${sourceFilter !== "all" ? `?source=${encodeURIComponent(sourceFilter)}` : ""}`),
    staleTime: 15_000,
  });

  const learnings = data?.learnings ?? [];
  const bySource = data?.bySource ?? {};
  const sources = Object.keys(bySource).sort((a, b) => bySource[b] - bySource[a]);

  return (
    <div className="space-y-4" data-testid="tab-hermes-learnings">
      {/* Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
        <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5">Hermes Automatic Learning Capture</p>
          <p className="text-[10px] text-muted-foreground">
            Hermes monitors real system events — heartbeats, workflow decisions, approval outcomes, reply intelligence — and automatically converts them into structured, searchable learnings stored permanently in the database.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-muted-foreground shrink-0" onClick={() => refetch()} data-testid="button-refresh-hermes">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center" data-testid="hermes-stat-total">
            <p className="text-xl font-extrabold text-primary">{data.total}</p>
            <p className="text-[9px] text-muted-foreground">Total Learnings</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400">{sources.length}</p>
            <p className="text-[9px] text-muted-foreground">Active Sources</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{Object.keys(data.byDomain).length}</p>
            <p className="text-[9px] text-muted-foreground">Domains Covered</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-amber-600 dark:text-amber-400">
              {learnings.length > 0 ? Math.round(learnings.reduce((s, l) => s + l.confidenceScore, 0) / learnings.length) : "—"}%
            </p>
            <p className="text-[9px] text-muted-foreground">Avg Confidence</p>
          </div>
        </div>
      )}

      {/* Source distribution */}
      {data && sources.length > 0 && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Learnings by Source</p>
          <div className="space-y-2">
            {sources.map(s => {
              const total = Object.values(bySource).reduce((sum, v) => sum + v, 0);
              return (
                <div key={s} className="flex items-center gap-2">
                  <SourceBadge source={s} />
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(bySource[s] / total) * 100}%` }} />
                  </div>
                  <span className="text-[9px] font-bold w-4 text-right shrink-0">{bySource[s]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source filter */}
      <div className="flex gap-1 flex-wrap">
        {["all", ...sources].map(s => (
          <button key={s} onClick={() => setSourceFilter(s)} data-testid={`filter-source-${s}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${sourceFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s === "all" ? "All Sources" : (SOURCE_CONFIG[s]?.label ?? s.replace(/_/g, " "))}
            {s !== "all" && bySource[s] != null && <span className="ml-1 opacity-70">({bySource[s]})</span>}
          </button>
        ))}
      </div>

      {/* Learnings list */}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {learnings.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <Zap className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-sm text-muted-foreground font-medium">No learnings captured yet</p>
              <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
                Hermes will automatically capture learnings as the system processes approvals, heartbeats, workflow decisions, and reply classifications. Trigger a CEO Heartbeat run to see your first entry.
              </p>
            </div>
          ) : (
            learnings.map(l => <HermesLearningCard key={l.id} learning={l} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Knowledge Base (all memories) ──────────────────────────────────────

function KnowledgeBaseTab() {
  const { data, isLoading } = useQuery<{ memories: Memory[]; total: number }>({ queryKey: ["/api/organizational-memory/memories"], staleTime: 30_000 });
  const [typeFilter, setTypeFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  const memories = data?.memories ?? [];
  const depts = [...new Set(memories.map(m => m.department))];
  const filtered = memories.filter(m => (typeFilter === "all" || m.memoryType === typeFilter) && (deptFilter === "all" || m.department === deptFilter));
  const sorted = [...filtered].sort((a, b) => b.usageCount - a.usageCount);

  return (
    <div className="space-y-4" data-testid="tab-knowledge-base">
      <div className="flex flex-wrap gap-1.5">
        <div className="flex gap-1 flex-wrap">
          {["all", ...Object.keys(TYPE_CONFIG)].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} data-testid={`filter-type-${t}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all", ...depts].map(d => (
            <button key={d} onClick={() => setDeptFilter(d)} data-testid={`filter-dept-${d}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${deptFilter === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {d}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {sorted.map(m => <MemoryCard key={m.id} memory={m} />)}
          {sorted.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No memories match the selected filters.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Decisions ───────────────────────────────────────────────────────────

function DecisionsTab() {
  const { data, isLoading } = useQuery<{ decisions: Memory[]; total: number }>({ queryKey: ["/api/organizational-memory/decisions"], staleTime: 30_000 });
  return (
    <div className="space-y-3" data-testid="tab-decisions">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20">
        <CheckSquare className="h-4 w-4 text-primary shrink-0" />
        <p className="text-[10px] text-muted-foreground">Every major business decision recorded here — searchable, auditable, and referenced by agents before making similar choices.</p>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.decisions ?? []).map(m => <MemoryCard key={m.id} memory={m} />)}
          {(data?.decisions ?? []).length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No decisions recorded yet.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Lessons Learned ─────────────────────────────────────────────────────

function LessonsTab() {
  const { data, isLoading } = useQuery<{ lessons: Memory[]; total: number }>({ queryKey: ["/api/organizational-memory/lessons"], staleTime: 30_000 });
  const lessons = data?.lessons ?? [];
  const sorted = [...lessons].sort((a, b) => b.impactScore - a.impactScore);

  return (
    <div className="space-y-4" data-testid="tab-lessons">
      {lessons.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-amber-600 dark:text-amber-400">{lessons.length}</p>
            <p className="text-[9px] text-muted-foreground">Lessons Captured</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{Math.round(lessons.reduce((s, l) => s + l.confidenceScore, 0) / lessons.length)}%</p>
            <p className="text-[9px] text-muted-foreground">Avg Confidence</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{lessons.reduce((s, l) => s + l.usageCount, 0)}</p>
            <p className="text-[9px] text-muted-foreground">Times Referenced</p>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {sorted.map((m, i) => (
            <div key={m.id} className="relative">
              {i < 3 && (
                <div className="absolute -left-1 -top-1 z-10">
                  <div className="h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center">
                    <Star className="h-2.5 w-2.5 text-white" />
                  </div>
                </div>
              )}
              <MemoryCard memory={m} />
            </div>
          ))}
          {sorted.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No lessons learned recorded yet.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Playbooks & Policies ────────────────────────────────────────────────

function PlaybooksTab({ showPolicies }: { showPolicies?: boolean }) {
  const { data, isLoading } = useQuery<PlaybooksData>({ queryKey: ["/api/organizational-memory/playbooks"], staleTime: 30_000 });
  const items = showPolicies ? (data?.policies ?? []) : (data?.playbooks ?? []);
  const color = showPolicies ? "violet" : "emerald";

  return (
    <div className="space-y-4" data-testid={`tab-${showPolicies ? "policies" : "playbooks"}`}>
      <div className={`flex items-center gap-2 p-3 rounded-xl bg-${color}-500/5 border border-${color}-500/20`}>
        {showPolicies ? <Shield className="h-4 w-4 text-violet-500 shrink-0" /> : <BookOpen className="h-4 w-4 text-emerald-500 shrink-0" />}
        <p className="text-[10px] text-muted-foreground">
          {showPolicies
            ? "Operating standards and governance rules — automatically referenced by AI COO and all agents before executing actions."
            : "Proven step-by-step operating procedures — agents reference these before executing any known campaign, outreach, or workflow type."}
        </p>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {items.map(m => <MemoryCard key={m.id} memory={m} expanded />)}
          {items.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No {showPolicies ? "policies" : "playbooks"} recorded yet.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Search ──────────────────────────────────────────────────────────────

function SearchTab() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isFetching } = useQuery<SearchResult>({
    queryKey: ["/api/organizational-memory/search", submitted],
    queryFn: () => fetchJson(`/api/organizational-memory/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.length > 0,
    staleTime: 30_000,
  });

  const handleSearch = () => setSubmitted(query.trim());

  const EXAMPLE_QUERIES = ["pricing experiments", "referral campaign", "email follow-up", "partner outreach", "retention playbook"];

  return (
    <div className="space-y-4" data-testid="tab-search-memory">
      <div className="p-4 rounded-xl border bg-card space-y-3">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Search Organizational Memory</p>
        <div className="flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSearch(); }} placeholder="What do you want to know? e.g. 'What pricing experiments increased revenue?'" className="flex-1 h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-memory-search" />
          <Button className="h-9 gap-1.5 shrink-0" onClick={handleSearch} disabled={!query.trim() || isFetching} data-testid="button-search-memory">
            {isFetching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </Button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[9px] text-muted-foreground self-center">Try:</span>
          {EXAMPLE_QUERIES.map(q => (
            <button key={q} onClick={() => { setQuery(q); setSubmitted(q); }} className="text-[9px] px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 transition-colors" data-testid={`example-query-${q.replace(/\s+/g, "-")}`}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {submitted && (
        <div>
          {isFetching ? <Skeleton className="h-48 rounded-xl" /> : (
            <>
              <p className="text-[9px] text-muted-foreground mb-3">
                {data?.total ?? 0} result{data?.total !== 1 ? "s" : ""} for "<span className="font-semibold text-foreground">{submitted}</span>"
              </p>
              <div className="space-y-3">
                {(data?.results ?? []).map(m => <MemoryCard key={m.id} memory={m} />)}
                {data?.total === 0 && (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No matching memories found. Consider adding this knowledge to the organizational memory.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Knowledge Graph ─────────────────────────────────────────────────────

function GraphTab() {
  const { data, isLoading } = useQuery<GraphData>({ queryKey: ["/api/organizational-memory/graph"], staleTime: 60_000 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const REL_COLORS: Record<string, string> = { supports: "text-emerald-500 border-emerald-200 dark:border-emerald-800", contradicts: "text-rose-500 border-rose-200 dark:border-rose-800", expands: "text-blue-500 border-blue-200 dark:border-blue-800", depends_on: "text-amber-500 border-amber-200 dark:border-amber-800", supersedes: "text-violet-500 border-violet-200 dark:border-violet-800" };
  const NODE_COLORS: Record<string, string> = { decision: "bg-primary/10 border-primary/30 text-primary", lesson: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300", playbook: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300", policy: "bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300", research: "bg-teal-500/10 border-teal-500/30 text-teal-700 dark:text-teal-300", insight: "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300" };

  const selectedEdges = selectedNode ? (data?.edges ?? []).filter(e => e.sourceMemoryId === selectedNode.id || e.relatedMemoryId === selectedNode.id) : [];

  return (
    <div className="space-y-4" data-testid="tab-graph">
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border bg-card text-center">
              <p className="text-xl font-extrabold text-primary">{data.total}</p>
              <p className="text-[9px] text-muted-foreground">Knowledge Nodes</p>
            </div>
            <div className="p-3 rounded-xl border bg-card text-center">
              <p className="text-xl font-extrabold text-violet-600 dark:text-violet-400">{data.relationships}</p>
              <p className="text-[9px] text-muted-foreground">Relationships</p>
            </div>
          </div>

          <p className="text-[9px] text-muted-foreground">Click any memory node to see its relationships in the knowledge network.</p>

          {/* Node grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.nodes.map(node => (
              <button key={node.id} onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)} data-testid={`graph-node-${node.id}`}
                className={`p-2.5 rounded-xl border text-left transition-all ${NODE_COLORS[node.type] ?? "bg-muted border-muted text-muted-foreground"} ${selectedNode?.id === node.id ? "ring-2 ring-primary ring-offset-1" : "hover:opacity-80"}`}>
                <p className="text-[9px] font-bold leading-tight line-clamp-2 mb-1.5">{node.label}</p>
                <div className="flex items-center justify-between">
                  <TypeBadge t={node.type} />
                  <span className="text-[8px] font-bold">{node.confidenceScore}%</span>
                </div>
              </button>
            ))}
          </div>

          {/* Relationship edges for selected node */}
          {selectedNode && (
            <div className="p-4 rounded-xl border bg-card space-y-2.5" data-testid="graph-edges-panel">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Relationships for: <span className="text-foreground font-semibold">{selectedNode.label}</span></p>
              {selectedEdges.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No relationships recorded for this memory yet.</p>
              ) : selectedEdges.map(edge => {
                const isSource = edge.sourceMemoryId === selectedNode.id;
                const rel = REL_COLORS[edge.relationshipType] ?? "text-muted-foreground border-muted";
                return (
                  <div key={edge.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${rel}`} data-testid={`edge-${edge.id}`}>
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    <div className="flex-1 text-[9px]">
                      <span className="font-semibold">{isSource ? edge.sourceTitle : edge.relatedTitle}</span>
                      <span className="mx-1.5 text-muted-foreground">—{edge.relationshipType}→</span>
                      <span className="font-semibold">{isSource ? edge.relatedTitle : edge.sourceTitle}</span>
                    </div>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${rel}`}>{edge.relationshipType}</Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* All edges legend */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">All Knowledge Connections</p>
            <div className="space-y-2">
              {data.edges.map(edge => (
                <div key={edge.id} className="flex items-center gap-2 text-[9px]" data-testid={`edge-row-${edge.id}`}>
                  <span className="truncate max-w-[140px] font-medium">{edge.sourceTitle}</span>
                  <div className={`flex items-center gap-1 shrink-0 ${REL_COLORS[edge.relationshipType]?.split(" ")[0] ?? "text-muted-foreground"}`}>
                    <ArrowRightLeft className="h-2.5 w-2.5" />
                    <span className="text-[8px]">{edge.relationshipType}</span>
                  </div>
                  <span className="truncate max-w-[140px] text-muted-foreground">{edge.relatedTitle}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({ queryKey: ["/api/organizational-memory/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-memory">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Memories",        value: data?.totalMemories ?? "—",                              color: "text-primary" },
          { label: "Avg Confidence",        value: data ? `${data.avgConfidenceScore}%` : "—",              color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Avg Impact Score",      value: data ? `${data.avgImpactScore}/100` : "—",              color: "text-blue-600 dark:text-blue-400" },
          { label: "Total Usage Events",    value: data?.totalUsageEvents ?? "—",                           color: "text-muted-foreground" },
          { label: "Knowledge Health",      value: data ? `${data.knowledgeHealthScore}/100` : "—",         color: data && data.knowledgeHealthScore >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          { label: "Intelligence Score",    value: data ? `${data.institutionalIntelligenceScore}/100` : "—", color: "text-primary" },
          { label: "Learning Velocity",     value: data ? `${data.learningVelocity}/wk` : "—",             color: "text-amber-600 dark:text-amber-400" },
          { label: "Relationships",         value: data?.totalRelationships ?? "—",                         color: "text-violet-600 dark:text-violet-400" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`analytics-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          {/* Top referenced */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Most Referenced Knowledge</p>
            <div className="space-y-2.5">
              {data.topReferencedMemories.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3" data-testid={`top-ref-${i}`}>
                  <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                  <TypeBadge t={m.memoryType} />
                  <p className="text-[9px] flex-1 truncate">{m.title}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <Users className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[9px] font-bold">{m.usageCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* High impact */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Highest Impact Knowledge</p>
            <div className="space-y-2.5">
              {data.highImpactMemories.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3" data-testid={`high-impact-${i}`}>
                  <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                  <TypeBadge t={m.memoryType} />
                  <p className="text-[9px] flex-1 truncate">{m.title}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <TrendingUp className="h-2.5 w-2.5 text-rose-500" />
                    <span className="text-[9px] font-bold text-rose-500">{m.impactScore}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Department contribution */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Knowledge by Department</p>
            <div className="space-y-2">
              {Object.entries(data.byDepartment).sort((a, b) => b[1] - a[1]).map(([dept, count]) => {
                const total = Object.values(data.byDepartment).reduce((s, v) => s + v, 0);
                return (
                  <div key={dept} className="flex items-center gap-2">
                    <span className="text-[9px] w-28 shrink-0 truncate">{dept}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(count / total) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By type */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Knowledge by Type</p>
            <div className="space-y-2">
              {Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                const total = Object.values(data.byType).reduce((s, v) => s + v, 0);
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span className="capitalize text-[9px] w-20 shrink-0">{type}s</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(count / total) * 100}%` }} />
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

export default function AdminOrgMemoryPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/organizational-memory/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-organizational-memory">
      {showCreate && <CreateMemoryModal onClose={() => setShowCreate(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["/api/organizational-memory/memories"] }); qc.invalidateQueries({ queryKey: ["/api/organizational-memory/overview"] }); }} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/agent-tasks">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Task Marketplace
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Organizational Memory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The institutional brain of your AI workforce — every decision, lesson, playbook, policy, and insight stored, connected, and searchable forever.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overview && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "Memories",   value: overview.total,                      color: "text-primary" },
                { label: "Health",     value: `${overview.knowledgeHealthScore}/100`, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Confidence", value: `${overview.avgConfidenceScore}%`,    color: "text-blue-600 dark:text-blue-400" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setShowCreate(true)} data-testid="button-add-memory">
            <Plus className="h-4 w-4" />Add Memory
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Agent Communications", href: "/admin/agent-communications" },
          { label: "Task Marketplace",     href: "/admin/agent-tasks"          },
          { label: "Organizational Memory",href: null                          },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="memory-status-bar">
        {[
          { label: "Decisions",    value: overview?.byType?.decision  ?? "—", color: "text-primary",                                icon: <CheckSquare className="h-3.5 w-3.5 text-primary"      />, tab: "decisions" as TabId },
          { label: "Lessons",      value: overview?.byType?.lesson    ?? "—", color: "text-amber-600 dark:text-amber-400",           icon: <Lightbulb   className="h-3.5 w-3.5 text-amber-500"   />, tab: "lessons"   as TabId },
          { label: "Playbooks",    value: overview?.byType?.playbook  ?? "—", color: "text-emerald-600 dark:text-emerald-400",       icon: <BookOpen    className="h-3.5 w-3.5 text-emerald-500" />, tab: "playbooks" as TabId },
          { label: "Policies",     value: overview?.byType?.policy    ?? "—", color: "text-violet-600 dark:text-violet-400",         icon: <Shield      className="h-3.5 w-3.5 text-violet-500"  />, tab: "policies"  as TabId },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-memory">
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
        {activeTab === "hermes"     && <HermesLearningsTab />}
        {activeTab === "knowledge"  && <KnowledgeBaseTab />}
        {activeTab === "decisions"  && <DecisionsTab />}
        {activeTab === "lessons"    && <LessonsTab />}
        {activeTab === "playbooks"  && <PlaybooksTab />}
        {activeTab === "policies"   && <PlaybooksTab showPolicies />}
        {activeTab === "search"     && <SearchTab />}
        {activeTab === "graph"      && <GraphTab />}
        {activeTab === "analytics"  && <AnalyticsTab />}
      </div>

      {/* Forward nav → SOP Operating System */}
      <Link href="/admin/procedures">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-orange-500/5 hover:from-primary/10 hover:to-orange-500/10 transition-colors cursor-pointer group" data-testid="nav-procedures">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Organizational Procedures &amp; SOP Operating System</p>
            <p className="text-xs text-muted-foreground mt-0.5">Transform knowledge into executable standards — SOPs, checklists, compliance tracking, and version control for every department procedure.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5" data-testid="architecture-complete-19-3">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Institutional Memory — Phase 19.3 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">The digital workforce no longer forgets. Every decision, lesson, playbook, policy, and insight is a permanent organizational asset — searchable, connected, and automatically referenced before agents act.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace","Org Memory",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 20 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
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
