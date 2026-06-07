import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  DollarSign,
  Target,
  BarChart2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Zap,
  Shield,
  Bot,
  Brain,
  Cpu,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RevSummary {
  totalRevenueCents?: number;
  periodRevenueCents?: number;
  previousPeriodRevenueCents?: number;
  growthPct?: number;
  growth?: number;
  total?: number;
  thisMonth?: number;
  lastMonth?: number;
}

interface LeadStats {
  total?: number;
  new?: number;
  inProgress?: number;
  converted?: number;
  conversionRate?: number;
}

interface UtilizationData {
  overallUtilization?: number;
  utilizationPct?: number;
  utilizationPercent?: number;
  capacity?: number;
  coaches?: Array<{ utilizationPct?: number }>;
}

interface RetentionWorkflow {
  id: string;
  severity?: string;
  status?: string;
}

interface AttentionItem {
  id: string;
  level: string;
  category: string;
  title: string;
  body: string;
  source: string;
  sourceId: string;
  actionUrl: string;
  actionLabel: string;
  status: string;
  score?: number;
}

interface Recommendation {
  id: string;
  type: string;
  priority: string;
  title: string;
  reason: string;
  impact: string;
  actionLabel?: string;
  actionUrl?: string;
}

interface WorkforceAgent {
  id: string;
  name: string;
  department?: string;
  isEnabled?: boolean;
  recentActions?: number;
  successRate?: number;
  blockedActions?: number;
  pendingApprovals?: number;
}

interface WorkforceHealth {
  healthScore?: number;
  systemHealth?: string;
  activeAgents?: number;
  disabledAgents?: number;
  actionsToday?: number;
  failedActionsToday?: number;
  integrationsConnected?: number;
  workflowsPublished?: number;
  openAlerts?: number;
}

