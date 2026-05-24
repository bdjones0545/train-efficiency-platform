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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Inbox, Brain, ShieldAlert, Activity, GitBranch, Plug, Zap,
  AlertTriangle, CheckCircle, XCircle, Clock, ArrowRight, RefreshCw,
  TrendingUp, BarChart3, AlertCircle, CircleDot, Timer, Cpu, Archive,
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

// ─── Quick Links ──────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { href: "/admin/attention", label: "Attention Inbox", icon: Inbox },
  { href: "/admin/business-brain", label: "Business Brain", icon: Brain },
  { href: "/admin/agent-ops", label: "Agent Ops Monitor", icon: ShieldAlert },
  { href: "/admin/workflow-orchestrator", label: "Orchestrator", icon: Activity },
  { href: "/admin/workflows", label: "Workflows", icon: GitBranch },
  { href: "/admin/trigger-audit", label: "Trigger Audit", icon: Zap },
  { href: "/admin/agent-tools", label: "Agent Tools", icon: Plug },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAiOperationsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ["/api/ai-ops/dashboard"],
    refetchInterval: 60000,
  });

  const summary = data?.actionSummary;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-ai-operations">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
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
          {/* Quick Nav */}
          <Card data-testid="card-quick-nav">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                AI Ops Sections
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-0.5">
                {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-muted/60 transition-colors text-left"
                      data-testid={`link-ai-ops-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      {label}
                      <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground" />
                    </button>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

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
        </div>
      </div>

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
