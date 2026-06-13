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
  Filter, PenLine, Bot, Send, ThumbsUp, ThumbsDown, Edit3,
  ListChecks, Cpu, MessageSquare, CalendarDays, Download,
  Wrench, Bug, ServerCrash, Code2, ShieldAlert, PackageCheck, FileCode2,
  Notebook, Target, Flag, FileText, Sparkles, Handshake,
  Package, UserPlus, Trophy, Pencil,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Memory = { id: string; title: string; memoryType: string; category: string; department: string; content: string; source: string; createdByAgent: string; confidenceScore: number; impactScore: number; usageCount: number; createdAt: string; updatedAt: string; isAutoLearning?: boolean; sourceKind?: "ai" | "human"; sourceLabel?: string };
type Overview = { total: number; autoLearnings?: number; byType: Record<string, number>; avgConfidenceScore: number; totalUsageEvents: number; knowledgeHealthScore: number; learningVelocity: number; institutionalIntelligenceScore: number; relationships: number; generatedAt: string };
type SearchResult = { results: Memory[]; query: string; total: number; generatedAt: string };
type AutoCaptureSource = { source: string; count: number; lastUpdated: string | null; icon: string };
type AutoCaptureStats = { sources: AutoCaptureSource[]; generatedAt: string };
type ExecKbCreateResult = { success: boolean; classification: string; memory: Memory };
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

type DecisionEntry = {
  id: string; orgId: string; agent: string; sourceType: string; source: string;
  decision: string; reasoning: string; outcome: string; followUp: string;
  confidence: number; decisionType: string; department: string;
  relatedEntityType: string | null; relatedEntityId: string | null;
  metadata: Record<string, any>; createdAt: string; updatedAt: string;
};
type DecisionStats = {
  total: number; agentDecisions: number; humanDecisions: number;
  approvalCount: number; rejectionCount: number; avgConfidence: number;
  last7DaysCount: number;
  bySourceType: Record<string, number>;
  byAgent: Record<string, number>;
  byDecisionType: Record<string, number>;
  generatedAt: string;
};
type DecisionSearchResult = { results: DecisionEntry[]; query: string; total: number; generatedAt: string };

