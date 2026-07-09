import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { getOrgPreset } from "@/lib/org-presets";
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
  Clock,
  Activity,
  Bell,
  BookOpen,
  Wifi,
  WifiOff,
  History,
  Calendar,
  Mail,
  UserPlus,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

// ─── Safe helpers ─────────────────────────────────────────────────────────────

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return "Scheduled";
  const mins = Math.floor(ms / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function futureTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Not scheduled";
  const ms = new Date(dateStr).getTime() - Date.now();
  if (ms <= 0) return "Imminent";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function actionTypeLabel(type?: string): string {
  const map: Record<string, string> = {
    heartbeat: "Heartbeat run",
    send: "Email sent",
    draft: "Draft created",
    approve: "Approved",
    reject: "Rejected",
    learning: "Learning recorded",
    recommendation: "Recommendation",
    workflow: "Workflow executed",
    decision: "Decision captured",
    enrichment: "Contact enriched",
    lead_intake: "Lead intake",
    email_send: "Email sent",
    email_draft: "Draft created",
    followup: "Follow-up sent",
  };
  if (!type) return "Agent action";
  return map[type.toLowerCase()] ?? type.replace(/_/g, " ");
}

function actionStatusColor(status?: string): string {
  if (!status) return "text-muted-foreground";
  const s = status.toLowerCase();
  if (["completed", "success", "sent", "approved", "done"].includes(s))
    return "text-green-600 dark:text-green-400";
  if (["failed", "error", "rejected", "blocked"].includes(s)) return "text-red-500";
  if (["pending", "awaiting_approval", "proposed", "queued"].includes(s))
    return "text-amber-500";
  return "text-muted-foreground";
}

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
  confidence?: number;
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

interface HeartbeatRun {
  agentsCoordinated?: number;
  prioritiesGenerated?: number;
  errorsEncountered?: number;
  durationMs?: number;
  status?: string;
  startedAt?: string;
}

interface HeartbeatStatus {
  isRunning?: boolean;
  lastHeartbeatAt?: string | null;
  nextRunAt?: string | null;
  lastRun?: HeartbeatRun | null;
  recentRuns?: HeartbeatRun[];
}

interface HermesStats {
  lastRunAt?: string | null;
  lastInsightAt?: string | null;
  recommendations24h?: number;
  queuedForReview24h?: number;
  successRate?: number;
  confidenceAverage?: number;
}

interface ApprovalsMetrics {
  pending?: number;
  lowRisk?: number;
  autoEligible?: number;
  approvalRate?: number | null;
  totalReviewed?: number;
  approved?: number;
  rejected?: number;
  oldestPendingHours?: number | null;
}

interface MemoryCaptureSource {
  source: string;
  count: number;
  lastUpdated: string | null;
  icon: string;
}

interface MemoryCaptureStats {
  sources?: MemoryCaptureSource[];
}

interface AgentmailStatus {
  configured?: boolean;
  connected?: boolean;
  message?: string;
}

interface TimelineEntry {
  id: string;
  agentName?: string;
  actionType?: string;
  actionStatus?: string;
  summary?: string;
  notes?: string;
  createdAt?: string;
}

interface TimelineResponse {
  entries?: TimelineEntry[];
  total?: number;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

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

interface SnapshotLine {
  text: string;
  variant: "good" | "warn" | "bad" | "neutral";
}

interface SnapshotResult {
  lines: SnapshotLine[];
  status: string;
  variant: "success" | "warning" | "destructive" | "default";
}

function generateSnapshot(
  rev: RevSummary | undefined | null,
  leads: LeadStats | undefined | null,
  util: UtilizationData | undefined | null,
  retention: RetentionWorkflow[] | undefined | null
): SnapshotResult {
  const lines: SnapshotLine[] = [];
  let risks = 0;

  const growth = rev?.growthPct ?? rev?.growth ?? 0;
  if (growth > 5) {
    lines.push({ text: `Revenue up ${Math.round(growth)}% this month — strong performance.`, variant: "good" });
  } else if (growth < -5) {
    lines.push({ text: `Revenue down ${Math.round(Math.abs(growth))}% compared to last month.`, variant: "bad" });
    risks++;
  } else {
    lines.push({ text: "Revenue tracking normally this month.", variant: "neutral" });
  }

  const newLeads = leads?.new ?? 0;
  const totalLeads = leads?.total ?? 0;
  if (newLeads >= 5) {
    lines.push({ text: `Lead flow healthy — ${newLeads} new leads this week.`, variant: "good" });
  } else if (totalLeads === 0 && newLeads === 0) {
    lines.push({ text: "No active leads in the pipeline right now.", variant: "bad" });
    risks++;
  } else {
    lines.push({ text: "Lead flow steady.", variant: "neutral" });
  }

  const utilPct =
    util?.overallUtilization ?? util?.utilizationPct ?? util?.utilizationPercent ?? null;
  if (utilPct !== null) {
    if (utilPct >= 90) {
      lines.push({ text: `Capacity at ${Math.round(utilPct)}% — approaching maximum.`, variant: "warn" });
      risks++;
    } else if (utilPct >= 65) {
      lines.push({ text: `Capacity at ${Math.round(utilPct)}% — healthy load.`, variant: "good" });
    } else {
      lines.push({ text: `Capacity at ${Math.round(utilPct)}% with room to grow.`, variant: "neutral" });
    }
  }

  const critical = (retention ?? []).filter(
    (r) => (r.severity === "high" || r.severity === "critical") && r.status !== "resolved"
  ).length;
  const activeRet = (retention ?? []).filter(
    (r) => r.status !== "resolved" && r.status !== "closed"
  ).length;
  if (critical > 0) {
    lines.push({ text: `${critical} athlete${critical > 1 ? "s" : ""} flagged as high retention risk.`, variant: "bad" });
    risks++;
  } else if (activeRet > 0) {
    lines.push({ text: `${activeRet} retention workflow${activeRet > 1 ? "s" : ""} active and being managed.`, variant: "warn" });
  } else {
    lines.push({ text: "Retention stable — no urgent risks detected.", variant: "good" });
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
        <div className="h-5 w-5 rounded flex items-center justify-center bg-primary/10">
          <Icon className="h-3 w-3 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground tracking-tight">
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
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  trend?: Trend;
  isLoading?: boolean;
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      data-testid={testId}
      className={`transition-all duration-150 ${onClick ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""}`}
      onClick={onClick}
    >
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
            <p
              className="text-2xl font-bold leading-none tracking-tight"
              data-testid={testId ? `${testId}-value` : undefined}
            >
              {value}
            </p>
            {sub && (
              <p
                className="text-xs text-muted-foreground mt-1.5"
                data-testid={testId ? `${testId}-sub` : undefined}
              >
                {sub}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type SubsystemStatus = "operational" | "degraded" | "attention" | "unknown";

function StatusDot({ status }: { status: SubsystemStatus }) {
  const cls =
    status === "operational"
      ? "bg-green-500"
      : status === "degraded"
      ? "bg-amber-500"
      : status === "attention"
      ? "bg-red-500"
      : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${cls}`} />;
}

function subsystemLabel(s: SubsystemStatus): string {
  return s === "operational"
    ? "Operational"
    : s === "degraded"
    ? "Degraded"
    : s === "attention"
    ? "Attention Required"
    : "Unknown";
}

function subsystemTextColor(s: SubsystemStatus): string {
  return s === "operational"
    ? "text-green-600 dark:text-green-400"
    : s === "degraded"
    ? "text-amber-600 dark:text-amber-400"
    : s === "attention"
    ? "text-red-500"
    : "text-muted-foreground";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const perms = usePermissions();

  const isAdmin = perms.canManageAI;
  const isCoach = perms.canViewRevenue;

  // Track which recommendation index is shown (for Skip)
  const [recIndex, setRecIndex] = useState(0);

  // Profile + org
  const { data: profile } = useQuery<{ organizationId?: string }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;
  const { data: orgData } = useQuery<{ organizationType?: string | null }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });
  const preset = getOrgPreset(orgData?.organizationType);

  // ── All queries (fire in parallel) ────────────────────────────────────────
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

  // Admin-only queries
  const heartbeatStatusQ = useQuery<HeartbeatStatus>({
    queryKey: ["/api/admin/ceo-heartbeat/status"],
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const timelineQ = useQuery<TimelineResponse>({
    queryKey: ["/api/admin/ceo-heartbeat/timeline?limit=10"],
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const hermesStatsQ = useQuery<HermesStats>({
    queryKey: ["/api/hermes/stats"],
    enabled: isAdmin,
    staleTime: 120_000,
  });
  const approvalsMetricsQ = useQuery<ApprovalsMetrics>({
    queryKey: ["/api/ai-approvals/metrics"],
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const memoryCaptureQ = useQuery<MemoryCaptureStats>({
    queryKey: ["/api/organizational-memory/auto-capture-stats"],
    enabled: isAdmin,
    staleTime: 300_000,
  });
  const agentmailStatusQ = useQuery<AgentmailStatus>({
    queryKey: ["/api/agentmail/status"],
    enabled: isAdmin,
    staleTime: 120_000,
  });

  // ─── Loading skeleton ───────────────────────────────────────────────────────
  if (perms.isHydrating) {
    return (
      <div className="space-y-8 pb-12 pt-2" data-testid="home-loading">
        <div className="space-y-1">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-36 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  // ─── Derived data ──────────────────────────────────────────────────────────

  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "Coach";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Snapshot
  const snapshot = generateSnapshot(revQ.data, leadQ.data, utilQ.data, retQ.data);

  // Revenue
  const revData = revQ.data;
  const periodRev = revData?.periodRevenueCents ?? revData?.thisMonth ?? revData?.total ?? null;
  const revGrowth = revData?.growthPct ?? revData?.growth ?? 0;
  const revTrend: Trend = revGrowth > 3 ? "up" : revGrowth < -3 ? "down" : "flat";

  // Leads
  const totalLeads = leadQ.data?.total ?? 0;
  const newLeads = leadQ.data?.new ?? 0;
  const convertedLeads = leadQ.data?.converted ?? 0;
  const convRate =
    leadQ.data?.conversionRate ??
    (totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0);
  const leadTrend: Trend =
    newLeads >= 5 ? "up" : newLeads === 0 && totalLeads === 0 ? "down" : "flat";

  // Utilization
  const utilPct =
    utilQ.data?.overallUtilization ??
    utilQ.data?.utilizationPct ??
    utilQ.data?.utilizationPercent ??
    null;
  const utilTrend: Trend =
    utilPct === null ? "flat" : utilPct > 85 ? "up" : utilPct < 40 ? "down" : "flat";

  // Retention
  const activeRet = asArray<RetentionWorkflow>(retQ.data).filter(
    (r) => r.status !== "resolved" && r.status !== "closed"
  ).length;
  const retTrend: Trend = activeRet === 0 ? "flat" : activeRet <= 2 ? "flat" : "down";

  // Recommendations — rotatable via Skip
  const recArr = asArray<Recommendation>(recQ.data);
  const highRecs = recArr.filter((r) => r.priority === "high");
  const orderedRecs = [...highRecs, ...recArr.filter((r) => r.priority !== "high")];
  const currentRecIndex = recIndex % Math.max(orderedRecs.length, 1);
  const bestRec = orderedRecs[currentRecIndex] ?? null;

  // Attention items
  const attnSorted = asArray<AttentionItem>(attnQ.data)
    .filter((a) => a.status === "active")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topAttn = attnSorted[0] ?? null;

  // Attention level counts
  const attnCritical = attnSorted.filter((a) => a.level === "critical").length;
  const attnHigh = attnSorted.filter(
    (a) => a.level === "high" || a.level === "important"
  ).length;
  const attnMedium = attnSorted.filter(
    (a) => a.level === "medium" || a.level === "moderate"
  ).length;
  const attnLow = attnSorted.filter(
    (a) => a.level === "low" || a.level === "info"
  ).length;

  const topAttnItems = attnSorted.slice(0, 5);

  // Best action fallback to top attention item
  const showRecCard = !recQ.isLoading && (bestRec || topAttn);
  const cardTitle = bestRec ? bestRec.title : topAttn?.title ?? "";
  const cardReason = bestRec ? bestRec.reason : topAttn?.body ?? "";
  const cardImpact = bestRec?.impact;
  const cardConfidence = bestRec?.confidence;
  const cardActionLabel = bestRec ? (bestRec.actionLabel ?? "Review") : (topAttn?.actionLabel ?? "Review");
  const cardActionUrl = bestRec ? (bestRec.actionUrl ?? "/admin/attention") : (topAttn?.actionUrl ?? "/admin/attention");

  // AI Workforce
  const depts = groupByDept(asArray<WorkforceAgent>(agentsQ.data));
  const health = healthQ.data;

  // Heartbeat
  const hbStatus = heartbeatStatusQ.data;
  const hbLastRun = hbStatus?.lastRun;

  // Priorities
  const prioritiesRaw = prioritiesQ.data as unknown;
  const prioritiesArr: HeartbeatPriority[] = Array.isArray(prioritiesRaw)
    ? prioritiesRaw
    : Array.isArray((prioritiesRaw as any)?.priorities)
    ? (prioritiesRaw as any).priorities
    : [];

  // Memory capture sources
  const memorySources = memoryCaptureQ.data?.sources ?? [];
  const memHermes = memorySources.find((s) => s.source === "Hermes Learnings");
  const memDecisions = memorySources.find((s) => s.source === "Decision Journal");
  const memSoftwareKb = memorySources.find((s) => s.source === "Software KB");
  const memHeartbeat = memorySources.find((s) => s.source === "CEO Heartbeat Reports");

  // Timeline
  const timelineEntries = asArray<TimelineEntry>(timelineQ.data?.entries);

  // System health subsystem statuses
  function hermesStatus(): SubsystemStatus {
    const stats = hermesStatsQ.data;
    if (!stats) return "unknown";
    if ((stats.recommendations24h ?? 0) > 0 || stats.lastRunAt) return "operational";
    return "degraded";
  }

  function agentmailStatus(): SubsystemStatus {
    const s = agentmailStatusQ.data;
    if (!s) return "unknown";
    if (s.connected) return "operational";
    if (s.configured) return "degraded";
    return "unknown";
  }

  function heartbeatStatus(): SubsystemStatus {
    const s = heartbeatStatusQ.data;
    if (!s) return "unknown";
    if (!s.lastHeartbeatAt && !hbLastRun) return "unknown";
    if ((hbLastRun?.errorsEncountered ?? 0) > 0) return "degraded";
    return "operational";
  }

  function databaseStatus(): SubsystemStatus {
    if (memoryCaptureQ.data || heartbeatStatusQ.data || healthQ.data) return "operational";
    return "unknown";
  }

  function integrationsStatus(): SubsystemStatus {
    const count = health?.integrationsConnected ?? 0;
    if (!healthQ.data) return "unknown";
    if (count > 0) return "operational";
    return "degraded";
  }

  const subsystems: Array<{ name: string; status: SubsystemStatus; detail: string }> = [
    {
      name: "Hermes Learning Engine",
      status: hermesStatus(),
      detail: hermesStatsQ.data
        ? hermesStatsQ.data.lastRunAt
          ? `${hermesStatsQ.data.recommendations24h ?? 0} insights (24h) · last active ${relativeTime(hermesStatsQ.data.lastRunAt)}`
          : `${hermesStatsQ.data.recommendations24h ?? 0} insights (24h) · never run`
        : "No data",
    },
    {
      name: "AgentMail",
      status: agentmailStatus(),
      detail: agentmailStatusQ.data?.connected
        ? "Connected and routing"
        : agentmailStatusQ.data?.configured
        ? "Configured · connection failed"
        : "Not configured",
    },
    {
      name: "CEO Heartbeat",
      status: heartbeatStatus(),
      detail: hbLastRun
        ? `Last run ${relativeTime(hbLastRun.startedAt ?? hbStatus?.lastHeartbeatAt)} · ${hbLastRun.agentsCoordinated ?? 0} agents`
        : hbStatus?.lastHeartbeatAt
        ? `Last active ${relativeTime(hbStatus.lastHeartbeatAt)}`
        : "No runs recorded",
    },
    {
      name: "Database",
      status: databaseStatus(),
      detail: databaseStatus() === "operational" ? "Queries returning data" : "Status unknown",
    },
    {
      name: "Integrations",
      status: integrationsStatus(),
      detail: healthQ.data
        ? `${health?.integrationsConnected ?? 0} connected`
        : "Loading…",
    },
  ];

  const allOperational = subsystems.every((s) => s.status === "operational");
  const hasAttention = subsystems.some((s) => s.status === "attention");
  const hasDegraded = subsystems.some((s) => s.status === "degraded");

  // ─── Greeting area org health badge ────────────────────────────────────────
  const orgHealthBadge =
    attnCritical > 0 ? (
      <Badge variant="destructive" className="text-xs" data-testid="badge-org-health">
        {attnCritical} Critical
      </Badge>
    ) : snapshot.variant === "warning" ? (
      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" data-testid="badge-org-health">
        {snapshot.status}
      </Badge>
    ) : snapshot.variant === "success" ? (
      <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-400" data-testid="badge-org-health">
        {snapshot.status}
      </Badge>
    ) : null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 pb-12 pt-2" data-testid="home-page">

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-home-greeting">
            {greeting}, {firstName}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5" data-testid="text-home-date">
            {dateStr}
          </p>
        </div>
        {(!revQ.isLoading && !leadQ.isLoading) && orgHealthBadge}
      </div>

      {/* ── 1. Best Action Today ─────────────────────────────────────────────── */}
      <section aria-label="Best Action Today">
        <SectionTitle icon={Zap} title="Best Action Today" />
        {recQ.isLoading ? (
          <Skeleton className="h-36 w-full rounded-xl" />
        ) : showRecCard ? (
          <Card
            className="border-primary/30 bg-gradient-to-br from-primary/[0.04] to-transparent"
            data-testid="card-best-action"
          >
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-semibold text-base leading-snug"
                    data-testid="text-best-action-title"
                  >
                    {cardTitle}
                  </p>
                  <p
                    className="text-sm text-muted-foreground mt-1.5 leading-relaxed"
                    data-testid="text-best-action-reason"
                  >
                    {cardReason}
                  </p>
                  {cardImpact && (
                    <p className="text-xs font-medium text-primary mt-2" data-testid="text-best-action-impact">
                      Expected impact: {cardImpact}
                    </p>
                  )}
                  {cardConfidence !== undefined && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Confidence: {cardConfidence}%
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() => setLocation(cardActionUrl)}
                      data-testid="button-best-action-primary"
                    >
                      {cardActionLabel}
                    </Button>
                    {orderedRecs.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setRecIndex((i) => i + 1)}
                        data-testid="button-best-action-skip"
                      >
                        Next recommendation
                      </Button>
                    )}
                    {orderedRecs.length > 1 && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {currentRecIndex + 1} of {orderedRecs.length}
                      </span>
                    )}
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
                  <p className="text-sm text-muted-foreground mt-0.5">
                    No urgent actions required. The recommendation engine will surface priorities as
                    new activity comes in.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── 2. Business Health ───────────────────────────────────────────────── */}
      <section aria-label="Business Health">
        <SectionTitle icon={TrendingUp} title="Business Health" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={DollarSign}
            label={preset.home.revenueLabel}
            value={periodRev !== null ? formatDollars(periodRev) : "—"}
            sub={
              revGrowth !== 0
                ? `${revGrowth > 0 ? "+" : ""}${Math.round(revGrowth)}% vs last month`
                : "Stable vs last month"
            }
            trend={revTrend}
            isLoading={revQ.isLoading}
            testId="card-health-revenue"
            onClick={isCoach ? () => setLocation("/admin/revenue") : undefined}
          />
          <MetricCard
            icon={Users}
            label={preset.home.leadsLabel}
            value={totalLeads}
            sub={`${newLeads} new · ${convRate}% conversion`}
            trend={leadTrend}
            isLoading={leadQ.isLoading}
            testId="card-health-leads"
            onClick={isCoach ? () => setLocation("/admin/team-training-leads") : undefined}
          />
          <MetricCard
            icon={Target}
            label={preset.home.utilizationLabel}
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
            onClick={isAdmin ? () => setLocation("/admin/coach-capacity") : undefined}
          />
          <MetricCard
            icon={Shield}
            label={preset.home.retentionLabel}
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

      {/* ── 3. Business Snapshot ─────────────────────────────────────────────── */}
      <section aria-label="Business Snapshot">
        <SectionTitle icon={BarChart2} title={preset.home.snapshotTitle} />
        {revQ.isLoading || leadQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <Card data-testid="card-business-snapshot">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <Badge
                  variant={
                    snapshot.variant === "success"
                      ? "default"
                      : snapshot.variant === "warning"
                      ? "secondary"
                      : "destructive"
                  }
                  className="shrink-0"
                  data-testid="badge-snapshot-status"
                >
                  {snapshot.status}
                </Badge>
              </div>
              <ul className="space-y-1.5" data-testid="text-snapshot-body">
                {snapshot.lines.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      line.variant === "good"
                        ? "bg-green-500"
                        : line.variant === "bad"
                        ? "bg-red-500"
                        : line.variant === "warn"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/40"
                    }`} />
                    <span className={
                      line.variant === "bad"
                        ? "text-foreground font-medium"
                        : line.variant === "warn"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }>{line.text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── 4. Attention Inbox Summary ───────────────────────────────────────── */}
      <section aria-label="Attention Inbox">
        <SectionTitle
          icon={Bell}
          title="Attention Inbox"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setLocation("/admin/attention")}
              data-testid="link-view-attention"
            >
              View All <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          }
        />

        {/* Level summary counts */}
        {attnQ.isLoading ? (
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 mb-4" data-testid="card-attention-summary">
            {[
              { label: "Critical", count: attnCritical, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
              { label: "High", count: attnHigh, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
              { label: "Medium", count: attnMedium, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" },
              { label: "Low", count: attnLow, color: "text-muted-foreground", bg: "bg-muted/40 border-border" },
            ].map((row) => (
              <button
                key={row.label}
                className={`rounded-lg border p-3 text-center transition-colors hover:opacity-80 ${
                  row.count > 0 ? row.bg : "bg-muted/20 border-border"
                }`}
                onClick={() => setLocation("/admin/attention")}
                data-testid={`stat-attn-${row.label.toLowerCase()}`}
              >
                <p className={`text-xl font-bold ${row.count > 0 ? row.color : "text-muted-foreground"}`}>
                  {row.count}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{row.label}</p>
              </button>
            ))}
          </div>
        )}

        {/* Item list */}
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
        ) : topAttnItems.length > 0 ? (
          <Card data-testid="card-attention-inbox">
            <CardContent className="py-0 px-0">
              <ul className="divide-y divide-border">
                {topAttnItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    data-testid={`row-attention-${item.id}`}
                  >
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        item.level === "critical"
                          ? "bg-red-500"
                          : item.level === "high" || item.level === "important"
                          ? "bg-amber-500"
                          : "bg-blue-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        data-testid={`text-attention-title-${item.id}`}
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
                      data-testid={`button-attention-action-${item.id}`}
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
                  data-testid="button-view-all-attention-footer"
                >
                  Open Attention Inbox
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="card-attention-empty">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Inbox is clear — no pending items. New attention signals will appear here
                  automatically as agents detect activity.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── 5. Quick Actions ─────────────────────────────────────────────────── */}
      <section aria-label="Quick Actions">
        <SectionTitle icon={ChevronRight} title="Quick Actions" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              icon: Calendar,
              label: "Schedule Session",
              url: "/admin/scheduling-command-center",
              testId: "button-quick-schedule",
            },
            {
              icon: UserPlus,
              label: "New Lead",
              url: "/admin/team-training-leads",
              testId: "button-quick-lead",
            },
            {
              icon: Mail,
              label: "Review Approvals",
              url: "/admin/ai-approvals",
              testId: "button-quick-approvals",
              badge: (approvalsMetricsQ.data?.pending ?? 0) > 0
                ? String(approvalsMetricsQ.data?.pending)
                : undefined,
            },
            {
              icon: BarChart2,
              label: "View Reports",
              url: "/admin/revenue",
              testId: "button-quick-reports",
            },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => setLocation(action.url)}
              data-testid={action.testId}
              className="relative flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:bg-primary/[0.02] transition-all duration-150 group"
            >
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                <action.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="text-sm font-medium">{action.label}</span>
              {action.badge && (
                <span className="absolute top-2 right-2 h-5 min-w-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center px-1">
                  {action.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── 6. AI Workforce Status (admin only) ──────────────────────────────── */}
      {isAdmin && (
        <section aria-label="AI Workforce Status">
          <SectionTitle
            icon={Bot}
            title="AI Workforce"
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setLocation("/admin/ai-approvals")}
                  data-testid="link-open-approvals"
                >
                  Approvals
                  {(approvalsMetricsQ.data?.pending ?? 0) > 0 && (
                    <span className="ml-1.5 h-4 min-w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                      {approvalsMetricsQ.data?.pending}
                    </span>
                  )}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setLocation("/admin/workforce")}
                  data-testid="link-view-workforce"
                >
                  Workforce <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            }
          />

          {/* Summary stat bar */}
          {healthQ.isLoading || heartbeatStatusQ.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <div
              className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4"
              data-testid="card-workforce-summary"
            >
              {[
                {
                  label: "Agents Active",
                  value: health?.activeAgents ?? "—",
                  sub: health?.disabledAgents ? `${health.disabledAgents} paused` : undefined,
                  testId: "stat-agents-active",
                },
                {
                  label: "Health Score",
                  value: health?.healthScore !== undefined ? `${health.healthScore}%` : "—",
                  sub:
                    health?.systemHealth === "healthy"
                      ? "All systems good"
                      : health?.systemHealth ?? undefined,
                  testId: "stat-health-score",
                },
                {
                  label: "Actions Today",
                  value: health?.actionsToday ?? 0,
                  sub:
                    (health?.failedActionsToday ?? 0) > 0
                      ? `${health?.failedActionsToday} failed`
                      : "No failures",
                  testId: "stat-actions-today",
                },
                {
                  label: "Pending Approvals",
                  value: approvalsMetricsQ.data?.pending ?? "—",
                  sub:
                    (approvalsMetricsQ.data?.oldestPendingHours ?? 0) > 0
                      ? `Oldest: ${approvalsMetricsQ.data?.oldestPendingHours}h`
                      : "All reviewed",
                  testId: "stat-pending-approvals",
                },
                {
                  label: "Last Heartbeat",
                  value: relativeTime(hbStatus?.lastHeartbeatAt),
                  sub:
                    hbStatus?.nextRunAt
                      ? `Next ${futureTime(hbStatus.nextRunAt)}`
                      : "Scheduled",
                  testId: "stat-last-heartbeat",
                },
              ].map((stat) => (
                <Card key={stat.label} data-testid={stat.testId}>
                  <CardContent className="pt-3 pb-3">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      {stat.label}
                    </p>
                    <p className="text-lg font-bold leading-none">{stat.value}</p>
                    {stat.sub && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{stat.sub}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Dept cards */}
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
                No AI workforce data yet. Enable agents in the AI Workforce section to start
                tracking activity here.
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── 7. CEO Heartbeat Summary (admin only) ────────────────────────────── */}
      {isAdmin && (
        <section aria-label="CEO Heartbeat Summary">
          <SectionTitle
            icon={History}
            title="CEO Heartbeat"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setLocation("/admin/ceo-heartbeat")}
                data-testid="link-view-heartbeat"
              >
                View Heartbeat <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          {heartbeatStatusQ.isLoading ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : (
            <Card data-testid="card-ceo-heartbeat-summary">
              <CardContent className="pt-5 pb-5">
                {hbStatus ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div data-testid="hb-last-run">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        Last Run
                      </p>
                      <p className="text-base font-semibold">
                        {relativeTime(hbStatus.lastHeartbeatAt ?? hbLastRun?.startedAt)}
                      </p>
                    </div>
                    <div data-testid="hb-agents-coordinated">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        Agents
                      </p>
                      <p className="text-base font-semibold">
                        {hbLastRun?.agentsCoordinated ?? "—"}
                      </p>
                    </div>
                    <div data-testid="hb-priorities">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        Priorities
                      </p>
                      <p className="text-base font-semibold">
                        {hbLastRun?.prioritiesGenerated ?? (prioritiesArr.length || "—")}
                      </p>
                    </div>
                    <div data-testid="hb-errors">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        Errors
                      </p>
                      <p
                        className={`text-base font-semibold ${
                          (hbLastRun?.errorsEncountered ?? 0) > 0
                            ? "text-red-500"
                            : "text-green-600 dark:text-green-400"
                        }`}
                      >
                        {hbLastRun?.errorsEncountered ?? 0}
                      </p>
                    </div>
                    <div data-testid="hb-next-run">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        Next Run
                      </p>
                      <p className="text-base font-semibold">
                        {hbStatus.nextRunAt ? futureTime(hbStatus.nextRunAt) : "Scheduled"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      No heartbeat data yet. The CEO Heartbeat will automatically coordinate your
                      AI agents on a schedule.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── 8. Agent Activity Feed (admin only) ──────────────────────────────── */}
      {isAdmin && (
        <section aria-label="Agent Activity Feed">
          <SectionTitle
            icon={Activity}
            title="Agent Activity Feed"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setLocation("/admin/ceo-heartbeat")}
                data-testid="link-view-full-timeline"
              >
                Full Timeline <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          {timelineQ.isLoading ? (
            <Card>
              <CardContent className="py-0 px-0">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
                  >
                    <Skeleton className="h-2 w-2 rounded-full" />
                    <Skeleton className="h-3.5 flex-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : timelineEntries.length > 0 ? (
            <Card data-testid="card-activity-feed">
              <CardContent className="py-0 px-0">
                <ul className="divide-y divide-border">
                  {timelineEntries.slice(0, 10).map((entry, idx) => (
                    <li
                      key={entry.id ?? idx}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      data-testid={`row-activity-${entry.id ?? idx}`}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {actionTypeLabel(entry.actionType)}
                          </span>
                          {entry.agentName && (
                            <span className="text-xs text-muted-foreground">
                              by {entry.agentName.replace(/_/g, " ")}
                            </span>
                          )}
                          {entry.actionStatus && (
                            <span
                              className={`text-xs font-medium ${actionStatusColor(entry.actionStatus)}`}
                              data-testid={`badge-activity-status-${idx}`}
                            >
                              {entry.actionStatus}
                            </span>
                          )}
                        </div>
                        {(entry.summary || entry.notes) && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {entry.summary ?? entry.notes}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {relativeTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="card-activity-feed-empty">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    No agent activity in the last 24 hours. Activity will appear here as agents
                    send emails, record learnings, and execute workflows.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── 9. Organizational Memory Summary (admin only) ────────────────────── */}
      {isAdmin && (
        <section aria-label="Organizational Memory">
          <SectionTitle
            icon={BookOpen}
            title="Organizational Memory"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setLocation("/admin/organizational-memory")}
                data-testid="link-open-memory"
              >
                Open Memory <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          {memoryCaptureQ.isLoading ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : (
            <Card data-testid="card-org-memory-summary">
              <CardContent className="pt-5 pb-5">
                {memorySources.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                      {[
                        {
                          label: "Hermes Learnings",
                          data: memHermes,
                          testId: "mem-hermes",
                        },
                        {
                          label: "Decisions Captured",
                          data: memDecisions,
                          testId: "mem-decisions",
                        },
                        {
                          label: "Software KB",
                          data: memSoftwareKb,
                          testId: "mem-software-kb",
                        },
                        {
                          label: "Heartbeat Reports",
                          data: memHeartbeat,
                          testId: "mem-heartbeat",
                        },
                      ].map((item) => (
                        <div key={item.label} data-testid={item.testId}>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                            {item.label}
                          </p>
                          <p className="text-2xl font-bold">{item.data?.count ?? 0}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.data?.lastUpdated
                              ? `Last: ${relativeTime(item.data.lastUpdated)}`
                              : "No entries yet"}
                          </p>
                        </div>
                      ))}
                    </div>
                    {hermesStatsQ.data?.lastInsightAt && (
                      <p className="text-xs text-muted-foreground border-t pt-3">
                        Last learning captured{" "}
                        <span className="font-medium text-foreground">
                          {relativeTime(hermesStatsQ.data.lastInsightAt)}
                        </span>
                        {hermesStatsQ.data.confidenceAverage
                          ? ` · Avg confidence ${hermesStatsQ.data.confidenceAverage}%`
                          : ""}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <Brain className="h-5 w-5 text-muted-foreground shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      The AI is building your organizational memory. Learnings, decisions, and
                      knowledge entries will appear here as your platform generates activity.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── 10. System Health (admin only) ────────────────────────────────────── */}
      {isAdmin && (
        <section aria-label="System Health">
          <SectionTitle icon={Cpu} title="System Health" />
          {healthQ.isLoading && heartbeatStatusQ.isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <Card
              className={
                hasAttention
                  ? "border-red-200 dark:border-red-800"
                  : hasDegraded
                  ? "border-amber-200 dark:border-amber-800"
                  : allOperational
                  ? "border-green-200 dark:border-green-800"
                  : ""
              }
              data-testid="card-system-health"
            >
              <CardContent className="pt-5 pb-5">
                {/* Overall status line */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b">
                  <div className="flex items-center gap-2">
                    {hasAttention ? (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    ) : hasDegraded ? (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                    <span className="text-sm font-semibold">
                      {hasAttention
                        ? "Attention Required"
                        : hasDegraded
                        ? "Some Systems Degraded"
                        : "All Systems Operational"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {subsystems.filter((s) => s.status === "operational").length}/
                    {subsystems.length} operational
                  </span>
                </div>

                {/* Subsystem rows */}
                <ul className="space-y-3" data-testid="list-subsystems">
                  {subsystems.map((sub) => (
                    <li
                      key={sub.name}
                      className="flex items-center gap-3"
                      data-testid={`row-subsystem-${sub.name.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <StatusDot status={sub.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{sub.name}</span>
                          <span
                            className={`text-xs font-medium shrink-0 ${subsystemTextColor(sub.status)}`}
                            data-testid={`text-subsystem-status-${sub.name}`}
                          >
                            {subsystemLabel(sub.status)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {sub.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* AgentMail not-configured CTA */}
                {agentmailStatusQ.data && !agentmailStatusQ.data.configured && (
                  <div className="mt-4 pt-3 border-t flex items-start gap-2">
                    <WifiOff className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      AgentMail is not configured. Add your{" "}
                      <span className="font-medium text-foreground">AGENTMAIL_API_KEY</span> to
                      Replit Secrets to enable AI email routing.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
