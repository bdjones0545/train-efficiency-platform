import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Users, Settings, Brain, Layout, Search, Bell, CheckCircle,
  AlertTriangle, TrendingUp, DollarSign, Activity, Target, Shield,
  ArrowLeft, ChevronRight, X, Star, BarChart3,
  RefreshCw, ArrowUpRight, Eye, Clock, Circle,
  Layers, Command, ChevronUp, Bot, WifiOff,
  ThumbsUp, ThumbsDown, Inbox, Info,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Zone = { id: string; label: string; health: number; agents: number; issues: number };
type SummaryData = {
  platformHealthScore: number; totalAgentActions30d: number; openOpportunities: number;
  openRisks: number; criticalRisks: number; activeEmployees: number; overloadedAgents: number;
  totalRevenue30d: number; avgPerformance: number; zones: Zone[];
  revenueGrowthPct?: number; pendingApprovals?: number; generatedAt: string;
};
type BriefingData = {
  date: string; businessHealth: { score: number; trend: string; status: string };
  growthVelocity: { score: number; trend: string; status: string };
  topOpportunity: { title: string; impact: string; confidence: number } | null;
  topRisk: { title: string; severity: string; description: string } | null;
  aiCooSummary: string; aiChiefOfStaffSummary: string;
  recommendedAction: { title: string; reason: string; impact: string; urgency: string };
  generatedAt: string;
};
type QueueAction = {
  id: string; source: string; type: string; title: string; description: string;
  impact: string; urgency: string; revenueImpact: number; confidence: number;
  zone: string; status: string; submittedBy?: string; submittedAt?: string;
};
type ActionQueueData = {
  actions: QueueAction[]; totalPendingActions: number; totalRevenueImpact: number;
  highUrgency: number; pendingEmailApprovals?: number; pendingAutonomousActions?: number;
  failedWorkflows?: number; generatedAt: string;
};
type Approval = {
  id: string; type: string; title: string; submittedBy: string; submittedAt: string;
  urgency: string; estimatedImpact: string; description?: string; status: string;
};
type ApprovalsData = {
  approvals: Approval[]; pendingCount: number; highUrgency: number;
  pendingEmailApprovals?: number; pendingAutonomousActions?: number; generatedAt: string;
};
type HealthCheck = { name: string; pass: boolean };
type HealthZone = {
  id: string; label: string; score: number; status: string;
  checks: HealthCheck[]; lastChecked: string;
  hermesDetails?: { status: string; lastRunAt: string | null; minutesSinceLastRun: number | null; recommendations24h: number; failures24h: number; explanation: string };
};
type SystemHealthData = {
  overallScore: number; zones: HealthZone[];
  emergencyPauseActive?: boolean; agentSendPolicy?: string;
  pendingApprovals?: number; sendRate?: number; failedWorkflows24h?: number;
  hermesStatus?: string; generatedAt: string;
};
type Notification = { id: string; zone: string; category: string; title: string; body: string; read: boolean; ts: string };
type NotificationsData = { notifications: Notification[]; unread: number; generatedAt: string };
type AgentRow = { name: string; actionCount: number; lastActive: string | null; pendingCount: number; completedCount: number; isActive: boolean };
type AgentActivityData = { agents: AgentRow[]; ceoHeartbeatStatus: { status: string; lastRun: string; isRunning: boolean } | null; generatedAt: string };
type SearchResult = { type: string; label: string; description: string; href: string; zone: string };
type ExpScore = { overallScore: number; dimensions: { label: string; score: number; trend: string }[]; insights: string[]; generatedAt: string };

// ─── Mode ─────────────────────────────────────────────────────────────────────

type Mode = "executive" | "operator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function HealthBar({ score, className = "" }: { score: number; className?: string }) {
  const color = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-blue-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className={`h-1.5 rounded-full bg-muted overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${score}%` }} />
    </div>
  );
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const color = score >= 90 ? "#22c55e" : score >= 75 ? "#3b82f6" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={4} className="text-muted opacity-30" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4} strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)} strokeLinecap="round" />
    </svg>
  );
}

function UrgencyBadge({ u }: { u: string }) {
  const cfg: Record<string, string> = {
    high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[u] ?? "bg-muted text-muted-foreground"}`}>{u}</Badge>;
}

function CategoryBadge({ c }: { c: string }) {
  const cfg: Record<string, string> = {
    revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    security: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[c] ?? "bg-muted text-muted-foreground"}`}>{c}</Badge>;
}