type SoftwareKbEntry = {
  id: string; orgId: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  issue: string; rootCause: string; fixApplied: string;
  filesModified: string; outcome: string;
  source: string; sourceType: string;
  relatedEntityType: string | null; relatedEntityId: string | null;
  metadata: Record<string, any>; createdAt: string; updatedAt: string;
};
type SoftwareKbStats = {
  total: number; criticalCount: number; highCount: number;
  mediumCount: number; lowCount: number; last7DaysCount: number;
  bySourceType: Record<string, number>; bySeverity: Record<string, number>;
  topFilesModified: string[]; generatedAt: string;
};
type SoftwareKbSearchResult = { results: SoftwareKbEntry[]; query: string; total: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  decision:  { label: "Decision",  color: "bg-primary/10 text-primary",                                     icon: <CheckSquare  className="h-3.5 w-3.5" /> },
  lesson:    { label: "Lesson",    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",   icon: <Lightbulb    className="h-3.5 w-3.5" /> },
  playbook:       { label: "Playbook",        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: <BookOpen  className="h-3.5 w-3.5" /> },
  policy:         { label: "Policy",          color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",    icon: <Shield    className="h-3.5 w-3.5" /> },
  procedure:      { label: "SOP",             color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",            icon: <FileText  className="h-3.5 w-3.5" /> },
  research:       { label: "Research",        color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",            icon: <Search    className="h-3.5 w-3.5" /> },
  insight:        { label: "Insight",         color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",            icon: <TrendingUp className="h-3.5 w-3.5" /> },
  outcome:        { label: "Outcome",         color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",           icon: <Activity  className="h-3.5 w-3.5" /> },
  executive_note: { label: "Executive Note",  color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",    icon: <Notebook  className="h-3.5 w-3.5" /> },
  strategy:       { label: "Strategy",        color: "bg-primary/10 text-primary",                                                  icon: <Target    className="h-3.5 w-3.5" /> },
  vision:         { label: "Vision & Goals",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",        icon: <Flag      className="h-3.5 w-3.5" /> },
  meeting_note:   { label: "Meeting Note",    color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",           icon: <Users     className="h-3.5 w-3.5" /> },
  success_story:  { label: "Client Success",  color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",            icon: <Trophy    className="h-3.5 w-3.5" /> },
  hiring:         { label: "Hiring & Talent", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",    icon: <UserPlus  className="h-3.5 w-3.5" /> },
  partnership:    { label: "Partnership",     color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",    icon: <Handshake className="h-3.5 w-3.5" /> },
  product:        { label: "Product Roadmap", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",            icon: <Package   className="h-3.5 w-3.5" /> },
};

// ─── Human Knowledge Folders ─────────────────────────────────────────────────

const HUMAN_FOLDERS = [
  { label: "Executive Notes",     memoryType: "executive_note", department: "Executive",        description: "Personal leadership observations and strategic notes" },
  { label: "SOPs",                memoryType: "procedure",      department: "Operations",       description: "Standard operating procedures and process documentation" },
  { label: "Strategic Planning",  memoryType: "strategy",       department: "Strategy",         description: "Long-range plans and competitive positioning" },
  { label: "Vision & Goals",      memoryType: "vision",         department: "Strategy",         description: "Company vision, mission, and goal frameworks" },
  { label: "Meeting Notes",       memoryType: "meeting_note",   department: "Operations",       description: "Key takeaways and decisions from important meetings" },
  { label: "Market Research",     memoryType: "research",       department: "Marketing",        description: "Market data, trends, and competitive landscape" },
  { label: "Competitor Research", memoryType: "research",       department: "Marketing",        description: "Competitor analysis and positioning intelligence" },
  { label: "Playbooks",           memoryType: "playbook",       department: "Revenue",          description: "Proven processes and winning formulas for repeatable success" },
  { label: "Client Success",      memoryType: "success_story",  department: "Customer Success", description: "Client wins, transformations, and success patterns" },
  { label: "Hiring & Talent",     memoryType: "hiring",         department: "Operations",       description: "Hiring criteria, interview insights, and talent observations" },
  { label: "Partnerships",        memoryType: "partnership",    department: "Partnerships",     description: "Partner relationships, opportunities, and joint ventures" },
  { label: "Product Roadmap",     memoryType: "product",        department: "Engineering",      description: "Product direction, feature priorities, and build decisions" },
];

const CLASSIFICATION_COLORS: Record<string, string> = {
  Strategy:     "bg-primary/10 text-primary border-primary/30",
  Operations:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Research:     "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  SOP:          "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-800",
  Product:      "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  Hiring:       "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  Partnerships: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
};

const AUTO_CAPTURE_ICON_MAP: Record<string, React.ReactNode> = {
  zap:         <Zap         className="h-3.5 w-3.5" />,
  book:        <BookOpen    className="h-3.5 w-3.5" />,
  wrench:      <Wrench      className="h-3.5 w-3.5" />,
  heart:       <Activity    className="h-3.5 w-3.5" />,
  "trending-up": <TrendingUp className="h-3.5 w-3.5" />,
  calendar:    <CalendarDays className="h-3.5 w-3.5" />,
  file:        <FileText    className="h-3.5 w-3.5" />,
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
  { id: "overview",      label: "Overview",               icon: Brain        },
  { id: "executive-kb",  label: "Executive Knowledge",    icon: Pencil       },
  { id: "hermes",        label: "Hermes Learnings",       icon: Zap          },
  { id: "knowledge",     label: "Knowledge Base",         icon: BookOpen     },
  { id: "decisions",     label: "Decisions",              icon: CheckSquare  },
  { id: "software-kb",   label: "Software KB",            icon: Wrench       },
  { id: "lessons",       label: "Lessons Learned",        icon: Lightbulb    },
  { id: "playbooks",     label: "Playbooks",              icon: BookOpen     },
  { id: "policies",      label: "Policies",               icon: Shield       },
  { id: "search",        label: "Search",                 icon: Search       },
  { id: "graph",         label: "Knowledge Graph",        icon: GitBranch    },
  { id: "analytics",     label: "Analytics",              icon: BarChart3    },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Executive Knowledge Capture ────────────────────────────────────────

function ExecutiveKbTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedFolder, setSelectedFolder] = useState(HUMAN_FOLDERS[0]);
  const [form, setForm] = useState({ title: "", content: "", confidenceScore: 85 });
  const [lastClassification, setLastClassification] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const { data: acStats } = useQuery<AutoCaptureStats>({
    queryKey: ["/api/organizational-memory/auto-capture-stats"],
    staleTime: 60_000,
  });

  const createMutation = useMutation<ExecKbCreateResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/organizational-memory/create", {
        title: form.title,
        content: form.content,
        folder: selectedFolder.label,
        memoryType: selectedFolder.memoryType,
        department: selectedFolder.department,
        createdByAgent: "Human Admin",
        source: "Human Admin",
        confidenceScore: form.confidenceScore,
      });
      return res.json() as Promise<ExecKbCreateResult>;
    },
    onSuccess: (data: ExecKbCreateResult) => {
      setLastClassification(data.classification ?? null);
      setShowSuccess(true);
      setForm({ title: "", content: "", confidenceScore: 85 });
      qc.invalidateQueries({ queryKey: ["/api/organizational-memory/memories"] });
      qc.invalidateQueries({ queryKey: ["/api/organizational-memory/overview"] });
      toast({ title: "Knowledge captured", description: `Filed under ${selectedFolder.label}` });
      setTimeout(() => setShowSuccess(false), 6000);
    },
    onError: () => toast({ title: "Failed to save knowledge", variant: "destructive" }),
  });

  return (
    <div className="space-y-5" data-testid="tab-executive-kb">

      {/* Auto-Captured Memory Indicator */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold">Automatically Captured</p>
            <p className="text-[10px] text-muted-foreground">These areas are maintained by your AI workforce — no manual entry needed.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(acStats?.sources ?? [
            { source: "Hermes Learnings", count: 0, lastUpdated: null, icon: "zap" },
            { source: "Decision Journal", count: 0, lastUpdated: null, icon: "book" },
            { source: "Software KB", count: 0, lastUpdated: null, icon: "wrench" },
            { source: "CEO Heartbeat Reports", count: 0, lastUpdated: null, icon: "heart" },
            { source: "Revenue Intelligence", count: 0, lastUpdated: null, icon: "trending-up" },
            { source: "Growth Intelligence", count: 0, lastUpdated: null, icon: "trending-up" },
            { source: "Scheduling Intelligence", count: 0, lastUpdated: null, icon: "calendar" },
            { source: "Daily Reports", count: 0, lastUpdated: null, icon: "file" },
            { source: "Weekly Reports", count: 0, lastUpdated: null, icon: "file" },
          ]).map(src => (
            <div key={src.source} className="flex items-center gap-2 p-2.5 rounded-lg bg-background border">
              <div className="p-1 rounded bg-muted shrink-0 text-muted-foreground">
                {AUTO_CAPTURE_ICON_MAP[src.icon] ?? <Zap className="h-3.5 w-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium truncate">{src.source}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] font-bold text-primary">{src.count}</span>
                  <span className="text-[9px] text-muted-foreground">records</span>
                  {src.lastUpdated && (
                    <span className="text-[8px] text-muted-foreground hidden sm:inline">· {formatDistanceToNow(new Date(src.lastUpdated), { addSuffix: true })}</span>
                  )}
                </div>
              </div>
              <Badge className="text-[7px] px-1 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">Auto</Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Write Form */}
      <div className="p-5 rounded-xl border bg-card space-y-5">
        <div>
          <h2 className="text-sm font-bold">Executive Knowledge Capture</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Record strategic knowledge, operating procedures, research, and organizational context for the AI workforce.</p>
        </div>

        {/* Success banner */}
        {showSuccess && lastClassification && (
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800" data-testid="classification-success">
            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Knowledge captured and classified</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[9px] text-emerald-600 dark:text-emerald-400">Filed as:</span>
                <Badge className={`text-[9px] px-1.5 py-0 h-4 border ${CLASSIFICATION_COLORS[lastClassification] ?? "bg-muted text-muted-foreground"}`}>
                  {lastClassification}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* Folder picker */}
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Choose Knowledge Folder</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {HUMAN_FOLDERS.map(folder => {
              const cfg = TYPE_CONFIG[folder.memoryType] ?? { color: "bg-muted text-muted-foreground", icon: null, label: folder.label };
              const isSelected = selectedFolder.label === folder.label;
              return (
                <button key={folder.label} onClick={() => setSelectedFolder(folder)} data-testid={`folder-${folder.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${isSelected ? "border-primary bg-primary/5 text-primary" : "border-border bg-background hover:border-primary/40 hover:bg-muted/50 text-foreground"}`}>
                  <span className={`p-1 rounded ${isSelected ? "bg-primary/10" : "bg-muted"}`}>
                    {cfg.icon ?? <FileText className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate">{folder.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">{selectedFolder.description}</p>
        </div>

        {/* Content form */}
        <div className="space-y-3">
          <input
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder={`${selectedFolder.label} title…`}
            className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-exec-kb-title"
          />
          <textarea
            value={form.content}
            onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
            placeholder="Full knowledge content — the more detail, the more useful this becomes as institutional memory for your AI workforce…"
            rows={6}
            className="w-full px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            data-testid="input-exec-kb-content"
          />
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-[9px] text-muted-foreground mb-1">Confidence score ({form.confidenceScore}%)</p>
              <input type="range" min={50} max={100} value={form.confidenceScore} onChange={e => setForm(p => ({ ...p, confidenceScore: +e.target.value }))} className="w-full" data-testid="range-exec-confidence" />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.title.trim() || !form.content.trim() || createMutation.isPending}
              className="gap-1.5 shrink-0"
              data-testid="button-capture-knowledge"
            >
              {createMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Capture Knowledge
            </Button>
          </div>
        </div>
      </div>

      {/* Philosophy note */}
      <div className="p-4 rounded-xl border bg-muted/40 flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-background border shrink-0">
          <Brain className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <p className="text-[10px] font-semibold mb-0.5">Human + AI Knowledge Division</p>
          <p className="text-[10px] text-muted-foreground">Agents automatically document operations, decisions, and system learnings. This interface is reserved for executive and strategic knowledge that only humans can provide — vision, judgment, relationships, and context.</p>
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
  const [section, setSection] = useState<"all" | "ai" | "human">("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const memories = data?.memories ?? [];

  const aiMems = memories.filter(m => m.isAutoLearning || m.createdByAgent !== "Human Admin");
  const humanMems = memories.filter(m => !m.isAutoLearning && m.createdByAgent === "Human Admin");
  const displayed = section === "ai" ? aiMems : section === "human" ? humanMems : memories;
  const filtered = displayed.filter(m => typeFilter === "all" || m.memoryType === typeFilter);
  const sorted = [...filtered].sort((a, b) => b.usageCount - a.usageCount);

  return (
    <div className="space-y-4" data-testid="tab-knowledge-base">
      {/* Section toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border overflow-hidden">
          {([["all", "All Knowledge", memories.length], ["ai", "AI Generated", aiMems.length], ["human", "Human Generated", humanMems.length]] as const).map(([val, label, count]) => (
            <button key={val} onClick={() => setSection(val)} data-testid={`kb-section-${val}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-colors border-r last:border-r-0 ${section === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              {val === "ai" && <Bot className="h-3 w-3" />}
              {val === "human" && <Pencil className="h-3 w-3" />}
              {label}
              <span className={`px-1 rounded text-[8px] font-bold ${section === val ? "bg-white/20" : "bg-muted"}`}>{count}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap ml-auto">
          {["all", "decision", "lesson", "playbook", "research", "procedure", "insight"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} data-testid={`filter-type-${t}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {t === "all" ? "All Types" : (TYPE_CONFIG[t]?.label ?? t)}
            </button>
          ))}
        </div>
      </div>

      {/* Two-section view when "all" is selected */}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : section === "all" ? (
        <div className="space-y-6">
          {aiMems.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <div className="p-1 rounded bg-violet-100 dark:bg-violet-900/30">
                  <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">AI Generated Knowledge</p>
                <Badge className="text-[8px] px-1.5 py-0 h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{aiMems.length}</Badge>
              </div>
              <div className="space-y-2.5">
                {aiMems.filter(m => typeFilter === "all" || m.memoryType === typeFilter).slice(0, 8).map(m => <MemoryCard key={m.id} memory={m} />)}
                {aiMems.length > 8 && <p className="text-[9px] text-muted-foreground text-center">+ {aiMems.length - 8} more — switch to AI Generated filter to see all</p>}
              </div>
            </div>
          )}
          {humanMems.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <div className="p-1 rounded bg-emerald-100 dark:bg-emerald-900/30">
                  <Pencil className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Human Generated Knowledge</p>
                <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{humanMems.length}</Badge>
              </div>
              <div className="space-y-2.5">
                {humanMems.filter(m => typeFilter === "all" || m.memoryType === typeFilter).map(m => <MemoryCard key={m.id} memory={m} />)}
              </div>
            </div>
          )}
          {memories.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No memories in the knowledge base yet.</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(m => <MemoryCard key={m.id} memory={m} />)}
          {sorted.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No {section === "ai" ? "AI-generated" : "human-generated"} memories found.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Decisions (Decision Journal Auto-Capture) ──────────────────────────

// ─── Decision Journal helpers ──────────────────────────────────────────────────

const DJ_SOURCE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  workflow:              { label: "Workflow Engine",       color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700",     icon: <ListChecks className="h-3 w-3" /> },
  gmail:                 { label: "AgentMail",             color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700", icon: <MessageSquare className="h-3 w-3" /> },
  ceo_heartbeat:         { label: "CEO Heartbeat",         color: "bg-primary/10 text-primary border-primary/20",                                                              icon: <Cpu className="h-3 w-3" /> },
  executive_agent:       { label: "Executive Agent",       color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-700", icon: <Bot className="h-3 w-3" /> },
  revenue_agent:         { label: "Revenue Agent",         color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-700", icon: <TrendingUp className="h-3 w-3" /> },
  business_brain:        { label: "Business Brain",        color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700", icon: <Brain className="h-3 w-3" /> },
  recommendation:        { label: "Recommendations",       color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-700",   icon: <Star className="h-3 w-3" /> },
  reply_classification:  { label: "Reply Intelligence",    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-700",   icon: <MessageSquare className="h-3 w-3" /> },
  human_admin:           { label: "Human Admin",           color: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200 dark:border-slate-700", icon: <PenLine className="h-3 w-3" /> },
};

const DJ_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  approval:       { label: "Approval",      icon: <ThumbsUp   className="h-2.5 w-2.5" />, color: "text-emerald-600 dark:text-emerald-400" },
  rejection:      { label: "Rejection",     icon: <ThumbsDown className="h-2.5 w-2.5" />, color: "text-rose-500" },
  edit_approval:  { label: "Edit + Approve",icon: <Edit3      className="h-2.5 w-2.5" />, color: "text-blue-600 dark:text-blue-400" },
  execution:      { label: "Execution",     icon: <Send       className="h-2.5 w-2.5" />, color: "text-violet-600 dark:text-violet-400" },
  recommendation: { label: "Recommendation",icon: <Star       className="h-2.5 w-2.5" />, color: "text-amber-600 dark:text-amber-400" },
  action:         { label: "Action",        icon: <Activity   className="h-2.5 w-2.5" />, color: "text-primary" },
  manual:         { label: "Manual Entry",  icon: <PenLine    className="h-2.5 w-2.5" />, color: "text-muted-foreground" },
  scheduling:     { label: "Scheduling",    icon: <CalendarDays className="h-2.5 w-2.5" />, color: "text-teal-600 dark:text-teal-400" },
};

function DJSourceBadge({ sourceType }: { sourceType: string }) {
  const cfg = DJ_SOURCE_CONFIG[sourceType] ?? { label: sourceType.replace(/_/g, " "), color: "bg-muted text-muted-foreground border-border", icon: <Activity className="h-3 w-3" /> };
  return (
    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 h-4 gap-0.5 border flex items-center ${cfg.color}`}>
      {cfg.icon}
      <span className="ml-0.5">{cfg.label}</span>
    </Badge>
  );
}

function DJTypePill({ decisionType }: { decisionType: string }) {
  const cfg = DJ_TYPE_CONFIG[decisionType] ?? { label: decisionType.replace(/_/g, " "), icon: <Activity className="h-2.5 w-2.5" />, color: "text-muted-foreground" };
  return (
    <span className={`flex items-center gap-0.5 text-[9px] font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function DecisionCard({ entry }: { entry: DecisionEntry }) {
  const [open, setOpen] = useState(false);
  const conf = entry.confidence;
  const confColor = conf >= 90 ? "text-emerald-600 dark:text-emerald-400" : conf >= 75 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";

  return (
    <div className="p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow" data-testid={`decision-card-${entry.id}`}>
      <div className="flex items-start gap-3">
        <div className={`p-1.5 rounded-lg border shrink-0 mt-0.5 ${(DJ_SOURCE_CONFIG[entry.sourceType]?.color ?? "bg-muted border-border").split(" ").slice(0, 2).join(" ")}`}>
          {DJ_SOURCE_CONFIG[entry.sourceType]?.icon ?? <Activity className="h-3 w-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap mb-1">
            <p className="text-[11px] font-semibold flex-1 leading-snug">{entry.decision}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[9px] text-muted-foreground mb-2">
            <DJSourceBadge sourceType={entry.sourceType} />
            <DJTypePill decisionType={entry.decisionType} />
            <span className={`font-bold ${confColor}`}>{conf}%</span>
            <span>·</span>
            <span>{entry.agent}</span>
            <span>·</span>
            <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
          </div>
          {entry.reasoning && (
            <p className="text-[10px] text-muted-foreground mb-1.5 leading-relaxed">
              <span className="font-semibold text-foreground">Reasoning: </span>{entry.reasoning.slice(0, open ? undefined : 140)}{!open && entry.reasoning.length > 140 ? "…" : ""}
            </p>
          )}
          {open && (
            <div className="space-y-1.5 mt-1.5">
              {entry.outcome && <p className="text-[10px]"><span className="font-semibold">Outcome: </span><span className="text-muted-foreground">{entry.outcome}</span></p>}
              {entry.followUp && <p className="text-[10px]"><span className="font-semibold">Follow-Up: </span><span className="text-muted-foreground">{entry.followUp}</span></p>}
              {entry.relatedEntityType && <p className="text-[9px] text-muted-foreground">Ref: {entry.relatedEntityType}{entry.relatedEntityId ? ` · ${entry.relatedEntityId.slice(0, 12)}…` : ""}</p>}
            </div>
          )}
          <button onClick={() => setOpen(!open)} className="mt-1 text-[9px] text-primary hover:underline" data-testid={`toggle-decision-${entry.id}`}>
            {open ? "Show less ↑" : "Show outcome & follow-up ↓"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualDecisionForm({ onRecorded, onClose }: { onRecorded: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ agent: "", decision: "", reasoning: "", outcome: "", followUp: "", confidence: 90, department: "Operations", decisionType: "manual" });
  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/organizational-memory/decisions/record", form),
    onSuccess: () => { toast({ title: "Decision recorded" }); onRecorded(); onClose(); },
    onError: () => toast({ title: "Failed to record", variant: "destructive" }),
  });

  return (
    <div className="p-4 rounded-xl border bg-card space-y-3" data-testid="manual-decision-form">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Record Manual Decision</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Decision *</label>
          <textarea rows={2} className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background resize-none" placeholder="What was decided?" value={form.decision} onChange={e => setForm(f => ({ ...f, decision: e.target.value }))} data-testid="input-decision" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Agent / Person</label>
            <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" placeholder="Who decided?" value={form.agent} onChange={e => setForm(f => ({ ...f, agent: e.target.value }))} data-testid="input-agent" />
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Confidence %</label>
            <input type="number" min={0} max={100} className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: Number(e.target.value) }))} data-testid="input-confidence" />
          </div>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Reasoning</label>
          <textarea rows={2} className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background resize-none" placeholder="Why was this decision made?" value={form.reasoning} onChange={e => setForm(f => ({ ...f, reasoning: e.target.value }))} data-testid="input-reasoning" />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Expected Outcome</label>
          <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" placeholder="What is the intended result?" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} data-testid="input-outcome" />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Follow-Up Action</label>
          <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" placeholder="What happens next?" value={form.followUp} onChange={e => setForm(f => ({ ...f, followUp: e.target.value }))} data-testid="input-followup" />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!form.decision.trim() || mut.isPending} onClick={() => mut.mutate()} data-testid="button-submit-decision">
          {mut.isPending ? "Saving…" : "Record Decision"}
        </Button>
      </div>
    </div>
  );
}

function DecisionsTab() {
  const qc = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState("");
  const [showForm, setShowForm] = useState(false);

  const statsQuery = useQuery<DecisionStats>({ queryKey: ["/api/organizational-memory/decisions/stats"], staleTime: 15_000 });
  const decisionsQuery = useQuery<{ decisions: DecisionEntry[]; total: number }>({
    queryKey: ["/api/organizational-memory/decisions", sourceFilter],
    queryFn: () => fetchJson(`/api/organizational-memory/decisions${sourceFilter !== "all" ? `?sourceType=${encodeURIComponent(sourceFilter)}` : ""}&limit=100`),
    staleTime: 15_000,
  });
  const searchResultsQuery = useQuery<DecisionSearchResult>({
    queryKey: ["/api/organizational-memory/decisions/search", searchSubmitted],
    queryFn: () => fetchJson(`/api/organizational-memory/decisions/search?q=${encodeURIComponent(searchSubmitted)}`),
    enabled: searchSubmitted.length > 0,
    staleTime: 15_000,
  });

  const stats = statsQuery.data;
  const decisions = searchSubmitted ? (searchResultsQuery.data?.results ?? []) : (decisionsQuery.data?.decisions ?? []);
  const isLoading = searchSubmitted ? searchResultsQuery.isLoading : decisionsQuery.isLoading;

  // Source types present in stats
  const activeSources = stats ? Object.keys(stats.bySourceType).sort((a, b) => stats.bySourceType[b] - stats.bySourceType[a]) : [];

  const handleSearch = () => { setSearchSubmitted(searchQuery.trim()); setSourceFilter("all"); };
  const handleClearSearch = () => { setSearchSubmitted(""); setSearchQuery(""); };

  const handleRecorded = () => {
    qc.invalidateQueries({ queryKey: ["/api/organizational-memory/decisions"] });
    qc.invalidateQueries({ queryKey: ["/api/organizational-memory/decisions/stats"] });
  };

  return (
    <div className="space-y-4" data-testid="tab-decisions">
      {/* Header banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
        <ListChecks className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5">Decision Journal — Automatic Capture</p>
          <p className="text-[10px] text-muted-foreground">Every approval, rejection, agent execution, and recommendation is automatically recorded here. Manual entries remain available for human decisions.</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={() => setShowForm(!showForm)} data-testid="button-record-manual">
          <PenLine className="h-3.5 w-3.5" />Record Manual
        </Button>
      </div>

      {showForm && <ManualDecisionForm onRecorded={handleRecorded} onClose={() => setShowForm(false)} />}

      {/* KPI stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Decisions",    value: stats.total,            color: "text-primary" },
            { label: "Agent Decisions",    value: stats.agentDecisions,   color: "text-violet-600 dark:text-violet-400" },
            { label: "Human Decisions",    value: stats.humanDecisions,   color: "text-slate-600 dark:text-slate-400" },
            { label: "Approvals",          value: stats.approvalCount,    color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Rejections",         value: stats.rejectionCount,   color: "text-rose-500" },
            { label: "Avg Confidence",     value: `${stats.avgConfidence}%`, color: "text-amber-600 dark:text-amber-400" },
            { label: "This Week",          value: stats.last7DaysCount,   color: "text-blue-600 dark:text-blue-400" },
            { label: "Approval Rate",      value: stats.total > 0 ? `${Math.round((stats.approvalCount / stats.total) * 100)}%` : "—", color: "text-emerald-600 dark:text-emerald-400" },
          ].map(k => (
            <div key={k.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`dj-stat-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search decisions, reasoning, outcomes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            data-testid="input-decision-search"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8 px-3" onClick={handleSearch} data-testid="button-search-decisions">Search</Button>
        {searchSubmitted && <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleClearSearch} data-testid="button-clear-search"><X className="h-3.5 w-3.5" /></Button>}
      </div>

      {/* Source type filter tabs */}
      {!searchSubmitted && (
        <div className="flex gap-1 flex-wrap">
          {["all", ...activeSources].map(s => (
            <button key={s} onClick={() => setSourceFilter(s)} data-testid={`dj-filter-${s}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1 ${sourceFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {s !== "all" && DJ_SOURCE_CONFIG[s]?.icon}
              {s === "all" ? "All Sources" : (DJ_SOURCE_CONFIG[s]?.label ?? s.replace(/_/g, " "))}
              {s !== "all" && stats?.bySourceType[s] != null && <span className="opacity-70">({stats.bySourceType[s]})</span>}
            </button>
          ))}
        </div>
      )}

      {searchSubmitted && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground flex-1">Showing {searchResultsQuery.data?.total ?? 0} result{(searchResultsQuery.data?.total ?? 0) !== 1 ? "s" : ""} for <span className="font-semibold text-foreground">"{searchSubmitted}"</span></p>
          <button onClick={handleClearSearch} className="text-[10px] text-primary hover:underline">Clear</button>
        </div>
      )}

      {/* Decision cards */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : decisions.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <ListChecks className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm text-muted-foreground font-medium">{searchSubmitted ? "No decisions match your search" : "No decisions captured yet"}</p>
          <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
            {searchSubmitted
              ? "Try a different search term — decisions are searchable by decision text, reasoning, outcome, and agent."
              : "Decisions are automatically captured when workflows are approved/rejected, AgentMail drafts are reviewed, heartbeats run, and recommendations are acted upon."}
          </p>
          {!searchSubmitted && (
            <Button size="sm" variant="outline" className="gap-1.5 mt-2" onClick={() => setShowForm(true)} data-testid="button-add-first-decision">
              <PenLine className="h-3.5 w-3.5" />Record your first decision
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map(d => <DecisionCard key={d.id} entry={d} />)}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Software KB (Auto-Capture Fix History) ─────────────────────────────

const SKB_SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  critical: { label: "Critical", color: "text-red-600 dark:text-red-400",     bg: "bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-700",     icon: <ServerCrash className="h-3 w-3" /> },
  high:     { label: "High",     color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700", icon: <ShieldAlert className="h-3 w-3" /> },
  medium:   { label: "Medium",   color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700",  icon: <Bug className="h-3 w-3" /> },
  low:      { label: "Low",      color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700", icon: <CheckCircle className="h-3 w-3" /> },
};

const SKB_SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  architecture_audit:        { label: "Architecture Audit",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-700" },
  service_fix:               { label: "Service Fix",           color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700" },
  api_fix:                   { label: "API Fix",               color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700" },
  db_fix:                    { label: "Database Fix",          color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-700" },
  typescript_fix:            { label: "TypeScript",            color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700" },
  integration_fix:           { label: "Integration Fix",       color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700" },
  persistence_fix:           { label: "Persistence Fix",       color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-700" },
  security_fix:              { label: "Security Fix",          color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-700" },
  module_fix:                { label: "Module Fix",            color: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200 dark:border-slate-700" },
  feature_implementation:    { label: "Feature",               color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700" },
  software_improvement_agent:{ label: "SW Improvement Agent",  color: "bg-primary/10 text-primary border-primary/20" },
  error_boundary:            { label: "Error Boundary",        color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-700" },
  deployment_fix:            { label: "Deployment Fix",        color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-700" },
  human_admin:               { label: "Manual Entry",          color: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200 dark:border-slate-700" },
};

function SkbSeverityBadge({ severity }: { severity: string }) {
  const cfg = SKB_SEVERITY_CONFIG[severity] ?? SKB_SEVERITY_CONFIG["medium"];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded-md text-[9px] font-bold border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}<span className="ml-0.5">{cfg.label}</span>
    </span>
  );
}

function SkbSourceBadge({ sourceType }: { sourceType: string }) {
  const cfg = SKB_SOURCE_CONFIG[sourceType] ?? { label: sourceType.replace(/_/g, " "), color: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 h-4 border ${cfg.color}`}>{cfg.label}</Badge>
  );
}

function SoftwareKbCard({ entry, searchQuery }: { entry: SoftwareKbEntry; searchQuery?: string }) {
  const [open, setOpen] = useState(false);
  const sev = SKB_SEVERITY_CONFIG[entry.severity] ?? SKB_SEVERITY_CONFIG["medium"];

  return (
    <div className={`p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow`} data-testid={`skb-card-${entry.id}`}>
      {/* Left accent bar by severity */}
      <div className="flex items-start gap-3">
        <div className={`p-1.5 rounded-lg border shrink-0 mt-0.5 ${sev.bg}`}>
          {sev.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1.5">
            <p className="text-[11px] font-semibold flex-1 leading-snug">{entry.issue}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <SkbSeverityBadge severity={entry.severity} />
            <SkbSourceBadge sourceType={entry.sourceType} />
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
            </span>
          </div>

          {entry.rootCause && (
            <div className="mb-1.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Root Cause</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {entry.rootCause.slice(0, open ? undefined : 120)}{!open && entry.rootCause.length > 120 ? "…" : ""}
              </p>
            </div>
          )}

          {open && (
            <div className="space-y-2 mt-2 pt-2 border-t">
              {entry.fixApplied && (
                <div>
                  <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-0.5 flex items-center gap-1"><PackageCheck className="h-3 w-3" />Fix Applied</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{entry.fixApplied}</p>
                </div>
              )}
              {entry.filesModified && (
                <div>
                  <p className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-0.5 flex items-center gap-1"><FileCode2 className="h-3 w-3" />Files Modified</p>
                  <p className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-2 py-1 rounded-lg">{entry.filesModified}</p>
                </div>
              )}
              {entry.outcome && (
                <div>
                  <p className="text-[9px] font-semibold text-primary uppercase tracking-wide mb-0.5">Outcome</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{entry.outcome}</p>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground">Source: {entry.source}</p>
            </div>
          )}

          <button onClick={() => setOpen(!open)} className="mt-1 text-[9px] text-primary hover:underline" data-testid={`toggle-skb-${entry.id}`}>
            {open ? "Show less ↑" : "Show fix, files & outcome ↓"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualKbFixForm({ onRecorded, onClose }: { onRecorded: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ severity: "medium", issue: "", rootCause: "", fixApplied: "", filesModified: "", outcome: "" });
  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/organizational-memory/software-kb/record", form),
    onSuccess: () => { toast({ title: "Fix recorded in Software KB" }); onRecorded(); onClose(); },
    onError: () => toast({ title: "Failed to record fix", variant: "destructive" }),
  });

  return (
    <div className="p-4 rounded-xl border bg-card space-y-3" data-testid="manual-kb-form">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold flex items-center gap-1.5"><Wrench className="h-4 w-4 text-primary" />Record Manual Fix</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Severity *</label>
            <select className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} data-testid="select-severity">
              {["critical","high","medium","low"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Issue *</label>
            <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" placeholder="What was the problem?" value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} data-testid="input-kb-issue" />
          </div>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Root Cause</label>
          <textarea rows={2} className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background resize-none" placeholder="Why did this happen?" value={form.rootCause} onChange={e => setForm(f => ({ ...f, rootCause: e.target.value }))} data-testid="input-kb-rootcause" />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Fix Applied</label>
          <textarea rows={2} className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background resize-none" placeholder="What was done to fix it?" value={form.fixApplied} onChange={e => setForm(f => ({ ...f, fixApplied: e.target.value }))} data-testid="input-kb-fix" />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Files Modified</label>
          <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs font-mono rounded-lg border bg-background" placeholder="server/routes.ts, client/src/pages/..." value={form.filesModified} onChange={e => setForm(f => ({ ...f, filesModified: e.target.value }))} data-testid="input-kb-files" />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase tracking-wide">Outcome</label>
          <input className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border bg-background" placeholder="What is the result?" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} data-testid="input-kb-outcome" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!form.issue.trim() || mut.isPending} onClick={() => mut.mutate()} data-testid="button-submit-kb">
          {mut.isPending ? "Saving…" : "Record Fix"}
        </Button>
      </div>
    </div>
  );
}

function SoftwareKbTab() {
  const qc = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [dupCheckQuery, setDupCheckQuery] = useState("");

  const statsQuery = useQuery<SoftwareKbStats>({
    queryKey: ["/api/organizational-memory/software-kb/stats"],
    staleTime: 15_000,
  });
  const entriesQuery = useQuery<{ entries: SoftwareKbEntry[]; total: number }>({
    queryKey: ["/api/organizational-memory/software-kb", severityFilter],
    queryFn: () => fetchJson(`/api/organizational-memory/software-kb${severityFilter !== "all" ? `?severity=${encodeURIComponent(severityFilter)}` : ""}&limit=100`),
    staleTime: 15_000,
  });
  const searchQuery2 = useQuery<SoftwareKbSearchResult>({
    queryKey: ["/api/organizational-memory/software-kb/search", searchSubmitted],
    queryFn: () => fetchJson(`/api/organizational-memory/software-kb/search?q=${encodeURIComponent(searchSubmitted)}`),
    enabled: searchSubmitted.length > 0,
    staleTime: 15_000,
  });
  // Duplicate check before opening form
  const dupQuery = useQuery<SoftwareKbSearchResult>({
    queryKey: ["/api/organizational-memory/software-kb/search", dupCheckQuery],
    queryFn: () => fetchJson(`/api/organizational-memory/software-kb/search?q=${encodeURIComponent(dupCheckQuery)}`),
    enabled: dupCheckQuery.length >= 3,
    staleTime: 10_000,
  });

  const stats = statsQuery.data;
  const entries = searchSubmitted ? (searchQuery2.data?.results ?? []) : (entriesQuery.data?.entries ?? []);
  const isLoading = searchSubmitted ? searchQuery2.isLoading : entriesQuery.isLoading;
  const dupResults = dupQuery.data?.results ?? [];

  const handleSearch = () => { setSearchSubmitted(searchQuery.trim()); setSeverityFilter("all"); };
  const handleClearSearch = () => { setSearchSubmitted(""); setSearchQuery(""); };
  const handleRecorded = () => {
    qc.invalidateQueries({ queryKey: ["/api/organizational-memory/software-kb"] });
    qc.invalidateQueries({ queryKey: ["/api/organizational-memory/software-kb/stats"] });
  };

  const activeSources = stats ? Object.keys(stats.bySourceType).sort((a, b) => stats.bySourceType[b] - stats.bySourceType[a]).slice(0, 6) : [];

  return (
    <div className="space-y-4" data-testid="tab-software-kb">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
        <Wrench className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5">Software Knowledge Base — Auto-Capture</p>
          <p className="text-[10px] text-muted-foreground">Every detected fix, audit resolution, TypeScript error, crash, and deployment issue is automatically captured here. Search before logging a new issue to avoid duplicates.</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={() => setShowForm(!showForm)} data-testid="button-record-fix">
          <PenLine className="h-3.5 w-3.5" />Record Fix
        </Button>
      </div>

      {/* Duplicate check search (before opening form) */}
      {!showForm && (
        <div className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700 space-y-2">
          <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1"><Search className="h-3 w-3" />Search for existing fixes before adding a new one</p>
          <div className="flex gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Describe the issue to check for duplicates…"
              value={dupCheckQuery}
              onChange={e => setDupCheckQuery(e.target.value)}
              data-testid="input-dup-check"
            />
            {dupCheckQuery.length >= 3 && (
              <button onClick={() => setDupCheckQuery("")} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            )}
          </div>
          {dupCheckQuery.length >= 3 && dupResults.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] text-amber-700 dark:text-amber-400 font-semibold">{dupResults.length} similar issue{dupResults.length !== 1 ? "s" : ""} already in the KB:</p>
              {dupResults.slice(0, 3).map(r => (
                <div key={r.id} className="p-2 rounded-lg bg-white dark:bg-slate-900 border text-[9px] space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <SkbSeverityBadge severity={r.severity} />
                    <span className="font-semibold flex-1 truncate">{r.issue}</span>
                  </div>
                  {r.fixApplied && <p className="text-muted-foreground truncate"><span className="font-medium">Fix:</span> {r.fixApplied}</p>}
                </div>
              ))}
              {dupResults.length > 3 && <p className="text-[9px] text-muted-foreground">+{dupResults.length - 3} more results — use the search bar above to see all.</p>}
            </div>
          )}
          {dupCheckQuery.length >= 3 && dupResults.length === 0 && !dupQuery.isLoading && (
            <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">No similar issues found — safe to add a new entry.</p>
          )}
        </div>
      )}

      {showForm && <ManualKbFixForm onRecorded={handleRecorded} onClose={() => setShowForm(false)} />}

      {/* KPI stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Fixes",    value: stats.total,            color: "text-primary" },
            { label: "Critical",       value: stats.criticalCount,    color: "text-red-600 dark:text-red-400" },
            { label: "High Severity",  value: stats.highCount,        color: "text-orange-600 dark:text-orange-400" },
            { label: "Medium",         value: stats.mediumCount,      color: "text-amber-600 dark:text-amber-400" },
            { label: "Low",            value: stats.lowCount,         color: "text-emerald-600 dark:text-emerald-400" },
            { label: "This Week",      value: stats.last7DaysCount,   color: "text-blue-600 dark:text-blue-400" },
            { label: "Auto-Captured",  value: stats.total - (stats.bySourceType["human_admin"] ?? 0), color: "text-violet-600 dark:text-violet-400" },
            { label: "Manual Entries", value: stats.bySourceType["human_admin"] ?? 0, color: "text-slate-600 dark:text-slate-400" },
          ].map(k => (
            <div key={k.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`skb-stat-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search issues, root causes, files, fixes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            data-testid="input-skb-search"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8 px-3" onClick={handleSearch} data-testid="button-search-kb">Search</Button>
        {searchSubmitted && <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleClearSearch}><X className="h-3.5 w-3.5" /></Button>}
      </div>

      {/* Severity filter */}
      {!searchSubmitted && (
        <div className="flex gap-1 flex-wrap">
          {["all", "critical", "high", "medium", "low"].map(s => {
            const cfg = s === "all" ? null : SKB_SEVERITY_CONFIG[s];
            const count = s === "all" ? stats?.total : stats?.bySeverity[s];
            return (
              <button key={s} onClick={() => setSeverityFilter(s)} data-testid={`skb-filter-${s}`}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1 ${severityFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {cfg?.icon}
                {s === "all" ? "All Severities" : cfg?.label}
                {count != null && <span className="opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Source type pills */}
      {!searchSubmitted && activeSources.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-[9px] text-muted-foreground self-center mr-1 uppercase tracking-wide">Sources:</span>
          {activeSources.map(s => {
            const cfg = SKB_SOURCE_CONFIG[s];
            return (
              <Badge key={s} variant="outline" className={`text-[8px] px-1.5 py-0 h-4 border ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
                {cfg?.label ?? s.replace(/_/g, " ")} <span className="opacity-60 ml-0.5">{stats?.bySourceType[s]}</span>
              </Badge>
            );
          })}
        </div>
      )}

      {searchSubmitted && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground flex-1">{searchQuery2.data?.total ?? 0} result{(searchQuery2.data?.total ?? 0) !== 1 ? "s" : ""} for <span className="font-semibold text-foreground">"{searchSubmitted}"</span></p>
          <button onClick={handleClearSearch} className="text-[10px] text-primary hover:underline">Clear</button>
        </div>
      )}

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <Wrench className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm text-muted-foreground font-medium">{searchSubmitted ? "No fixes match your search" : "No fixes recorded yet"}</p>
          <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
            {searchSubmitted
              ? "Try a different search term — fixes are searchable by issue, root cause, files modified, fix applied, and outcome."
              : "Fixes are automatically captured when Software Improvement Agent tasks are created, error boundaries fire, and TypeScript/deployment issues are resolved."}
          </p>
          {!searchSubmitted && (
            <Button size="sm" variant="outline" className="gap-1.5 mt-2" onClick={() => setShowForm(true)} data-testid="button-add-first-fix">
              <PenLine className="h-3.5 w-3.5" />Record your first fix
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(e => <SoftwareKbCard key={e.id} entry={e} searchQuery={searchSubmitted} />)}
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

// ─── Source Kind Badge ────────────────────────────────────────────────────────

function SourceKindBadge({ sourceKind, sourceLabel }: { sourceKind?: "ai" | "human"; sourceLabel?: string }) {
  if (!sourceKind) return null;
  if (sourceKind === "ai") return (
    <Badge className="text-[8px] px-1.5 py-0 h-4 gap-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border border-violet-200 dark:border-violet-800 flex items-center">
      <Bot className="h-2.5 w-2.5" />{sourceLabel ?? "AI Agent"}
    </Badge>
  );
  return (
    <Badge className="text-[8px] px-1.5 py-0 h-4 gap-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center">
      <Pencil className="h-2.5 w-2.5" />{sourceLabel ?? "Human"}
    </Badge>
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

  const aiResults = (data?.results ?? []).filter(m => m.sourceKind === "ai" || m.isAutoLearning);
  const humanResults = (data?.results ?? []).filter(m => m.sourceKind === "human" || (!m.sourceKind && !m.isAutoLearning));
  const allResults = data?.results ?? [];

  return (
    <div className="space-y-4" data-testid="tab-search-memory">
      <div className="p-4 rounded-xl border bg-card space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold">Search Organizational Memory</p>
          <span className="text-[9px] text-muted-foreground ml-auto">Searches AI-captured + human knowledge</span>
        </div>
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
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-[9px] text-muted-foreground">
                  {allResults.length} result{allResults.length !== 1 ? "s" : ""} for "<span className="font-semibold text-foreground">{submitted}</span>"
                </p>
                <div className="flex items-center gap-2">
                  {aiResults.length > 0 && (
                    <Badge className="text-[8px] px-1.5 py-0 h-5 gap-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      <Bot className="h-2.5 w-2.5" />{aiResults.length} AI
                    </Badge>
                  )}
                  {humanResults.length > 0 && (
                    <Badge className="text-[8px] px-1.5 py-0 h-5 gap-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      <Pencil className="h-2.5 w-2.5" />{humanResults.length} Human
                    </Badge>
                  )}
                </div>
              </div>

              {allResults.length > 0 ? (
                <div className="space-y-5">
                  {aiResults.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        <p className="text-[9px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">AI-Generated Knowledge</p>
                      </div>
                      <div className="space-y-2.5">
                        {aiResults.map(m => (
                          <div key={m.id} className="relative">
                            <MemoryCard memory={m} />
                            <div className="absolute top-3 right-3">
                              <SourceKindBadge sourceKind="ai" sourceLabel={m.sourceLabel ?? m.source?.replace(/_/g, " ")} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {humanResults.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Pencil className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Human-Generated Knowledge</p>
                      </div>
                      <div className="space-y-2.5">
                        {humanResults.map(m => (
                          <div key={m.id} className="relative">
                            <MemoryCard memory={m} />
                            <div className="absolute top-3 right-3">
                              <SourceKindBadge sourceKind="human" sourceLabel={m.sourceLabel ?? "Knowledge Base"} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-10 text-center space-y-2">
                  <Search className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
                  <p className="text-sm text-muted-foreground">No memories found for "{submitted}"</p>
                  <p className="text-[10px] text-muted-foreground">Try the <span className="font-medium">Executive Knowledge</span> tab to add strategic context.</p>
                </div>
              )}
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

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/organizational-memory/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-organizational-memory">

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
          <Button className="gap-1.5 h-9" onClick={() => setActiveTab("executive-kb")} data-testid="button-add-memory">
            <Pencil className="h-4 w-4" />Capture Knowledge
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
        {activeTab === "overview"      && <OverviewTab />}
        {activeTab === "executive-kb"  && <ExecutiveKbTab />}
        {activeTab === "hermes"        && <HermesLearningsTab />}
        {activeTab === "knowledge"     && <KnowledgeBaseTab />}
        {activeTab === "decisions"     && <DecisionsTab />}
        {activeTab === "software-kb"   && <SoftwareKbTab />}
        {activeTab === "lessons"       && <LessonsTab />}
        {activeTab === "playbooks"     && <PlaybooksTab />}
        {activeTab === "policies"      && <PlaybooksTab showPolicies />}
        {activeTab === "search"        && <SearchTab />}
        {activeTab === "graph"         && <GraphTab />}
        {activeTab === "analytics"     && <AnalyticsTab />}
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