interface HeartbeatPriority {
  id?: string;
  title?: string;
  reason?: string;
  priority?: string;
  actionType?: string;
  summary?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Trend = "up" | "down" | "flat";

function formatDollars(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
}

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

const DEPT_MAP: Record<string, string> = {
  partnerships: "Sales",
  revenue: "Sales",
  sales: "Sales",
  growth: "Sales",
  operations: "Operations",
  scheduling: "Operations",
  "customer success": "Customer Success",
  customer_success: "Customer Success",
  "customer-success": "Customer Success",
  success: "Customer Success",
  engineering: "Engineering",
  platform: "Engineering",
  technical: "Engineering",
};

const DEPT_ORDER = ["Sales", "Operations", "Customer Success", "Engineering"];

function normDept(raw?: string): string {
  if (!raw) return "Operations";
  return DEPT_MAP[raw.toLowerCase()] ?? raw;
}

interface DeptSummary {
  name: string;
  agentCount: number;
  active: number;
  actionsToday: number;
  pendingApprovals: number;
  status: "Active" | "Partial" | "Idle";
}

function groupByDept(agents: WorkforceAgent[]): DeptSummary[] {
  const map: Record<string, WorkforceAgent[]> = {};
  for (const a of agents) {
    const dept = normDept(a.department);
    if (!map[dept]) map[dept] = [];
    map[dept].push(a);
  }
  return DEPT_ORDER.filter((d) => map[d]?.length).map((dept) => {
    const list = map[dept];
    const active = list.filter((a) => a.isEnabled !== false).length;
    const actionsToday = list.reduce((s, a) => s + (a.recentActions ?? 0), 0);
    const pendingApprovals = list.reduce(
      (s, a) => s + (a.blockedActions ?? a.pendingApprovals ?? 0),
      0
    );
    const status: DeptSummary["status"] =
      active === list.length ? "Active" : active > 0 ? "Partial" : "Idle";
    return { name: dept, agentCount: list.length, active, actionsToday, pendingApprovals, status };
  });
}

interface SnapshotResult {
  lines: string[];
  status: string;
  variant: "success" | "warning" | "destructive" | "default";
}

function generateSnapshot(
  rev: RevSummary | undefined | null,
  leads: LeadStats | undefined | null,
  util: UtilizationData | undefined | null,
  retention: RetentionWorkflow[] | undefined | null
): SnapshotResult {
  const lines: string[] = [];
  let risks = 0;

  const growth = rev?.growthPct ?? rev?.growth ?? 0;
  if (growth > 5) {
    lines.push(`Revenue is up ${Math.round(growth)}% this month — strong performance.`);
  } else if (growth < -5) {
    lines.push(`Revenue is down ${Math.round(Math.abs(growth))}% compared to last month.`);
    risks++;
  } else {
    lines.push("Revenue is tracking normally this month.");
  }

  const newLeads = leads?.new ?? 0;
  const totalLeads = leads?.total ?? 0;
  if (newLeads >= 5) {
    lines.push(`Lead flow is healthy with ${newLeads} new leads this week.`);
  } else if (totalLeads === 0 && newLeads === 0) {
    lines.push("No active leads in the pipeline right now.");
    risks++;
  } else {
    lines.push("Lead flow is steady.");
  }

  const utilPct =
    util?.overallUtilization ?? util?.utilizationPct ?? util?.utilizationPercent ?? null;
  if (utilPct !== null) {
    if (utilPct >= 90) {
      lines.push(`Capacity is at ${Math.round(utilPct)}% — approaching maximum.`);
      risks++;
    } else if (utilPct >= 65) {
      lines.push(`Capacity is at ${Math.round(utilPct)}% — healthy load.`);
    } else {
      lines.push(`Capacity is at ${Math.round(utilPct)}% with room to grow.`);
    }
  }

  const critical = (retention ?? []).filter(
    (r) => (r.severity === "high" || r.severity === "critical") && r.status !== "resolved"
  ).length;
  const active = (retention ?? []).filter((r) => r.status !== "resolved" && r.status !== "closed")
    .length;
  if (critical > 0) {
    lines.push(
      `${critical} athlete${critical > 1 ? "s" : ""} flagged as high retention risk.`
    );
    risks++;
  } else if (active > 0) {
    lines.push(`${active} retention workflow${active > 1 ? "s" : ""} active and being managed.`);
  } else {
    lines.push("Retention looks stable — no urgent risks detected.");
  }

  let status = "Operating Normally";
  let variant: SnapshotResult["variant"] = "success";
  if (risks >= 3) {
    status = "Needs Attention";
    variant = "destructive";
  } else if (risks >= 1) {
    status = "Some Areas Need Review";
    variant = "warning";
  } else if (growth > 8 && newLeads >= 3) {
    status = "Growing Strong";
    variant = "success";
  }

  return { lines, status, variant };
}

// ─── Small shared components ──────────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  isLoading,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  trend?: Trend;
  isLoading?: boolean;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </span>
          </div>
          {!isLoading && trend && <TrendIcon trend={trend} />}
        </div>
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-24 mb-1.5" />
            <Skeleton className="h-3 w-32" />
          </>
        ) : (
          <>
            <p className="text-2xl font-bold leading-none" data-testid={testId ? `${testId}-value` : undefined}>
              {value}
            </p>
            {sub && (
              <p className="text-xs text-muted-foreground mt-1.5" data-testid={testId ? `${testId}-sub` : undefined}>
                {sub}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const perms = usePermissions();

  const isAdmin = perms.canManageAI;
  const isCoach = perms.canViewRevenue;

  // All queries fire in parallel — each gated by role
  const revQ = useQuery<RevSummary>({
    queryKey: ["/api/admin/revenue-summary-v2"],
    enabled: isCoach,
  });
  const leadQ = useQuery<LeadStats>({
    queryKey: ["/api/admin/athlete-leads/stats"],
    enabled: isCoach,
  });
  const utilQ = useQuery<UtilizationData>({
    queryKey: ["/api/admin/coach-utilization-diagnostic"],
    enabled: isAdmin,
  });
  const retQ = useQuery<RetentionWorkflow[]>({
    queryKey: ["/api/admin/retention-workflows"],
    enabled: isAdmin,
  });
  const attnQ = useQuery<AttentionItem[]>({
    queryKey: ["/api/attention"],
    enabled: isCoach,
  });
  const recQ = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    enabled: isCoach,
  });
  const agentsQ = useQuery<WorkforceAgent[]>({
    queryKey: ["/api/workforce/agents"],
    enabled: isAdmin,
  });
  const healthQ = useQuery<WorkforceHealth>({
    queryKey: ["/api/workforce/health"],
    enabled: isAdmin,
  });
  const prioritiesQ = useQuery<HeartbeatPriority[]>({
    queryKey: ["/api/admin/ceo-heartbeat/priorities"],
    enabled: isAdmin,
  });

  // Loading state — show skeleton while permissions resolve
  if (perms.isHydrating) {
    return (
      <div className="space-y-8 pb-12 pt-2" data-testid="home-loading">
        <div className="space-y-1">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  // Derive greeting
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "Coach";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Business Snapshot
  const snapshot = generateSnapshot(revQ.data, leadQ.data, utilQ.data, retQ.data);

  const snapshotClasses: Record<string, string> = {
    success:
      "bg-green-50 border-green-200 text-green-900 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200",
    warning:
      "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200",
    destructive:
      "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200",
    default: "bg-muted border-border text-foreground",
  };

  // Revenue metrics
  const revData = revQ.data;
  const periodRev =
    revData?.periodRevenueCents ?? revData?.thisMonth ?? revData?.total ?? null;
  const revGrowth = revData?.growthPct ?? revData?.growth ?? 0;
  const revTrend: Trend = revGrowth > 3 ? "up" : revGrowth < -3 ? "down" : "flat";

  // Lead metrics
  const totalLeads = leadQ.data?.total ?? 0;
  const newLeads = leadQ.data?.new ?? 0;
  const convertedLeads = leadQ.data?.converted ?? 0;
  const convRate =
    leadQ.data?.conversionRate ??
    (totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0);
  const leadTrend: Trend = newLeads >= 5 ? "up" : newLeads === 0 && totalLeads === 0 ? "down" : "flat";

  // Utilization
  const utilPct =
    utilQ.data?.overallUtilization ??
    utilQ.data?.utilizationPct ??
    utilQ.data?.utilizationPercent ??
    null;
  const utilTrend: Trend = utilPct === null ? "flat" : utilPct > 85 ? "up" : utilPct < 40 ? "down" : "flat";

  // Retention
  const activeRet = (retQ.data ?? []).filter(
    (r) => r.status !== "resolved" && r.status !== "closed"
  ).length;
  const retTrend: Trend = activeRet === 0 ? "flat" : activeRet <= 2 ? "flat" : "down";

  // Best action — prefer high-priority recommendation, fallback to top attention item
  const bestRec =
    recQ.data?.find((r) => r.priority === "high") ?? recQ.data?.[0] ?? null;
  const attnSorted = (attnQ.data ?? [])
    .filter((a) => a.status === "active")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topAttn = attnSorted[0] ?? null;

  // Approvals inbox — top 5 active items
  const approvalItems = attnSorted.slice(0, 5);

  // AI Workforce departments
  const depts = groupByDept(agentsQ.data ?? []);

  // Learning items from heartbeat priorities
  const learnings = (prioritiesQ.data ?? []).slice(0, 3);

  // System health
  const health = healthQ.data;
  const hasSystemIssues = (health?.failedActionsToday ?? 0) > 0 || (health?.openAlerts ?? 0) > 0;

  return (
    <div className="space-y-10 pb-12 pt-2" data-testid="home-page">
      {/* ─── Greeting ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-home-greeting">
          {greeting}, {firstName}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5" data-testid="text-home-date">
          {dateStr}
        </p>
      </div>

      {/* ─── Section A: Business Snapshot ─────────────────────────────────── */}
      <section aria-label="Business Snapshot">
        <SectionTitle icon={BarChart2} title="Business Snapshot" />
        {revQ.isLoading || leadQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <div
            className={`rounded-xl border p-5 ${snapshotClasses[snapshot.variant]}`}
            data-testid="card-business-snapshot"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <p className="text-sm leading-relaxed flex-1" data-testid="text-snapshot-body">
                {snapshot.lines.join(" ")}
              </p>
              <Badge
                variant={
                  snapshot.variant === "success"
                    ? "default"
                    : snapshot.variant === "warning"
                    ? "secondary"
                    : "destructive"
                }
                className="shrink-0 whitespace-nowrap"
                data-testid="badge-snapshot-status"
              >
                {snapshot.status}
              </Badge>
            </div>
          </div>
        )}
      </section>

      {/* ─── Section B: Business Health ────────────────────────────────────── */}
      <section aria-label="Business Health">
        <SectionTitle icon={TrendingUp} title="Business Health" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={DollarSign}
            label="Revenue"
            value={periodRev !== null ? formatDollars(periodRev) : "—"}
            sub={
              revGrowth !== 0
                ? `${revGrowth > 0 ? "+" : ""}${Math.round(revGrowth)}% vs last month`
                : "Stable vs last month"
            }
            trend={revTrend}
            isLoading={revQ.isLoading}
            testId="card-health-revenue"
          />
          <MetricCard
            icon={Users}
            label="Leads"
            value={totalLeads}
            sub={`${newLeads} new · ${convRate}% conversion`}
            trend={leadTrend}
            isLoading={leadQ.isLoading}
            testId="card-health-leads"
          />
          <MetricCard
            icon={Target}
            label="Utilization"
            value={utilPct !== null ? `${Math.round(utilPct)}%` : "—"}
            sub={
              utilPct === null
                ? "No data available"
                : utilPct >= 85
                ? "Approaching capacity"
                : utilPct >= 60
                ? "Healthy load"
                : "Room to grow"
            }
            trend={utilTrend}
            isLoading={utilQ.isLoading && isAdmin}
            testId="card-health-utilization"
          />
          <MetricCard
            icon={Shield}
            label="Retention"
            value={activeRet === 0 ? "Strong" : `${activeRet} at risk`}
            sub={
              activeRet === 0
                ? "No urgent risks"
                : `${activeRet} active workflow${activeRet > 1 ? "s" : ""}`
            }
            trend={retTrend}
            isLoading={retQ.isLoading && isAdmin}
            testId="card-health-retention"
          />
        </div>
      </section>

      {/* ─── Section C: Best Action Today ─────────────────────────────────── */}
      <section aria-label="Best Action Today">
        <SectionTitle icon={Zap} title="Best Action Today" />
        {recQ.isLoading ? (
          <Skeleton className="h-36 w-full rounded-xl" />
        ) : bestRec ? (
          <Card className="border-primary/25 bg-primary/[0.03]" data-testid="card-best-action">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base leading-snug" data-testid="text-best-action-title">
                    {bestRec.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed" data-testid="text-best-action-reason">
                    {bestRec.reason}
                  </p>
                  {bestRec.impact && (
                    <p className="text-xs font-medium text-primary mt-2" data-testid="text-best-action-impact">
                      Impact: {bestRec.impact}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() =>
                        setLocation(bestRec.actionUrl ?? "/admin/attention")
                      }
                      data-testid="button-best-action-primary"
                    >
                      {bestRec.actionLabel ?? "Review"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      data-testid="button-best-action-skip"
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : topAttn ? (
          <Card className="border-primary/25 bg-primary/[0.03]" data-testid="card-best-action">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base leading-snug" data-testid="text-best-action-title">
                    {topAttn.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed" data-testid="text-best-action-reason">
                    {topAttn.body}
                  </p>
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() => setLocation(topAttn.actionUrl || "/admin/attention")}
                      data-testid="button-best-action-primary"
                    >
                      {topAttn.actionLabel || "Review"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      data-testid="button-best-action-skip"
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="card-best-action-empty">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
                <div>
                  <p className="font-medium">Everything looks good today.</p>
                  <p className="text-sm text-muted-foreground">
                    No urgent actions required. Keep up the great work.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ─── Section D: AI Workforce Status (Admin only) ───────────────────── */}
      {isAdmin && (
        <section aria-label="AI Workforce Status">
          <SectionTitle
            icon={Bot}
            title="AI Workforce"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setLocation("/admin/workforce")}
                data-testid="link-view-workforce"
              >
                View All <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          {agentsQ.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : depts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {depts.map((dept) => (
                <Card
                  key={dept.name}
                  className="cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setLocation("/admin/workforce")}
                  data-testid={`card-dept-${dept.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-sm">{dept.name}</span>
                      <Badge
                        variant={
                          dept.status === "Active"
                            ? "default"
                            : dept.status === "Partial"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-xs"
                        data-testid={`badge-dept-${dept.name}`}
                      >
                        {dept.status}
                      </Badge>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <dt>Actions today</dt>
                        <dd
                          className="font-medium text-foreground"
                          data-testid={`text-dept-actions-${dept.name}`}
                        >
                          {dept.actionsToday}
                        </dd>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <dt>Pending approvals</dt>
                        <dd
                          className={`font-medium ${
                            dept.pendingApprovals > 0 ? "text-amber-500" : "text-foreground"
                          }`}
                          data-testid={`text-dept-approvals-${dept.name}`}
                        >
                          {dept.pendingApprovals}
                        </dd>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <dt>Active agents</dt>
                        <dd className="font-medium text-foreground">
                          {dept.active}/{dept.agentCount}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="pt-5 pb-5 text-center text-sm text-muted-foreground">
                No AI workforce data. Configure agents in the Engineering section.
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ─── Section E: Approvals Inbox ────────────────────────────────────── */}
      <section aria-label="Approvals Inbox">
        <SectionTitle
          icon={CheckCircle2}
          title="Approvals Inbox"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setLocation("/admin/attention")}
              data-testid="link-view-all-approvals"
            >
              View All <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          }
        />
        {attnQ.isLoading ? (
          <Card>
            <CardContent className="py-0 px-0">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : approvalItems.length > 0 ? (
          <Card data-testid="card-approvals-inbox">
            <CardContent className="py-0 px-0">
              <ul className="divide-y divide-border">
                {approvalItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3"
                    data-testid={`row-approval-${item.id}`}
                  >
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        item.level === "critical"
                          ? "bg-red-500"
                          : item.level === "important"
                          ? "bg-amber-500"
                          : "bg-blue-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        data-testid={`text-approval-title-${item.id}`}
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{item.body}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs h-7 px-2.5"
                      onClick={() => setLocation(item.actionUrl || "/admin/attention")}
                      data-testid={`button-approval-action-${item.id}`}
                    >
                      {item.actionLabel || "Review"}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="px-4 py-2.5 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setLocation("/admin/attention")}
                  data-testid="button-view-all-approvals-footer"
                >
                  View All Approvals
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="card-approvals-empty">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Inbox is clear — no pending approvals.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ─── Section F: Organization Learning (Admin only) ─────────────────── */}
      {isAdmin && (
        <section aria-label="Organization Learning">
          <SectionTitle
            icon={Brain}
            title="Organization Learning"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setLocation("/admin/obsidian")}
                data-testid="link-view-learning-center"
              >
                View Learning Center <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          <Card data-testid="card-org-learning">
            <CardContent className="pt-5 pb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                This week the AI learned:
              </p>
              {prioritiesQ.isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <Skeleton className="h-4 w-4 shrink-0 mt-0.5" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : learnings.length > 0 ? (
                <ol className="space-y-3">
                  {learnings.map((item, idx) => (
                    <li
                      key={item.id ?? idx}
                      className="flex items-start gap-3"
                      data-testid={`text-learning-${idx}`}
                    >
                      <span className="text-primary font-bold text-xs pt-0.5 shrink-0">
                        0{idx + 1}
                      </span>
                      <p className="text-sm leading-snug">
                        {item.title ?? item.reason ?? item.summary ?? "New insight recorded."}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The AI is analyzing your business patterns. Check back after more activity to see
                  learnings and insights here.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ─── Section G: System Health (Admin only) ─────────────────────────── */}
      {isAdmin && (
        <section aria-label="System Health">
          <SectionTitle icon={Cpu} title="System Health" />
          {healthQ.isLoading ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : hasSystemIssues ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="card-system-health-issues">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Integrations
                  </p>
                  <p className="text-2xl font-bold" data-testid="text-integrations-count">
                    {health?.integrationsConnected ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Connected</p>
                </CardContent>
              </Card>
              <Card
                className={
                  (health?.openAlerts ?? 0) > 0
                    ? "border-amber-200 dark:border-amber-800"
                    : ""
                }
              >
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Open Issues
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      (health?.openAlerts ?? 0) > 0 ? "text-amber-500" : ""
                    }`}
                    data-testid="text-open-issues"
                  >
                    {health?.openAlerts ?? 0}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs mt-1"
                    onClick={() => setLocation("/admin/software-improvement")}
                    data-testid="link-view-open-issues"
                  >
                    View issues
                  </Button>
                </CardContent>
              </Card>
              <Card
                className={
                  (health?.failedActionsToday ?? 0) > 0
                    ? "border-red-200 dark:border-red-800"
                    : ""
                }
              >
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Agent Failures (24h)
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      (health?.failedActionsToday ?? 0) > 0 ? "text-red-500" : ""
                    }`}
                    data-testid="text-agent-failures"
                  >
                    {health?.failedActionsToday ?? 0}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs mt-1"
                    onClick={() => setLocation("/admin/email-audit")}
                    data-testid="link-view-agent-logs"
                  >
                    View logs
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card
              className="border-green-200 dark:border-green-800"
              data-testid="card-system-health-ok"
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">All systems operating normally</p>
                    <p className="text-xs text-muted-foreground">
                      {health?.activeAgents ?? 0} agents active ·{" "}
                      {health?.integrationsConnected ?? 0} integrations connected · Score:{" "}
                      {health?.healthScore ?? 100}/100
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
