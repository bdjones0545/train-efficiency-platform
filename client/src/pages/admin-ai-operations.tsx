import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RecentAgentActivity } from "@/components/recent-agent-activity";
import { OrgMemoryFeed, OutcomeAnalyticsPanel } from "@/components/workflow-memory-panel";
import { SetupProgressWidget } from "@/components/setup-progress-widget";
import { TrustSignalsWidget } from "@/components/trust-signals-widget";
import { RecommendationPanel } from "@/components/recommendation-panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Inbox, Brain, ShieldAlert, Activity, GitBranch, Plug, Zap,
  AlertTriangle, CheckCircle, XCircle, Clock, ArrowRight, RefreshCw,
  TrendingUp, BarChart3, AlertCircle, CircleDot, Timer, Cpu, Archive,
  Layers, SkipForward, Ban, Repeat, Users, Sliders, BarChart2,
  Shield, Eye, Lightbulb, Wrench, Globe, ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type AttentionItem = {
  id: string;
  level: string;
  category: string;
  title: string;
  body: string | null;
  status: string;
  createdAt: string;
};

type WorkflowRun = {
  id: string;
  workflowType: string | null;
  displayName: string | null;
  workflowTemplateKey: string | null;
  status: string;
  startedAt: string | null;
  updatedAt: string | null;
  failureReason: string | null;
  error: string | null;
};