function AgentDot({ isActive }: { isActive: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {isActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
    </span>
  );
}

// ─── Zone Config ──────────────────────────────────────────────────────────────

const ZONES = [
  {
    id: "workforce", label: "Workforce Zone", icon: Users, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", border: "border-violet-200 dark:border-violet-800",
    links: [
      { label: "Workforce OS", href: "/admin/workforce-os" },
      { label: "Performance Reviews", href: "/admin/workforce-os" },
      { label: "Goals & OKRs", href: "/admin/workforce-os" },
      { label: "HR Department", href: "/admin/workforce-os" },
    ],
  },
  {
    id: "operations", label: "Operations Zone", icon: Settings, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-200 dark:border-blue-800",
    links: [
      { label: "Execution Center", href: "/admin/execution-center" },
      { label: "Integrations", href: "/admin/integrations" },
      { label: "AI Approvals", href: "/admin/ai-approvals" },
      { label: "Scheduling Command", href: "/admin/scheduling-command-center" },
      { label: "Autonomy Controls", href: "/admin/autonomy-controls" },
    ],
  },
  {
    id: "intelligence", label: "Intelligence Zone", icon: Brain, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-200 dark:border-emerald-800",
    links: [
      { label: "CEO Heartbeat", href: "/admin/ceo-heartbeat" },
      { label: "Athlete Intelligence", href: "/admin/athlete-intelligence" },
      { label: "Outreach Opportunities", href: "/admin/ai-outreach-opportunities" },
      { label: "First 10", href: "/admin/first-10" },
    ],
  },
  {
    id: "platform", label: "Platform Zone", icon: Layout, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-200 dark:border-amber-800",
    links: [
      { label: "Ecosystem", href: "/admin/ecosystem" },
      { label: "Agent Marketplace", href: "/admin/agent-marketplace" },
      { label: "Ecosystem Health", href: "/admin/ecosystem-health" },
      { label: "Developer Platform", href: "/developer" },
    ],
  },
];

// ─── Global Search (Cmd+K) ────────────────────────────────────────────────────

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [, nav] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isFetching } = useQuery<{ results: SearchResult[]; query: string }>({
    queryKey: ["/api/command-center/search", q],
    queryFn: () => fetchJson(`/api/command-center/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 1,
    staleTime: 5_000,
  });

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const TYPE_ICONS: Record<string, any> = { employee: Users, page: Layers, goal: Target, integration: Zap, workflow: Settings, deployment: ArrowUpRight, report: BarChart3 };
  const ZONE_COLORS: Record<string, string> = { Workforce: "text-violet-500", Operations: "text-blue-500", Intelligence: "text-emerald-500", Platform: "text-amber-500" };

  const quickLinks = [
    { label: "Workforce OS", href: "/admin/workforce-os", icon: Users, zone: "Workforce" },
    { label: "Execution Center", href: "/admin/execution-center", icon: Zap, zone: "Operations" },
    { label: "CEO Heartbeat", href: "/admin/ceo-heartbeat", icon: Brain, zone: "Intelligence" },
    { label: "Ecosystem", href: "/admin/ecosystem", icon: Layout, zone: "Platform" },
    { label: "Integrations", href: "/admin/integrations", icon: Settings, zone: "Operations" },
    { label: "AI Approvals", href: "/admin/ai-approvals", icon: CheckCircle, zone: "Operations" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" data-testid="command-palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search agents, pages, goals, integrations…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" data-testid="input-command-search" />
          {isFetching && <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />}
          <kbd className="text-[9px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground shrink-0">ESC</kbd>
        </div>
        {q.length === 0 ? (
          <div className="p-3">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide px-1 mb-2">Quick navigation</p>
            <div className="space-y-0.5">
              {quickLinks.map(link => {
                const Icon = link.icon;
                return (
                  <button key={link.href} onClick={() => { nav(link.href); onClose(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid={`search-quick-${link.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${ZONE_COLORS[link.zone]}`} />
                    <span className="text-xs flex-1">{link.label}</span>
                    <span className={`text-[9px] ${ZONE_COLORS[link.zone]}`}>{link.zone}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-2 max-h-80 overflow-y-auto">
            {!data?.results.length ? (
              <p className="text-xs text-muted-foreground text-center py-8">No results for "{q}"</p>
            ) : (
              <div className="space-y-0.5">
                {data.results.map((r, i) => {
                  const Icon = TYPE_ICONS[r.type] ?? Layers;
                  return (
                    <button key={i} onClick={() => { nav(r.href); onClose(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid={`search-result-${i}`}>
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${ZONE_COLORS[r.zone] ?? "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{r.label}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{r.description}</p>
                      </div>
                      <span className={`text-[9px] shrink-0 ${ZONE_COLORS[r.zone] ?? ""}`}>{r.zone}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="px-4 py-2 border-t bg-muted/20 flex items-center gap-4 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border bg-background">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border bg-background">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border bg-background">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Attention Priority Banner ──────────────────────────────────────

function AttentionBanner({ summary, approvals, queue }: {
  summary: SummaryData | undefined;
  approvals: ApprovalsData | undefined;
  queue: ActionQueueData | undefined;
}) {
  const criticalRisks = summary?.criticalRisks ?? 0;
  const pendingApprovals = approvals?.pendingCount ?? 0;
  const highUrgencyActions = queue?.highUrgency ?? 0;
  const failedWorkflows = queue?.failedWorkflows ?? 0;

  const items = [
    criticalRisks > 0 && { icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-500/10 border-rose-200 dark:border-rose-800", label: `${criticalRisks} critical risk${criticalRisks !== 1 ? "s" : ""}`, sub: "Immediate attention required", href: "/admin/ceo-heartbeat" },
    pendingApprovals > 0 && { icon: Inbox, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-200 dark:border-amber-800", label: `${pendingApprovals} pending approval${pendingApprovals !== 1 ? "s" : ""}`, sub: "Agents waiting for your review", href: "/admin/ai-approvals" },
    highUrgencyActions > 0 && { icon: Zap, color: "text-primary", bg: "bg-primary/10 border-primary/30", label: `${highUrgencyActions} urgent action${highUrgencyActions !== 1 ? "s" : ""}`, sub: "High-priority queue items", href: null },
    failedWorkflows > 0 && { icon: AlertTriangle, color: "text-orange-500", bg: "bg-orange-500/10 border-orange-200 dark:border-orange-800", label: `${failedWorkflows} failed workflow${failedWorkflows !== 1 ? "s" : ""}`, sub: "Last 24 hours", href: "/admin/execution-center" },
  ].filter(Boolean) as { icon: any; color: string; bg: string; label: string; sub: string; href: string | null }[];

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-500/5" data-testid="attention-banner-clear">
        <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">All clear — no immediate action required</p>
          <p className="text-[9px] text-muted-foreground">All systems operational. Agents are working autonomously.</p>
        </div>
        <span className="ml-auto text-[9px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Live</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" data-testid="attention-banner">
      {items.slice(0, 4).map((item, i) => {
        const Icon = item.icon;
        const inner = (
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${item.bg} hover:opacity-90 transition-opacity`} data-testid={`attention-item-${i}`}>
            <Icon className={`h-4 w-4 shrink-0 ${item.color}`} />
            <div className="min-w-0">
              <p className={`text-xs font-bold ${item.color}`}>{item.label}</p>
              <p className="text-[9px] text-muted-foreground">{item.sub}</p>
            </div>
            {item.href && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />}
          </div>
        );
        return item.href ? <Link key={i} href={item.href}>{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// ─── Section: Agent Activity Strip ───────────────────────────────────────────

function AgentActivityStrip() {
  const { data, isLoading } = useQuery<AgentActivityData>({
    queryKey: ["/api/command-center/agent-activity"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const hb = data?.ceoHeartbeatStatus;
  const agents = data?.agents ?? [];
  const activeAgents = agents.filter(a => a.isActive);

  return (
    <section data-testid="section-agent-activity">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent Activity — Last 4 Hours</h2>
        {!isLoading && (
          <span className="text-[9px] text-muted-foreground ml-auto flex items-center gap-1">
            {activeAgents.length > 0
              ? <><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />{activeAgents.length} active</>
              : <><span className="h-1.5 w-1.5 rounded-full bg-slate-400 inline-block" />Idle</>}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-2 overflow-x-auto pb-1">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-36 rounded-xl shrink-0" />)}</div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {/* CEO Heartbeat status */}
          {hb && (
            <Link href="/admin/ceo-heartbeat">
              <div className={`shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border cursor-pointer hover:bg-muted/20 transition-colors ${hb.isRunning ? "border-emerald-300 dark:border-emerald-700 bg-emerald-500/5" : "bg-card"}`} data-testid="agent-strip-heartbeat">
                <AgentDot isActive={hb.isRunning} />
                <div>
                  <p className="text-[10px] font-semibold whitespace-nowrap">CEO Heartbeat</p>
                  <p className="text-[8px] text-muted-foreground capitalize">{hb.status} · {hb.lastRun ? formatDistanceToNow(new Date(hb.lastRun), { addSuffix: true }) : "never"}</p>
                </div>
              </div>
            </Link>
          )}

          {agents.length === 0 && !hb ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border bg-muted/20 text-muted-foreground">
              <WifiOff className="h-3.5 w-3.5" />
              <p className="text-[10px]">No agent activity in the last 4 hours</p>
            </div>
          ) : (
            agents.map(agent => (
              <div key={agent.name} className={`shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border ${agent.isActive ? "border-emerald-300 dark:border-emerald-700 bg-emerald-500/5" : "bg-card"}`} data-testid={`agent-strip-${agent.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <AgentDot isActive={agent.isActive} />
                <div>
                  <p className="text-[10px] font-semibold whitespace-nowrap truncate max-w-[100px]">{agent.name}</p>
                  <p className="text-[8px] text-muted-foreground">{agent.actionCount} action{agent.actionCount !== 1 ? "s" : ""}{agent.pendingCount > 0 ? ` · ${agent.pendingCount} pending` : ""}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

// ─── Section: Executive Briefing ──────────────────────────────────────────────

function ExecutiveBriefing({ mode }: { mode: Mode }) {
  const { data, isLoading } = useQuery<BriefingData>({ queryKey: ["/api/command-center/briefing"], staleTime: 300_000 });
  const SEVERITY_COLORS: Record<string, string> = { critical: "text-rose-500", high: "text-amber-500", medium: "text-amber-400", low: "text-slate-400" };

  return (
    <section data-testid="section-briefing">
      <div className="flex items-center gap-2 mb-3">
        <Star className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today's Executive Briefing</h2>
        {data && <span className="text-[9px] text-muted-foreground ml-auto">Auto-refreshes daily</span>}
      </div>

      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Business Health */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Business Health</p>
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <ScoreRing score={data?.businessHealth.score ?? 84} size={48} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{data?.businessHealth.score ?? 84}</span>
              </div>
              <div>
                <p className="text-xs font-bold">{(data?.businessHealth.status === "strong" || (data?.businessHealth.score ?? 0) >= 80) ? "Strong" : "Moderate"}</p>
                <p className="text-[9px] text-emerald-600 dark:text-emerald-400">{data?.businessHealth.trend}</p>
              </div>
            </div>
          </div>

          {/* Growth Velocity */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Growth Velocity</p>
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <ScoreRing score={data?.growthVelocity.score ?? 78} size={48} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{data?.growthVelocity.score ?? 78}</span>
              </div>
              <div>
                <p className="text-xs font-bold capitalize">{data?.growthVelocity.status ?? "Stable"}</p>
                <p className="text-[9px] text-emerald-600 dark:text-emerald-400">{data?.growthVelocity.trend}</p>
              </div>
            </div>
          </div>

          {/* Top Opportunity */}
          <div className="p-4 rounded-xl border bg-card border-emerald-200 dark:border-emerald-800 bg-emerald-500/5">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Top Opportunity</p>
            {data?.topOpportunity ? (
              <>
                <p className="text-[10px] font-semibold mb-1 leading-tight">{data.topOpportunity.title}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{data.topOpportunity.impact}</span>
                  <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{data.topOpportunity.confidence}% conf</Badge>
                </div>
              </>
            ) : (
              <p className="text-[9px] text-muted-foreground">No open opportunities yet. Run prospecting agents.</p>
            )}
          </div>

          {/* Top Risk */}
          <div className="p-4 rounded-xl border bg-card border-amber-200 dark:border-amber-800 bg-amber-500/5">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Top Risk</p>
            {data?.topRisk ? (
              <>
                <p className="text-[10px] font-semibold mb-1 leading-tight">{data.topRisk.title}</p>
                <div className="flex items-center gap-1">
                  <AlertTriangle className={`h-3 w-3 ${SEVERITY_COLORS[data.topRisk.severity ?? "medium"]}`} />
                  <span className={`text-[9px] font-medium capitalize ${SEVERITY_COLORS[data.topRisk.severity ?? "medium"]}`}>{data.topRisk.severity} severity</span>
                </div>
              </>
            ) : (
              <p className="text-[9px] text-muted-foreground">No active risks flagged.</p>
            )}
          </div>

          {/* AI COO — Operator mode */}
          {mode === "operator" && data?.aiCooSummary && (
            <div className="sm:col-span-2 p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">AI COO Summary</p>
              <p className="text-[10px] leading-relaxed">{data.aiCooSummary}</p>
            </div>
          )}

          {/* Recommended Action */}
          <div className={`${mode === "operator" ? "sm:col-span-2" : "sm:col-span-2"} p-4 rounded-xl border bg-card border-primary/20 bg-primary/5`}>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Recommended Action</p>
            <div className="flex items-start gap-3">
              <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[10px] font-bold mb-0.5">{data?.recommendedAction.title}</p>
                <p className="text-[9px] text-muted-foreground">{data?.recommendedAction.reason}</p>
              </div>
              <UrgencyBadge u={data?.recommendedAction.urgency ?? "medium"} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Section: Zone Navigation ─────────────────────────────────────────────────

function ZoneNavigation({ summary, mode }: { summary: SummaryData | undefined; mode: Mode }) {
  return (
    <section data-testid="section-zones">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operating Zones</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ZONES.map(zone => {
          const Icon = zone.icon;
          const zoneStats = summary?.zones.find(z => z.id === zone.id);
          const health = zoneStats?.health ?? 88;
          const issues = zoneStats?.issues ?? 0;
          return (
            <div key={zone.id} className={`p-4 rounded-xl border ${zone.border} ${zone.bg} flex flex-col`} data-testid={`zone-card-${zone.id}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${zone.color}`} />
                  <span className="text-xs font-semibold">{zone.label}</span>
                </div>
                {issues > 0
                  ? <Badge className="text-[8px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{issues} issue{issues !== 1 ? "s" : ""}</Badge>
                  : <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
              </div>
              <div className="mb-2">
                <div className="flex items-center justify-between text-[9px] mb-1">
                  <span className="text-muted-foreground">Health</span>
                  <span className={`font-bold ${health >= 90 ? "text-emerald-600 dark:text-emerald-400" : health >= 75 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>{health}%</span>
                </div>
                <HealthBar score={health} />
              </div>
              <div className="flex-1 space-y-1 min-h-0">
                {(mode === "operator" ? zone.links : zone.links.slice(0, 3)).map(link => (
                  <Link key={link.href + link.label} href={link.href}>
                    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-0.5" data-testid={`zone-link-${zone.id}-${link.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{link.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Section: Universal Action Queue ─────────────────────────────────────────

function ActionQueue({ mode }: { mode: Mode }) {
  const { data, isLoading, refetch } = useQuery<ActionQueueData>({
    queryKey: ["/api/command-center/action-queue"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [zoneFilter, setZoneFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const resolveMutation = useMutation({
    mutationFn: ({ actionId, resolution }: { actionId: string; resolution: string }) =>
      apiRequest("POST", "/api/command-center/action-queue/resolve", { actionId, resolution }),
    onSuccess: (_d, { actionId, resolution }) => {
      setDismissed(prev => new Set([...prev, actionId]));
      setSelected(prev => { const next = new Set(prev); next.delete(actionId); return next; });
      toast({ title: resolution === "approved" ? "Action approved" : "Action ignored" });
      qc.invalidateQueries({ queryKey: ["/api/command-center/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/command-center/action-queue"] });
    },
    onError: () => toast({ title: "Failed to resolve action", variant: "destructive" }),
  });

  const bulkIgnoreMutation = useMutation({
    mutationFn: () => Promise.all(
      [...selected].map(id => apiRequest("POST", "/api/command-center/action-queue/resolve", { actionId: id, resolution: "ignored" }))
    ),
    onSuccess: () => {
      setDismissed(prev => new Set([...prev, ...selected]));
      setSelected(new Set());
      toast({ title: `${selected.size} action${selected.size !== 1 ? "s" : ""} ignored` });
      qc.invalidateQueries({ queryKey: ["/api/command-center/action-queue"] });
    },
  });

  const allActions = (data?.actions ?? []).filter(a => !dismissed.has(a.id));
  const visible = allActions.filter(a => zoneFilter === "all" || a.zone === zoneFilter);
  const zones = [...new Set((data?.actions ?? []).map(a => a.zone))];

  const IMPACT_COLORS: Record<string, string> = { high: "text-rose-500", medium: "text-amber-500", low: "text-slate-400" };
  const TYPE_ICON: Record<string, any> = { approval: CheckCircle, opportunity: DollarSign, health: Activity, risk: AlertTriangle, workflow: Settings, hire: Users, reassignment: RefreshCw, promotion: TrendingUp, integration: Zap, goal: Target };

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  return (
    <section data-testid="section-action-queue">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Zap className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Universal Action Queue</h2>
        {data && (
          <>
            {allActions.filter(a => a.urgency === "high").length > 0 && (
              <Badge className="text-[8px] px-1.5 py-0 h-4 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{allActions.filter(a => a.urgency === "high").length} urgent</Badge>
            )}
            {data.pendingEmailApprovals !== undefined && data.pendingEmailApprovals > 0 && (
              <Badge className="text-[8px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{data.pendingEmailApprovals} emails</Badge>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1 text-muted-foreground" onClick={() => bulkIgnoreMutation.mutate()} disabled={bulkIgnoreMutation.isPending} data-testid="button-bulk-ignore">
              Ignore {selected.size} selected
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1 text-muted-foreground" onClick={() => refetch()} data-testid="button-refresh-queue">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {["all", ...zones].map(z => (
          <button key={z} onClick={() => setZoneFilter(z)} data-testid={`filter-zone-${z.toLowerCase()}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${zoneFilter === z ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {z === "all" ? `All (${allActions.length})` : `${z} (${allActions.filter(a => a.zone === z).length})`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : visible.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-800">
          <CheckCircle className="h-4 w-4 text-emerald-500" />
          <div>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Action queue is clear</p>
            <p className="text-[9px] text-muted-foreground">No pending actions in {zoneFilter === "all" ? "any zone" : `the ${zoneFilter} zone`}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(action => {
            const Icon = TYPE_ICON[action.type] ?? Zap;
            const isExpanded = expanded.has(action.id);
            const isSelected = selected.has(action.id);
            return (
              <div key={action.id} className={`rounded-xl border bg-card transition-colors ${isSelected ? "border-primary/40 bg-primary/5" : "hover:bg-muted/5"}`} data-testid={`action-${action.id}`}>
                <div className="flex items-start gap-3 p-3.5">
                  {/* Checkbox */}
                  <button onClick={() => toggleSelect(action.id)} className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"}`} data-testid={`select-action-${action.id}`}>
                    {isSelected && <CheckCircle className="h-3 w-3 text-primary-foreground m-auto" />}
                  </button>

                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${IMPACT_COLORS[action.impact]}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-xs font-semibold">{action.title}</p>
                      <UrgencyBadge u={action.urgency} />
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{action.zone}</Badge>
                      {mode === "operator" && <span className="text-[9px] text-muted-foreground">{action.confidence}% conf</span>}
                    </div>
                    <p className="text-[9px] text-muted-foreground">{action.description}</p>
                    {action.submittedBy && (
                      <p className="text-[8px] text-muted-foreground/70 mt-0.5">
                        From {action.submittedBy}{action.submittedAt ? ` · ${formatDistanceToNow(new Date(action.submittedAt), { addSuffix: true })}` : ""}
                      </p>
                    )}

                    {/* Explainability expander */}
                    {isExpanded && (
                      <div className="mt-2.5 p-2.5 rounded-lg bg-muted/30 border space-y-1.5">
                        <div className="flex items-start gap-1.5">
                          <Info className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[9px] font-semibold text-foreground mb-0.5">Why did this appear?</p>
                            <p className="text-[9px] text-muted-foreground">
                              {action.type === "approval" && "An agent drafted an email or action requiring human review before execution. This ensures no automated communication goes out without your oversight."}
                              {action.type === "health" && "A workflow or system component failed within the last 24 hours. Review and restart the affected service."}
                              {action.type === "opportunity" && "The AI pipeline detected a revenue or growth opportunity based on current lead data and market signals."}
                              {action.type === "risk" && "Risk signals from the forecast engine identified a potential threat to business operations or revenue."}
                              {!["approval", "health", "opportunity", "risk"].includes(action.type) && "Generated by an AI agent based on system signals and business context."}
                            </p>
                          </div>
                        </div>
                        {action.confidence > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Target className="h-3 w-3 text-primary shrink-0" />
                            <p className="text-[9px] text-muted-foreground"><span className="font-semibold text-foreground">{action.confidence}% confidence</span> — AI certainty in this recommendation</p>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Bot className="h-3 w-3 text-muted-foreground shrink-0" />
                          <p className="text-[9px] text-muted-foreground">Source: <span className="font-semibold text-foreground">{action.submittedBy ?? action.source ?? "Intelligence Engine"}</span> · Zone: <span className="font-semibold text-foreground">{action.zone}</span></p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0 items-start">
                    <button onClick={() => toggleExpand(action.id)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground" data-testid={`button-why-${action.id}`} title="Why did this appear?">
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                    </button>
                    <Button size="sm" className="h-7 px-2.5 text-[10px] gap-1" onClick={() => resolveMutation.mutate({ actionId: action.id, resolution: "approved" })} disabled={resolveMutation.isPending} data-testid={`button-approve-${action.id}`}>
                      <CheckCircle className="h-3 w-3" />Approve
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => resolveMutation.mutate({ actionId: action.id, resolution: "ignored" })} disabled={resolveMutation.isPending} data-testid={`button-ignore-${action.id}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Section: Summary KPIs ────────────────────────────────────────────────────

function SummaryKpis({ summary, isLoading, mode }: { summary: SummaryData | undefined; isLoading: boolean; mode: Mode }) {
  const growthPct = summary?.revenueGrowthPct ?? 0;
  const growthStr = growthPct === 0 ? "—" : `${growthPct > 0 ? "+" : ""}${growthPct}%`;
  const growthColor = growthPct > 0 ? "text-emerald-600 dark:text-emerald-400" : growthPct < 0 ? "text-rose-500" : "text-muted-foreground";

  const execKpis = [
    { label: "Platform Health", value: summary ? `${summary.platformHealthScore}%` : "—", sub: "overall", color: summary && summary.platformHealthScore >= 85 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
    { label: "Monthly Revenue", value: summary ? `$${(summary.totalRevenue30d / 100 / 1000).toFixed(0)}k` : "—", sub: "last 30 days", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Growth Velocity", value: growthStr, sub: "MoM", color: growthColor },
    { label: "Opportunities", value: summary?.openOpportunities ?? "—", sub: "open pipeline", color: "text-primary" },
  ];
  const opKpis = [
    { label: "Agent Actions", value: summary ? `${summary.totalAgentActions30d.toLocaleString()}` : "—", sub: "last 30 days", color: "text-primary" },
    { label: "Pending Approvals", value: summary?.pendingApprovals ?? "—", sub: "awaiting review", color: (summary?.pendingApprovals ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
    { label: "Critical Risks", value: summary?.criticalRisks ?? "—", sub: "need attention", color: (summary?.criticalRisks ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
    { label: "Open Risks", value: summary?.openRisks ?? "—", sub: "total active", color: "text-primary" },
  ];
  const kpis = mode === "executive" ? execKpis : [...execKpis, ...opKpis];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="section-kpis">
      {kpis.map(k => (
        <div key={k.label} className="p-3.5 rounded-xl border bg-card text-center">
          {isLoading ? <Skeleton className="h-8 w-16 mx-auto mb-1" /> : <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>}
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
          <p className="text-[8px] text-muted-foreground">{k.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Section: Pending Approvals ───────────────────────────────────────────────

function PendingApprovals() {
  const { data, isLoading, refetch } = useQuery<ApprovalsData>({
    queryKey: ["/api/command-center/approvals"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const approveMutation = useMutation({
    mutationFn: ({ id, approvalType }: { id: string; approvalType: string }) =>
      apiRequest("POST", `/api/command-center/approvals/${id}/approve`, { approvalType }),
    onSuccess: (_d, { id }) => {
      setResolved(prev => new Set([...prev, id]));
      toast({ title: "Approved successfully" });
      qc.invalidateQueries({ queryKey: ["/api/command-center/approvals"] });
      qc.invalidateQueries({ queryKey: ["/api/command-center/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/command-center/action-queue"] });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, approvalType }: { id: string; approvalType: string }) =>
      apiRequest("POST", `/api/command-center/approvals/${id}/reject`, { approvalType }),
    onSuccess: (_d, { id }) => {
      setResolved(prev => new Set([...prev, id]));
      toast({ title: "Rejected" });
      qc.invalidateQueries({ queryKey: ["/api/command-center/approvals"] });
      qc.invalidateQueries({ queryKey: ["/api/command-center/summary"] });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const TYPE_COLORS: Record<string, string> = {
    agent: "text-blue-500", scheduling: "text-violet-500",
    financial: "text-emerald-500", workflow: "text-amber-500", governance: "text-slate-500",
  };

  const visibleApprovals = (data?.approvals ?? []).filter(ap => !resolved.has(ap.id));

  return (
    <section data-testid="section-approvals">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending Approvals</h2>
        {data && data.pendingCount > 0 && (
          <Badge className="text-[8px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{visibleApprovals.length} pending</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Link href="/admin/ai-approvals">
            <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 text-muted-foreground" data-testid="link-view-all-approvals">
              View all <ChevronRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : visibleApprovals.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-800">
          <CheckCircle className="h-4 w-4 text-emerald-500" />
          <div>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Approval queue is clear</p>
            <p className="text-[9px] text-muted-foreground">All pending items have been reviewed.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="divide-y">
            {visibleApprovals.map(ap => (
              <div key={ap.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`approval-${ap.id}`}>
                <Circle className={`h-2 w-2 fill-current shrink-0 mt-1.5 ${TYPE_COLORS[ap.type] ?? "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-medium">{ap.title}</p>
                    <UrgencyBadge u={ap.urgency} />
                  </div>
                  {ap.description && <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{ap.description}</p>}
                  <p className="text-[9px] text-muted-foreground mt-0.5">{ap.submittedBy} · {ap.submittedAt ? formatDistanceToNow(new Date(ap.submittedAt), { addSuffix: true }) : "recently"}</p>
                </div>
                <div className="flex gap-1.5 shrink-0 items-center">
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{ap.estimatedImpact}</span>
                  <Button size="sm" className="h-6 text-[9px] shrink-0 gap-1" onClick={() => approveMutation.mutate({ id: ap.id, approvalType: ap.type })} disabled={approveMutation.isPending || rejectMutation.isPending} data-testid={`button-approve-approval-${ap.id}`}>
                    <ThumbsUp className="h-2.5 w-2.5" />Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground shrink-0" onClick={() => rejectMutation.mutate({ id: ap.id, approvalType: ap.type })} disabled={approveMutation.isPending || rejectMutation.isPending} data-testid={`button-reject-approval-${ap.id}`}>
                    <ThumbsDown className="h-2.5 w-2.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {data && data.pendingCount > 4 && (
            <Link href="/admin/ai-approvals">
              <div className="px-4 py-2.5 text-[10px] text-center text-muted-foreground hover:text-foreground bg-muted/20 transition-colors cursor-pointer border-t">
                View {data.pendingCount - 4} more in AI Approvals →
              </div>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Section: System Health ───────────────────────────────────────────────────

function SystemHealth({ mode }: { mode: Mode }) {
  const { data, isLoading } = useQuery<SystemHealthData>({
    queryKey: ["/api/command-center/system-health"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const [showAll, setShowAll] = useState(false);

  const displayZones = showAll ? (data?.zones ?? []) : (data?.zones ?? []).slice(0, mode === "operator" ? 5 : 4);

  return (
    <section data-testid="section-system-health">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Health</h2>
        {data && <span className="text-xs font-bold ml-auto text-primary">{data.overallScore}% overall</span>}
      </div>

      {/* Status indicators */}
      {data && mode === "operator" && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {data.emergencyPauseActive && (
            <Badge className="text-[9px] bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">🚨 Emergency Pause Active</Badge>
          )}
          {data.agentSendPolicy && (
            <Badge variant="outline" className="text-[9px]">Send policy: {data.agentSendPolicy.replace(/_/g, " ")}</Badge>
          )}
          {typeof data.sendRate === "number" && (
            <Badge variant="outline" className="text-[9px]">Email delivery: {data.sendRate}%</Badge>
          )}
          {typeof data.failedWorkflows24h === "number" && data.failedWorkflows24h > 0 && (
            <Badge className="text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{data.failedWorkflows24h} failed workflows (24h)</Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {displayZones.map(zone => (
              <div key={zone.id} className={`p-3.5 rounded-xl border bg-card ${zone.status === "warning" ? "border-amber-200 dark:border-amber-800" : zone.status === "critical" ? "border-rose-200 dark:border-rose-800" : ""}`} data-testid={`health-zone-${zone.id}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold truncate">{zone.label}</span>
                  {zone.status === "critical"
                    ? <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    : zone.status === "warning"
                    ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    : <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                </div>
                <HealthBar score={zone.score} className="mb-2" />
                <div className="space-y-0.5">
                  {zone.checks.map(c => (
                    <div key={c.name} className="flex items-center gap-1.5 text-[8px]">
                      {c.pass ? <CheckCircle className="h-2 w-2 text-emerald-500 shrink-0" /> : <X className="h-2 w-2 text-rose-500 shrink-0" />}
                      <span className={c.pass ? "text-muted-foreground" : "text-rose-500"}>{c.name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[8px] text-muted-foreground mt-1.5">{formatDistanceToNow(new Date(zone.lastChecked), { addSuffix: true })}</p>
              </div>
            ))}
          </div>
          {(data?.zones ?? []).length > 4 && !showAll && (
            <button onClick={() => setShowAll(true)} className="mt-2 w-full text-[9px] text-muted-foreground hover:text-foreground text-center py-1.5" data-testid="button-show-all-zones">
              Show Hermes Intelligence Zone ↓
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ─── Section: Notifications ───────────────────────────────────────────────────

function NotificationCenter() {
  const { data, isLoading } = useQuery<NotificationsData>({
    queryKey: ["/api/command-center/notifications"],
    staleTime: 60_000,
    refetchInterval: 90_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/command-center/notifications/mark-read", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/command-center/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const notifications = data?.notifications ?? [];
  const visible = showAll ? notifications : notifications.slice(0, 5);

  return (
    <section data-testid="section-notifications">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Bell className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notification Center</h2>
        {(data?.unread ?? 0) > 0 && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-primary text-primary-foreground">{data?.unread} unread</Badge>}
        <div className="ml-auto flex gap-1.5">
          {(data?.unread ?? 0) > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-[9px] text-muted-foreground" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending} data-testid="button-mark-all-read">
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-muted/20">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No notifications in the last 48 hours.</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="divide-y">
            {visible.map(n => (
              <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${n.read ? "" : "bg-primary/5"}`} data-testid={`notification-${n.id}`}>
                <div className="pt-0.5 shrink-0">
                  <div className={`h-2 w-2 rounded-full ${n.read ? "bg-muted" : "bg-primary"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-medium">{n.title}</p>
                    <CategoryBadge c={n.category} />
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{n.zone}</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground">{n.body}</p>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">{formatDistanceToNow(new Date(n.ts), { addSuffix: true })}</span>
              </div>
            ))}
          </div>
          {notifications.length > 5 && (
            <button onClick={() => setShowAll(!showAll)} className="w-full px-4 py-2.5 text-[10px] text-muted-foreground hover:text-foreground bg-muted/20 transition-colors text-center" data-testid="button-show-more-notifications">
              {showAll ? "Show less" : `Show ${notifications.length - 5} more notifications`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Section: Experience Score ────────────────────────────────────────────────

function ExperienceScore({ mode }: { mode: Mode }) {
  const { data, isLoading } = useQuery<ExpScore>({ queryKey: ["/api/command-center/experience-score"], staleTime: 300_000 });
  if (mode === "executive") return null;

  return (
    <section data-testid="section-experience-score">
      <div className="flex items-center gap-2 mb-3">
        <Star className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platform Experience Score</h2>
        {data && <span className="text-xs font-bold ml-auto text-primary">{data.overallScore}/100</span>}
      </div>
      {isLoading ? <Skeleton className="h-28 rounded-xl" /> : (
        <div className="p-4 rounded-xl border bg-card">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {(data?.dimensions ?? []).map(d => (
              <div key={d.label} data-testid={`exp-dim-${d.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className="text-[9px] text-muted-foreground mb-1">{d.label}</p>
                <HealthBar score={d.score} className="mb-0.5" />
                <div className="flex items-center justify-between text-[9px]">
                  <span className="font-bold">{d.score}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{d.trend}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 pt-3 border-t">
            {(data?.insights ?? []).map((insight, i) => (
              <div key={i} className="flex items-start gap-2">
                <ArrowUpRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                <p className="text-[9px] text-muted-foreground">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminUnifiedCommandPage() {
  const [mode, setMode] = useState<Mode>("operator");
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryData>({
    queryKey: ["/api/command-center/summary"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const { data: approvals } = useQuery<ApprovalsData>({
    queryKey: ["/api/command-center/approvals"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: queue } = useQuery<ActionQueueData>({
    queryKey: ["/api/command-center/action-queue"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const totalUrgent = (approvals?.highUrgency ?? 0) + (queue?.highUrgency ?? 0);

  return (
    <>
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}

      <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-unified-command">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Link href="/admin/workforce-os">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                  <ArrowLeft className="h-3.5 w-3.5" />Workforce OS
                </Button>
              </Link>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Command className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              Command Center
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Observe · Understand · Approve · Execute · Measure
              {totalUrgent > 0 && (
                <span className="ml-2 text-amber-500 font-medium">· {totalUrgent} item{totalUrgent !== 1 ? "s" : ""} need attention</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Search trigger */}
            <button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-card hover:bg-muted/30 transition-colors text-xs text-muted-foreground" data-testid="button-open-search">
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="text-[9px] px-1.5 py-0.5 rounded border bg-muted ml-1 hidden sm:inline">⌘K</kbd>
            </button>

            {/* Mode toggle */}
            <div className="flex rounded-xl border overflow-hidden bg-card" data-testid="mode-toggle">
              <button onClick={() => setMode("executive")} className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors ${mode === "executive" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid="mode-executive">
                <Eye className="h-3.5 w-3.5" />Executive
              </button>
              <button onClick={() => setMode("operator")} className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors ${mode === "operator" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid="mode-operator">
                <Settings className="h-3.5 w-3.5" />Operator
              </button>
            </div>
          </div>
        </div>

        {/* Attention Priority Banner — the 5-second scan */}
        <AttentionBanner summary={summary} approvals={approvals} queue={queue} />

        {/* Platform KPIs */}
        <SummaryKpis summary={summary} isLoading={summaryLoading} mode={mode} />

        {/* Agent Activity Strip */}
        <AgentActivityStrip />

        {/* Executive Briefing */}
        <ExecutiveBriefing mode={mode} />

        {/* Zone Navigation */}
        <ZoneNavigation summary={summary} mode={mode} />

        {/* Universal Action Queue */}
        <ActionQueue mode={mode} />

        {/* Pending Approvals */}
        <PendingApprovals />

        {/* System Health */}
        <SystemHealth mode={mode} />

        {/* Notification Center */}
        <NotificationCenter />

        {/* Experience Score — Operator only */}
        <ExperienceScore mode={mode} />

        {/* Forward nav → Customer Success OS */}
        <Link href="/admin/customer-success-os">
          <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5 hover:from-primary/10 hover:to-emerald-500/10 transition-colors cursor-pointer group" data-testid="nav-customer-success-os">
            <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Autonomous Customer Success, Adoption &amp; Retention OS</p>
              <p className="text-xs text-muted-foreground mt-0.5">Activation engine, churn prevention, expansion intelligence, AI CSM, success playbooks, journey mapping, NPS tracking, and portfolio command center.</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </div>
        </Link>

        {/* Architecture Note */}
        <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5" data-testid="architecture-complete">
          <div className="flex items-start gap-3">
            <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold mb-1">AI Operating System — Production Active</p>
              <p className="text-[9px] text-muted-foreground leading-relaxed">
                Command Center surfaces real-time intelligence from all active platform layers. Every recommendation is backed by live data —
                risk signals from the forecast engine, revenue metrics from the ledger, agent actions from the execution log, and approval queues from the autonomy engine.
                Human oversight is required for all critical decisions. Agents learn from every approval and rejection.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