type ActionEntry = {
  id: string;
  actorType: string;
  actorName: string | null;
  actionType: string;
  toolName: string | null;
  status: string;
  riskLevel: string | null;
  reasoningSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type ActionSummary = {
  total: number;
  failed: number;
  completed: number;
  requiresApproval: number;
};

type DashboardData = {
  attentionItems: AttentionItem[];
  activeWorkflows: WorkflowRun[];
  failedWorkflows: WorkflowRun[];
  stuckWorkflows: WorkflowRun[];
  recentActions: ActionEntry[];
  actionSummary: ActionSummary;
  openAttentionCount: number;
};

type JobQueueStats = {
  queued: number;
  running: number;
  retrying: number;
  dead_letter: number;
  stuck: number;
  runner?: { isRunning: boolean; lastCycleAt: string | null; cyclesCompleted: number };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<string, { color: string; bg: string }> = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
  important: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20" },
  suggested: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20" },
  informational: { color: "text-gray-600 dark:text-gray-400", bg: "bg-gray-50 dark:bg-gray-900/20" },
};

const WORKFLOW_STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  running: { icon: CircleDot, color: "text-blue-500", label: "Running" },
  pending: { icon: Clock, color: "text-amber-500", label: "Pending" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  completed: { icon: CheckCircle, color: "text-green-500", label: "Done" },
};

function StatCard({
  label, value, icon: Icon, color, href,
}: { label: string; value: number | string; icon: typeof Cpu; color: string; href?: string }) {
  const content = (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
          <div className={`p-2.5 rounded-lg bg-current/10 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const cfg = LEVEL_CONFIG[item.level] ?? LEVEL_CONFIG.informational;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`attention-row-${item.id}`}>
      <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-1">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.category} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
        </p>
      </div>
      <Badge variant="outline" className={`text-xs shrink-0 ${cfg.color}`}>{item.level}</Badge>
    </div>
  );
}

function WorkflowRow({ wf, isStuck }: { wf: WorkflowRun; isStuck?: boolean }) {
  const status = isStuck ? "running" : wf.status;
  const cfg = WORKFLOW_STATUS_CONFIG[status] ?? WORKFLOW_STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const name = wf.displayName ?? wf.workflowTemplateKey ?? wf.workflowType ?? "Unnamed Workflow";

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`workflow-row-${wf.id}`}>
      <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${isStuck ? "text-amber-500" : cfg.color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-1">{name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isStuck ? "Stuck >30 min" : cfg.label}
          {wf.updatedAt && ` · ${formatDistanceToNow(new Date(wf.updatedAt), { addSuffix: true })}`}
        </p>
        {wf.failureReason && <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{wf.failureReason}</p>}
        {wf.error && !wf.failureReason && <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{wf.error}</p>}
      </div>
    </div>
  );
}

// ─── Scorecard Types ──────────────────────────────────────────────────────────

type ScorecardData = {
  agents: { running: number; paused: number; failed: number; lastActivityAt: string | null; successRate: number };
  revenue: { upsellCount: number; estimatedLiftCents: number };
  churn: { highRisk: number; mediumRisk: number; total: number };
  alerts: { critical: number; important: number; total: number; unresolved: number };
  integrations: { connected: number; total: number; error: number; degraded: number; items: { type: string; displayName: string; status: string }[] };
  healthScore: { score: number; revenueIntelligence: string; automations: string; integrations: string; alerts: string };
};

// ─── Scorecard Helper ─────────────────────────────────────────────────────────

function statusColor(status: string) {
  if (status === "critical") return "text-red-500";
  if (status === "warning") return "text-amber-500";
  return "text-green-500";
}

function statusDot(status: string) {
  if (status === "critical") return "bg-red-500";
  if (status === "warning") return "bg-amber-500";
  return "bg-green-500";
}

function integrationStatusColor(status: string) {
  if (status === "error") return "text-red-500";
  if (status === "degraded") return "text-amber-500";
  if (status === "connected") return "text-green-500";
  return "text-muted-foreground";
}

function integrationStatusDot(status: string) {
  if (status === "error") return "bg-red-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "connected") return "bg-green-500";
  return "bg-muted-foreground";
}

const INTEGRATION_LABELS: Record<string, string> = {
  gmail: "Gmail",
  google_calendar: "Calendar",
  slack: "Slack",
  meta_ads: "Meta",
  stripe: "Stripe",
  hubspot: "HubSpot",
};

// ─── Scorecard Component ──────────────────────────────────────────────────────

function AiOpsScorecard() {
  const { data, isLoading } = useQuery<ScorecardData>({
    queryKey: ["/api/ai-ops/scorecard"],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const healthScore = data?.healthScore.score ?? 0;
  const healthColor =
    healthScore >= 85 ? "text-green-500" : healthScore >= 65 ? "text-amber-500" : "text-red-500";
  const healthRingColor =
    healthScore >= 85 ? "stroke-green-500" : healthScore >= 65 ? "stroke-amber-500" : "stroke-red-500";

  const circumference = 2 * Math.PI * 20;
  const dashOffset = circumference - (healthScore / 100) * circumference;

  return (
    <div data-testid="ai-ops-scorecard" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" />
          Executive Scorecard
        </p>
        {!isLoading && data && (
          <span className={`text-xs font-semibold ${healthColor}`}>
            AI Health: {healthScore}/100
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* ── Card 1: Active Agents ───────────────────────────────────────── */}
        <Link href="/admin/workflows">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-agents"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20">
              <GitBranch className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Active Agents</span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {(data?.agents.running ?? 0) + (data?.agents.paused ?? 0)}
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-green-500" /> Running</span>
                      <span className="font-medium">{data?.agents.running ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><Timer className="h-2.5 w-2.5 text-amber-500" /> Paused</span>
                      <span className="font-medium">{data?.agents.paused ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><XCircle className="h-2.5 w-2.5 text-red-500" /> Failed</span>
                      <span className="font-medium">{data?.agents.failed ?? 0}</span>
                    </div>
                  </div>
                  {data?.agents.lastActivityAt && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground/70 truncate">
                      Last: {formatDistanceToNow(new Date(data.agents.lastActivityAt), { addSuffix: true })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ── Card 2: Revenue Opportunities ───────────────────────────────── */}
        <Link href="/admin/recommendations">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-revenue"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Revenue</span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {data?.revenue.upsellCount ?? 0}
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Upsell Opps</span>
                      <span className="font-medium">{data?.revenue.upsellCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Est. Lift</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        ${((data?.revenue.estimatedLiftCents ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">Upsell opportunities identified</p>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ── Card 3: Churn Risks ─────────────────────────────────────────── */}
        <Link href="/admin/attention">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-churn"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border-b border-orange-500/20">
              <Users className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Churn Risk</span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <p className={`text-2xl font-bold ${(data?.churn.highRisk ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                    {data?.churn.total ?? 0}
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> High</span>
                      <span className="font-medium text-red-500">{data?.churn.highRisk ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> Medium</span>
                      <span className="font-medium text-amber-500">{data?.churn.mediumRisk ?? 0}</span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">Clients at retention risk</p>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ── Card 4: Open Alerts ─────────────────────────────────────────── */}
        <Link href="/admin/attention">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-alerts"
          >
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${(data?.alerts.critical ?? 0) > 0 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
              <AlertTriangle className={`h-3.5 w-3.5 ${(data?.alerts.critical ?? 0) > 0 ? "text-red-500" : "text-amber-500"}`} />
              <span className={`text-xs font-semibold ${(data?.alerts.critical ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                Open Alerts
              </span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <p className={`text-2xl font-bold ${(data?.alerts.critical ?? 0) > 0 ? "text-red-600 dark:text-red-400" : (data?.alerts.total ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                    {data?.alerts.total ?? 0}
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><XCircle className="h-2.5 w-2.5 text-red-500" /> Critical</span>
                      <span className="font-medium">{data?.alerts.critical ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Important</span>
                      <span className="font-medium">{data?.alerts.important ?? 0}</span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    {(data?.alerts.total ?? 0) === 0 ? "All clear — no open alerts" : "Need attention"}
                  </p>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ── Card 5: Integrations ────────────────────────────────────────── */}
        <Link href="/admin/gmail-conversations">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-integrations"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/10 border-b border-violet-500/20">
              <Globe className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400">Integrations</span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <p className={`text-2xl font-bold ${(data?.integrations.error ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-violet-600 dark:text-violet-400"}`}>
                    {data?.integrations.connected ?? 0}
                    <span className="text-sm font-normal text-muted-foreground">/{data?.integrations.total ?? 0}</span>
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    {(data?.integrations.items ?? []).slice(0, 3).map((item) => (
                      <div key={item.type} className="flex justify-between items-center">
                        <span>{INTEGRATION_LABELS[item.type] ?? item.displayName}</span>
                        <span className={`flex items-center gap-1 ${integrationStatusColor(item.status)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${integrationStatusDot(item.status)}`} />
                          {item.status === "connected" ? "OK" : item.status}
                        </span>
                      </div>
                    ))}
                    {(data?.integrations.items ?? []).length === 0 && (
                      <p className="text-muted-foreground/70">No integrations configured</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ── Card 6: AI Health Score ─────────────────────────────────────── */}
        <Link href="/admin/agent-ops">
          <div
            className="rounded-xl border border-border/60 bg-card hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
            data-testid="scorecard-health"
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-500/10 border-b border-slate-500/20">
              <ShieldAlert className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">AI Health</span>
            </div>
            <div className="px-3 py-2.5">
              {isLoading ? (
                <div className="space-y-1.5"><Skeleton className="h-6 w-16" /><Skeleton className="h-3 w-full" /></div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <svg className="h-9 w-9 -rotate-90 flex-shrink-0" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
                      <circle
                        cx="24" cy="24" r="20"
                        fill="none" strokeWidth="4" strokeLinecap="round"
                        className={healthRingColor}
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        style={{ transition: "stroke-dashoffset 0.6s ease" }}
                      />
                    </svg>
                    <p className={`text-2xl font-bold ${healthColor}`}>{healthScore}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-[11px]">
                    {[
                      { label: "Revenue", val: data?.healthScore.revenueIntelligence ?? "healthy" },
                      { label: "Automations", val: data?.healthScore.automations ?? "healthy" },
                      { label: "Integrations", val: data?.healthScore.integrations ?? "healthy" },
                    ].map(({ label, val }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`flex items-center gap-1 capitalize font-medium ${statusColor(val)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(val)}`} />
                          {val}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Alerts</span>
                      <span className={`text-[10px] font-medium ${(data?.alerts.critical ?? 0) > 0 ? "text-red-500" : "text-green-500"}`}>
                        {data?.healthScore.alerts ?? "All Clear"}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

// ─── Section Nav Groups ────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "Intelligence",
    icon: Lightbulb,
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-900/20",
    border: "border-violet-200 dark:border-violet-800/50",
    links: [
      { href: "/admin/attention", label: "Attention Inbox", icon: Inbox },
      { href: "/admin/business-brain", label: "Business Brain", icon: Brain },
      { href: "/admin/recommendations", label: "Suggestions", icon: Zap },
      { href: "/admin/workflow-heatmap", label: "Heatmap", icon: BarChart2 },
    ],
  },
  {
    label: "Automation",
    icon: GitBranch,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-800/50",
    links: [
      { href: "/admin/workflow-orchestrator", label: "Orchestration", icon: Activity },
      { href: "/admin/workflows", label: "Automations", icon: GitBranch },
      { href: "/admin/ai-workforce", label: "Workforce", icon: Users },
      { href: "/admin/autonomy-controls", label: "Autonomy", icon: Sliders },
    ],
  },
  {
    label: "Build & Configure",
    icon: Wrench,
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    border: "border-emerald-200 dark:border-emerald-800/50",
    links: [
      { href: "/admin/workflow-builder", label: "Builder", icon: Zap },
      { href: "/admin/workflows-library", label: "Library", icon: Layers },
      { href: "/admin/agent-tools", label: "AI Tools", icon: Plug },
    ],
  },
  {
    label: "Monitoring",
    icon: Eye,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    border: "border-orange-200 dark:border-orange-800/50",
    links: [
      { href: "/admin/agent-ops", label: "System Health", icon: ShieldAlert },
      { href: "/admin/trigger-audit", label: "Activity Log", icon: Activity },
      { href: "/admin/ai-governance", label: "Governance", icon: Shield },
    ],
  },
  {
    label: "Integrations",
    icon: Globe,
    color: "text-pink-600",
    bg: "bg-pink-50 dark:bg-pink-900/20",
    border: "border-pink-200 dark:border-pink-800/50",
    links: [
      { href: "/admin/gmail-conversations", label: "Gmail", icon: Inbox },
    ],
  },
];

// ─── WorkforceCta — org-state-aware entry point ───────────────────────────────

function WorkforceCta() {
  const { data: settings, isLoading } = useQuery<any | null>({
    queryKey: ["/api/workforce/settings"],
    staleTime: 5 * 60 * 1000,
  });

  const isConfigured = !isLoading && settings != null;
  const href = isConfigured ? "/admin/ai-workforce/settings" : "/onboarding/ai-workforce";
  const label = isConfigured ? "Edit AI Workforce" : "AI Workforce Setup Wizard";
  const subtitle = isConfigured
    ? "View agents, rules & automation"
    : "Configure and deploy your AI workforce — agents, roles, and automation rules.";

  return (
    <Link href={href}>
      <div
        className="flex items-center gap-4 px-5 py-4 rounded-xl border border-violet-200 dark:border-violet-800/50 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/30 dark:hover:to-purple-900/30 transition-colors cursor-pointer"
        data-testid={isConfigured ? "cta-workforce-edit" : "cta-workforce-setup-wizard"}
      >
        <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-800/40 flex items-center justify-center flex-shrink-0">
          <Zap className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-violet-900 dark:text-violet-200 text-sm">{label}</p>
          <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">{subtitle}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-violet-500 flex-shrink-0" />
      </div>
    </Link>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAiOperationsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ["/api/ai-ops/dashboard"],
    refetchInterval: 60000,
  });

  const { data: jobStats, isLoading: jobStatsLoading } = useQuery<JobQueueStats>({
    queryKey: ["/api/job-queue/stats"],
    refetchInterval: 30000,
  });

  const summary = data?.actionSummary;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-ai-operations">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" />
            AI Operations Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Central hub for all AI agent activity, workflow health, and operational intelligence.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-dashboard"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Executive Scorecard */}
      <AiOpsScorecard />

      {/* Workforce CTA — state-aware */}
      <WorkforceCta />

      {/* AI Area Navigation */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" />
          AI Operations Areas
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {NAV_GROUPS.map((group) => (
            <div
              key={group.label}
              className={`rounded-lg border p-3 ${group.bg} ${group.border}`}
              data-testid={`nav-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className={`flex items-center gap-1.5 mb-2 ${group.color}`}>
                <group.icon className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">{group.label}</span>
                <span className="ml-auto text-[9px] font-medium px-1 py-0.5 rounded-full bg-white/60 dark:bg-black/20">
                  {group.links.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {group.links.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href}>
                    <button
                      className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-white/50 dark:hover:bg-white/5 transition-colors text-left text-foreground/80"
                      data-testid={`link-nav-group-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Open Attention"
              value={data?.openAttentionCount ?? 0}
              icon={Inbox}
              color={data?.openAttentionCount ? "text-amber-600" : "text-green-600"}
              href="/admin/attention"
            />
            <StatCard
              label="Active Workflows"
              value={data?.activeWorkflows.length ?? 0}
              icon={GitBranch}
              color="text-blue-600"
              href="/admin/workflows"
            />
            <StatCard
              label="Failed Workflows"
              value={data?.failedWorkflows.length ?? 0}
              icon={XCircle}
              color={data?.failedWorkflows.length ? "text-red-600" : "text-green-600"}
              href="/admin/workflows"
            />
            <StatCard
              label="Needs Approval"
              value={summary?.requiresApproval ?? 0}
              icon={AlertTriangle}
              color={summary?.requiresApproval ? "text-orange-600" : "text-green-600"}
            />
          </>
        )}
      </div>

      {/* Job Queue stats row */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          Job Queue Health
          {jobStats?.runner && (
            <span className={`ml-2 inline-flex items-center gap-1 text-xs font-normal ${jobStats.runner.isRunning ? "text-green-600" : "text-amber-600"}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${jobStats.runner.isRunning ? "bg-green-500" : "bg-amber-500"}`} />
              {jobStats.runner.isRunning ? "Runner active" : "Runner idle"}
            </span>
          )}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {jobStatsLoading ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <StatCard label="Queued" value={jobStats?.queued ?? 0} icon={Layers} color="text-blue-600" href="/admin/agent-ops" />
              <StatCard label="Running" value={jobStats?.running ?? 0} icon={CircleDot} color="text-cyan-600" href="/admin/agent-ops" />
              <StatCard label="Retrying" value={jobStats?.retrying ?? 0} icon={Repeat} color={jobStats?.retrying ? "text-amber-600" : "text-green-600"} href="/admin/agent-ops" />
              <StatCard label="Dead Letter" value={jobStats?.dead_letter ?? 0} icon={Archive} color={jobStats?.dead_letter ? "text-red-600" : "text-green-600"} href="/admin/agent-ops" />
              <StatCard label="Stuck Jobs" value={jobStats?.stuck ?? 0} icon={SkipForward} color={jobStats?.stuck ? "text-orange-600" : "text-green-600"} href="/admin/agent-ops" />
            </>
          )}
        </div>
      </div>

      {/* Action summary strip */}
      {!isLoading && summary && (
        <div className="flex items-center gap-6 bg-muted/40 rounded-lg px-5 py-3 text-sm" data-testid="action-summary-strip">
          <span className="text-muted-foreground font-medium">Action Log:</span>
          <span className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold">{summary.total}</span> total
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            <span className="font-semibold">{summary.completed}</span> completed
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-500" />
            <span className="font-semibold">{summary.failed}</span> failed
          </span>
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Open Attention Items */}
          <Card data-testid="card-attention-items">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Inbox className="h-4 w-4 text-amber-500" />
                Open Attention Items
                <Link href="/admin/attention" className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                    View all <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : !data?.attentionItems.length ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  All clear — no open attention items
                </div>
              ) : (
                data.attentionItems.map(item => <AttentionRow key={item.id} item={item} />)
              )}
            </CardContent>
          </Card>

          {/* Active + Stuck Workflows */}
          <Card data-testid="card-workflow-status">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4 text-blue-500" />
                Workflow Status
                <Link href="/admin/workflows" className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                    View all <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : (
                <>
                  {/* Stuck */}
                  {data?.stuckWorkflows && data.stuckWorkflows.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <Timer className="h-3 w-3" /> Stuck (&gt;30 min)
                      </p>
                      {data.stuckWorkflows.map(wf => <WorkflowRow key={wf.id} wf={wf} isStuck />)}
                    </div>
                  )}
                  {/* Failed */}
                  {data?.failedWorkflows && data.failedWorkflows.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> Failed
                      </p>
                      {data.failedWorkflows.slice(0, 5).map(wf => <WorkflowRow key={wf.id} wf={wf} />)}
                    </div>
                  )}
                  {/* Active */}
                  {data?.activeWorkflows && data.activeWorkflows.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <CircleDot className="h-3 w-3" /> Active
                      </p>
                      {data.activeWorkflows.slice(0, 5).map(wf => <WorkflowRow key={wf.id} wf={wf} />)}
                    </div>
                  )}
                  {!data?.failedWorkflows.length && !data?.activeWorkflows.length && !data?.stuckWorkflows.length && (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      No active or failed workflows
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Agent Activity — full log */}
          <RecentAgentActivity limit={20} title="Recent Agent Actions" />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* System Health Summary */}
          <Card data-testid="card-system-health">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-primary" />
                System Health
                <Link href="/admin/agent-ops" className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                    Details <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <div className="space-y-2">
                  <HealthRow label="Workflow Engine" ok={!data?.stuckWorkflows.length} detail={data?.stuckWorkflows.length ? `${data.stuckWorkflows.length} stuck` : "Healthy"} />
                  <HealthRow label="Failed Workflows" ok={!data?.failedWorkflows.length} detail={data?.failedWorkflows.length ? `${data.failedWorkflows.length} failed` : "None"} />
                  <HealthRow label="Attention Queue" ok={!data?.openAttentionCount} detail={data?.openAttentionCount ? `${data.openAttentionCount} open` : "Clear"} />
                  <HealthRow label="Approval Queue" ok={!summary?.requiresApproval} detail={summary?.requiresApproval ? `${summary.requiresApproval} waiting` : "Clear"} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failed-only activity */}
          <RecentAgentActivity limit={5} status="failed" title="Failed Actions" compact />

          {/* Phase 7 — Setup Progress */}
          <SetupProgressWidget />

          {/* Phase 7 — Trust Signals */}
          <TrustSignalsWidget />
        </div>
      </div>

      {/* Phase 7 — Recommendations */}
      <RecommendationPanel />

      {/* ── Memory + Outcome Analytics Row ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OrgMemoryFeed limit={12} />
        <OutcomeAnalyticsPanel />
      </div>

      {/* ── Memory Lifecycle Controls ─────────────────────────────────────── */}
      <MemoryLifecycleCard />
    </div>
  );
}

function MemoryLifecycleCard() {
  const { toast } = useToast();

  const lifecycleMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/workflow-context/lifecycle"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Memory lifecycle complete", description: `Compressed ${data.compressed}, archived ${data.archived} memories.` });
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-context/stats"] });
    },
    onError: () => toast({ title: "Lifecycle failed", variant: "destructive" }),
  });

  return (
    <Card data-testid="memory-lifecycle-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Archive className="h-4 w-4 text-muted-foreground" />
          Memory Lifecycle Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            <p>Compress low-value memories and archive stale entries.</p>
            <p className="text-xs mt-0.5">Operator overrides are never auto-deleted.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => lifecycleMutation.mutate()}
            disabled={lifecycleMutation.isPending}
            data-testid="button-run-lifecycle"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${lifecycleMutation.isPending ? "animate-spin" : ""}`} />
            {lifecycleMutation.isPending ? "Running…" : "Run Lifecycle"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-2" data-testid={`health-row-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium">{detail}</span>
        {ok
          ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
      </div>
    </div>
  );
}
