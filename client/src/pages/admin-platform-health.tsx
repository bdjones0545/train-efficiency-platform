import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Activity, Server, Zap, Shield, CreditCard, Eye,
  GitBranch, Bot, Target, BarChart3, RefreshCw, ChevronRight,
  CheckCircle, AlertTriangle, XCircle, Clock, Database, Wifi,
  TrendingUp, Lock, Search, Package, Layers, FileCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformHealth = { healthScore: number; status: string; apiSuccessRate: number; avgResponseTimeMs: number; activeOrgs: number; activeUsers: number; aiExecutionSuccessRate: number; workflowSuccessRate: number; databaseHealth: string; queueHealth: string; uptime: string; lastIncident: string; generatedAt: string };
type StatusData = { services: { name: string; status: string; latencyMs: number; uptime: string }[]; incidents: any[]; lastUpdated: string };
type MetricsData = { requestsPerMinute: number; errorsPerMinute: number; activeUsers: number; activeOrgs: number; aiExecPerMin: number; workflowRunsPerMin: number; revenueEventsPerMin: number; p50LatencyMs: number; p95LatencyMs: number; p99LatencyMs: number; generatedAt: string };
type EndpointsData = { endpoints: { group: string; method: string; path: string; successRate: number; avgMs: number; status: string; lastError: string | null; callsToday: number }[]; totalEndpoints: number; healthy: number; degraded: number; failed: number; generatedAt: string };
type ErrorsData = { errors: { id: string; type: string; severity: string; frequency: number; affectedOrgs: number; rootCause: string; recommendedFix: string; lastSeen: string }[]; totalErrors24h: number; criticalErrors: number; warningErrors: number; infoErrors: number; generatedAt: string };
type IsolationData = { isolationScore: number; orgsChecked: number; violationsFound: number; checks: { check: string; passed: boolean; severity: string; detail: string }[]; lastAuditAt: string; generatedAt: string };
type PermissionsData = { roles: { role: string; routesAudited: number; correct: number; excessive: number; missing: number; securityRisk: string }[]; warnings: { role: string; issue: string; severity: string; recommendation: string }[]; overallScore: number; generatedAt: string };
type BillingAuditData = { auditScore: number; features: { feature: string; requiredPlan: string; enforced: boolean; status: string; note?: string }[]; issues: { feature: string; severity: string; description: string; recommendation: string }[]; generatedAt: string };
type UxAuditData = { auditScore: number; pages: { page: string; issue: string | null; severity: string; status: string }[]; totalChecked: number; passing: number; warnings: number; critical: number; generatedAt: string };
type WorkflowHealthData = { workflows: { name: string; successRate: number; retryCount: number; failureCount: number; lastRun: string; status: string; recoveryStatus: string }[]; deadLetterCount: number; retryQueueSize: number; overallHealth: string; generatedAt: string };
type AiHealthData = { providers: { provider: string; latencyMs: number; successRate: number; fallbackActive: boolean; tokensUsed30d: number; status: string }[]; agentHealth: { agent: string; successRate: number; avgLatencyMs: number; executions30d: number }[]; fallbackCoverage: string; totalTokens30d: number; overallAiHealth: string; generatedAt: string };
type ReadinessData = { overallScore: number; overallStatus: string; categories: { category: string; score: number; status: string; findings: number }[]; blockingIssues: any[]; warnings: { area: string; warning: string }[]; generatedAt: string };
type ObservabilityData = { currentRps: number; errorsPerMin: number; activeUsers: number; activeOrgs: number; aiExecPerMin: number; workflowRunsPerMin: number; revenueEventsPerMin: number; timeline: { ts: string; rps: number; errors: number; aiExec: number }[]; generatedAt: string };
type RecoveryData = { recoveryScore: number; backupStatus: string; lastBackup: string; lastRestoreTest: string; restoreTestResult: string; recoveryReadiness: string; checks: { check: string; status: string; detail: string; lastRun: string | null }[]; rto: string; rpo: string; generatedAt: string };
type ReleaseData = { launchReadinessPct: number; readinessLevel: string; blockingIssues: number; totalChecks: number; passed: number; checklist: { category: string; item: string; passed: boolean; severity: string; note?: string }[]; recommendedActions: { action: string; priority: string; effort: string }[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const cfg: Record<string, string> = { operational: "bg-emerald-500", healthy: "bg-emerald-500", pass: "bg-emerald-500", healthy_: "bg-emerald-500", degraded: "bg-amber-500", warn: "bg-amber-500", warning: "bg-amber-500", failed: "bg-rose-500", critical: "bg-rose-500", error: "bg-rose-500" };
  const color = cfg[status.toLowerCase()] ?? "bg-blue-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color} shrink-0`} />;
}

function ScoreRing({ score, size = "lg" }: { score: number; size?: "sm" | "lg" }) {
  const color = score >= 95 ? "text-emerald-600 dark:text-emerald-400" : score >= 85 ? "text-blue-600 dark:text-blue-400" : score >= 70 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return size === "lg"
    ? <p className={`text-5xl font-extrabold ${color}`}>{score}<span className="text-lg">/100</span></p>
    : <p className={`text-2xl font-extrabold ${color}`}>{score}</p>;
}

function ProgressBar({ value, color = "bg-primary", height = "h-1.5" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function SeverityBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { blocking: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", info: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", none: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[s.toLowerCase()] ?? "bg-muted text-muted-foreground"}`}>{s}</Badge>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",     label: "Overview",       icon: Activity },
  { id: "endpoints",    label: "Endpoints",      icon: Server },
  { id: "errors",       label: "Errors",         icon: AlertTriangle },
  { id: "isolation",    label: "Isolation",      icon: Shield },
  { id: "permissions",  label: "Permissions",    icon: Lock },
  { id: "billing",      label: "Billing Audit",  icon: CreditCard },
  { id: "ux",           label: "UX Audit",       icon: Eye },
  { id: "workflows",    label: "Workflows",      icon: GitBranch },
  { id: "ai",           label: "AI Health",      icon: Bot },
  { id: "readiness",    label: "Readiness",      icon: Target },
  { id: "observability",label: "Observability",  icon: BarChart3 },
  { id: "recovery",     label: "Recovery",       icon: Database },
  { id: "release",      label: "Release Audit",  icon: FileCheck },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ lastRefresh }: { lastRefresh: number }) {
  const { data: health, isLoading: h1 } = useQuery<PlatformHealth>({ queryKey: ["/api/platform/health"], staleTime: 30_000 });
  const { data: status } = useQuery<StatusData>({ queryKey: ["/api/platform/status"], staleTime: 30_000 });
  const { data: metrics } = useQuery<MetricsData>({ queryKey: ["/api/platform/metrics"], staleTime: 30_000 });

  if (h1) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;

  const statusColor = health?.status === "Excellent" ? "text-emerald-600 dark:text-emerald-400" : health?.status === "Healthy" ? "text-blue-600 dark:text-blue-400" : health?.status === "Warning" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const statusBg = health?.status === "Excellent" ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-900" : health?.status === "Healthy" ? "bg-blue-500/5 border-blue-200 dark:border-blue-900" : "bg-amber-500/5 border-amber-200 dark:border-amber-900";

  return (
    <div className="space-y-4" data-testid="tab-platform-overview">
      {/* Health score hero */}
      <div className={`flex items-start gap-4 p-5 rounded-xl border ${statusBg}`}>
        <div className="text-center shrink-0">
          <ScoreRing score={health?.healthScore ?? 0} />
          <p className="text-[9px] text-muted-foreground mt-0.5">Health Score</p>
          <p className={`text-[10px] font-bold mt-0.5 ${statusColor}`}>{health?.status}</p>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "API Success",    value: `${health?.apiSuccessRate}%`,       color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Avg Latency",    value: `${health?.avgResponseTimeMs}ms`,   color: "text-blue-600 dark:text-blue-400" },
            { label: "Uptime",         value: health?.uptime ?? "—",              color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Active Orgs",    value: `${health?.activeOrgs?.toLocaleString()}`, color: "text-muted-foreground" },
            { label: "AI Success",     value: `${health?.aiExecutionSuccessRate}%`, color: "text-violet-600 dark:text-violet-400" },
            { label: "Workflow OK",    value: `${health?.workflowSuccessRate}%`,  color: "text-primary" },
            { label: "DB Health",      value: health?.databaseHealth ?? "—",      color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Last Incident",  value: health?.lastIncident ?? "—",        color: "text-muted-foreground" },
          ].map(m => (
            <div key={m.label} className="p-2 rounded-lg bg-background border">
              <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Service status grid */}
      <div className="rounded-xl border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold flex-1">Service Status</h3>
          <span className="text-[9px] text-muted-foreground">Auto-refresh every 30s</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y">
          {(status?.services ?? []).map(svc => (
            <div key={svc.name} className="flex items-center gap-2 p-3" data-testid={`service-${svc.name.toLowerCase().replace(/\s+/g, "-")}`}>
              <StatusDot status={svc.status} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{svc.name}</p>
                <p className="text-[9px] text-muted-foreground">{svc.latencyMs}ms · {svc.uptime}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time metrics */}
      {metrics && (
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
          {[
            { label: "Req/min",      value: metrics.requestsPerMinute },
            { label: "Err/min",      value: metrics.errorsPerMinute, warn: metrics.errorsPerMinute > 1 },
            { label: "Active Users", value: metrics.activeUsers },
            { label: "P50",          value: `${metrics.p50LatencyMs}ms` },
            { label: "P95",          value: `${metrics.p95LatencyMs}ms` },
            { label: "P99",          value: `${metrics.p99LatencyMs}ms`, warn: metrics.p99LatencyMs > 300 },
            { label: "AI Exec/min",  value: metrics.aiExecPerMin },
          ].map(m => (
            <div key={m.label} className={`p-2 rounded-lg border text-center ${(m as any).warn ? "border-amber-200 dark:border-amber-900 bg-amber-500/5" : "bg-card"}`} data-testid={`metric-${m.label.toLowerCase().replace(/\//g, "-").replace(/\s+/g, "-")}`}>
              <p className={`text-xs font-bold ${(m as any).warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{m.value}</p>
              <p className="text-[8px] text-muted-foreground leading-tight">{m.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Endpoints ────────────────────────────────────────────────────────────

function EndpointsTab() {
  const { data, isLoading } = useQuery<EndpointsData>({ queryKey: ["/api/platform/endpoints"], staleTime: 60_000 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = (data?.endpoints ?? []).filter(e =>
    (statusFilter === "all" || e.status === statusFilter) &&
    (e.path.toLowerCase().includes(search.toLowerCase()) || e.group.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4" data-testid="tab-endpoints">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search endpoints..." className="w-full h-8 pl-8 pr-3 rounded-lg border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-endpoint-search" />
        </div>
        {["all", "healthy", "degraded", "failed"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-${s}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s}{s !== "all" && data ? ` (${s === "healthy" ? data.healthy : s === "degraded" ? data.degraded : data.failed})` : ""}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
            <span className="col-span-1">Status</span>
            <span className="col-span-2">Method</span>
            <span className="col-span-4">Path</span>
            <span className="col-span-2 text-right">Success</span>
            <span className="col-span-2 text-right">Avg ms</span>
            <span className="col-span-1 text-right">Calls</span>
          </div>
          <div className="divide-y max-h-[500px] overflow-y-auto">
            {filtered.map((e, i) => (
              <div key={i} className="grid grid-cols-12 items-center px-4 py-2.5 hover:bg-muted/10 transition-colors" data-testid={`endpoint-${i}`}>
                <span className="col-span-1"><StatusDot status={e.status} /></span>
                <span className={`col-span-2 text-[10px] font-mono font-bold ${e.method === "GET" ? "text-emerald-600 dark:text-emerald-400" : e.method === "POST" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>{e.method}</span>
                <span className="col-span-4 text-[10px] font-mono text-muted-foreground truncate">{e.path}</span>
                <span className={`col-span-2 text-[10px] font-bold text-right ${e.successRate >= 99 ? "text-emerald-600 dark:text-emerald-400" : e.successRate >= 95 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{e.successRate}%</span>
                <span className={`col-span-2 text-[10px] text-right ${e.avgMs > 2000 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{e.avgMs.toLocaleString()}ms</span>
                <span className="col-span-1 text-[10px] text-right text-muted-foreground">{e.callsToday}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Errors ──────────────────────────────────────────────────────────────

function ErrorsTab() {
  const { data, isLoading } = useQuery<ErrorsData>({ queryKey: ["/api/platform/errors"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-errors">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total (24h)",   value: data.totalErrors24h,  color: "text-foreground" },
            { label: "Critical",      value: data.criticalErrors,  color: data.criticalErrors > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Warnings",      value: data.warningErrors,   color: data.warningErrors > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Info",          value: data.infoErrors,      color: "text-muted-foreground" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`error-count-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.errors ?? []).map(err => (
            <div key={err.id} className="p-4 rounded-xl border bg-card" data-testid={`error-${err.id}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${err.severity === "critical" ? "text-rose-500" : err.severity === "warning" ? "text-amber-500" : "text-muted-foreground"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-semibold">{err.type}</p>
                    <SeverityBadge s={err.severity} />
                    <span className="text-[9px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(err.lastSeen), { addSuffix: true })}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1"><span className="font-medium">Root cause: </span>{err.rootCause}</p>
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5">
                    <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px]"><span className="font-semibold text-primary">Fix: </span>{err.recommendedFix}</p>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
                    <span>{err.frequency}× in 24h</span>
                    <span>{err.affectedOrgs} org{err.affectedOrgs !== 1 ? "s" : ""} affected</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(data?.errors ?? []).length === 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
              <p className="text-sm font-medium">No errors in the last 24 hours</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Isolation ────────────────────────────────────────────────────────────

function IsolationTab() {
  const { data, isLoading } = useQuery<IsolationData>({ queryKey: ["/api/platform/isolation-audit"], staleTime: 10 * 60_000 });
  const scoreColor = (data?.isolationScore ?? 0) >= 95 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-isolation">
      <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
        <div className="text-center shrink-0">
          <ScoreRing score={data?.isolationScore ?? 0} />
          <p className="text-[9px] text-muted-foreground mt-0.5">Isolation Score</p>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-3">
          {[
            { label: "Orgs Checked",      value: data?.orgsChecked?.toLocaleString() ?? "—",  color: "text-primary" },
            { label: "Violations Found",  value: data?.violationsFound?.toString() ?? "0",     color: (data?.violationsFound ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Last Audit",        value: data?.lastAuditAt ? "Just now" : "—",          color: "text-muted-foreground" },
          ].map(m => (
            <div key={m.label} className="p-2.5 rounded-lg bg-background border text-center">
              <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Isolation Checks</h3></div>
          <div className="divide-y">
            {(data?.checks ?? []).map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3" data-testid={`isolation-check-${i}`}>
                {c.passed ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-medium">{c.check}</p>
                    <SeverityBadge s={c.severity} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Permissions ─────────────────────────────────────────────────────────

function PermissionsTab() {
  const { data, isLoading } = useQuery<PermissionsData>({ queryKey: ["/api/platform/permissions"], staleTime: 10 * 60_000 });
  const RISK_COLORS: Record<string, string> = { none: "text-emerald-600 dark:text-emerald-400", low: "text-amber-600 dark:text-amber-400", medium: "text-orange-600 dark:text-orange-400", high: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-permissions">
      {!isLoading && data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5">
          <Lock className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs">RBAC overall score: <span className="font-bold text-primary">{data.overallScore}/100</span> — {data.warnings.length} warning{data.warnings.length !== 1 ? "s" : ""} found</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Role Audit</h3></div>
            <div className="divide-y">
              {(data?.roles ?? []).map(role => (
                <div key={role.role} className="flex items-center gap-3 px-4 py-3" data-testid={`role-${role.role.toLowerCase()}`}>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 w-20 justify-center ${RISK_COLORS[role.securityRisk]}`}>{role.role}</Badge>
                  <div className="flex-1 grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: "Audited", value: role.routesAudited },
                      { label: "Correct", value: role.correct, color: "text-emerald-600 dark:text-emerald-400" },
                      { label: "Missing", value: role.missing, color: role.missing > 0 ? "text-amber-600 dark:text-amber-400" : "" },
                      { label: "Excessive", value: role.excessive, color: role.excessive > 0 ? "text-rose-600 dark:text-rose-400" : "" },
                    ].map(col => (
                      <div key={col.label}>
                        <p className={`text-xs font-bold ${(col as any).color ?? ""}`}>{col.value}</p>
                        <p className="text-[8px] text-muted-foreground">{col.label}</p>
                      </div>
                    ))}
                  </div>
                  <span className={`text-[9px] font-medium capitalize w-12 text-right ${RISK_COLORS[role.securityRisk]}`}>{role.securityRisk}</span>
                </div>
              ))}
            </div>
          </div>

          {(data?.warnings ?? []).length > 0 && (
            <div className="space-y-2">
              {data!.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900" data-testid={`permission-warning-${i}`}>
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium mb-0.5">{w.role}: {w.issue}</p>
                    <p className="text-[10px] text-muted-foreground">{w.recommendation}</p>
                  </div>
                  <SeverityBadge s={w.severity} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Billing Audit ───────────────────────────────────────────────────────

function BillingAuditTab() {
  const { data, isLoading } = useQuery<BillingAuditData>({ queryKey: ["/api/platform/billing-audit"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-billing-audit">
      {!isLoading && data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5">
          <CreditCard className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs">Billing enforcement score: <span className="font-bold text-primary">{data.auditScore}/100</span> — {data.issues.length} issue{data.issues.length !== 1 ? "s" : ""} found</p>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <>
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Feature Entitlement Enforcement</h3></div>
            <div className="divide-y">
              {(data?.features ?? []).map(f => (
                <div key={f.feature} className="flex items-center gap-3 px-4 py-3" data-testid={`billing-feature-${f.feature.toLowerCase().replace(/\s+/g, "-")}`}>
                  {f.enforced ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                  <div className="flex-1">
                    <p className="text-xs font-medium">{f.feature}</p>
                    {f.note && <p className="text-[9px] text-muted-foreground">{f.note}</p>}
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 capitalize mr-2">{f.requiredPlan}</Badge>
                  <Badge className={`text-[9px] px-1.5 py-0 h-4 capitalize ${f.status === "correct" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>{f.status}</Badge>
                </div>
              ))}
            </div>
          </div>

          {(data?.issues ?? []).length > 0 && (
            <div className="space-y-2">
              {data!.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900" data-testid={`billing-issue-${i}`}>
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs font-medium">{issue.feature}</p>
                      <SeverityBadge s={issue.severity} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-1">{issue.description}</p>
                    <p className="text-[10px] text-primary">{issue.recommendation}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: UX Audit ────────────────────────────────────────────────────────────

function UxAuditTab() {
  const { data, isLoading } = useQuery<UxAuditData>({ queryKey: ["/api/platform/ux-audit"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-ux">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Audit Score",  value: `${data.auditScore}/100`, color: data.auditScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
            { label: "Pages Checked",value: data.totalChecked,         color: "text-primary" },
            { label: "Passing",      value: data.passing,              color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Warnings",     value: data.warnings,             color: data.warnings > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`ux-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Page Audit Results</h3></div>
          <div className="divide-y">
            {(data?.pages ?? []).map((p, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3" data-testid={`ux-page-${i}`}>
                {p.status === "pass" ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-[10px] font-mono text-muted-foreground">{p.page}</p>
                  {p.issue && <p className="text-xs mt-0.5">{p.issue}</p>}
                </div>
                <SeverityBadge s={p.severity} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Workflow Health ─────────────────────────────────────────────────────

function WorkflowsTab() {
  const { data, isLoading } = useQuery<WorkflowHealthData>({ queryKey: ["/api/platform/workflow-health"], staleTime: 30_000 });

  return (
    <div className="space-y-4" data-testid="tab-workflows">
      {data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-emerald-500/5 border-emerald-200 dark:border-emerald-900">
          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
          <p className="text-xs">Overall workflow health: <span className="font-bold text-emerald-600 dark:text-emerald-400">{data.overallHealth}</span> · Dead-letter queue: <span className="font-bold">{data.deadLetterCount}</span> items</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
            <span className="col-span-1">St.</span>
            <span className="col-span-4">Workflow</span>
            <span className="col-span-2 text-right">Success</span>
            <span className="col-span-2 text-right">Retries</span>
            <span className="col-span-3 text-right">Last Run</span>
          </div>
          <div className="divide-y">
            {(data?.workflows ?? []).map((wf, i) => (
              <div key={i} className="grid grid-cols-12 items-center px-4 py-3" data-testid={`workflow-${i}`}>
                <span className="col-span-1"><StatusDot status={wf.status} /></span>
                <span className="col-span-4 text-xs font-medium">{wf.name}</span>
                <span className={`col-span-2 text-xs font-bold text-right ${wf.successRate >= 99 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{wf.successRate}%</span>
                <span className={`col-span-2 text-xs text-right ${wf.retryCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{wf.retryCount}</span>
                <span className="col-span-3 text-[10px] text-muted-foreground text-right">{formatDistanceToNow(new Date(wf.lastRun), { addSuffix: true })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: AI Health ───────────────────────────────────────────────────────────

function AIHealthTab() {
  const { data, isLoading } = useQuery<AiHealthData>({ queryKey: ["/api/platform/ai-health"], staleTime: 30_000 });

  return (
    <div className="space-y-4" data-testid="tab-ai-health">
      {data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs">Overall AI health: <span className="font-bold text-primary">{data.overallAiHealth}</span> · Fallback coverage: <span className="font-bold text-emerald-600 dark:text-emerald-400">{data.fallbackCoverage}</span> · Tokens (30d): <span className="font-bold">{data.totalTokens30d.toLocaleString()}</span></p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">AI Providers</h3></div>
            <div className="divide-y">
              {(data?.providers ?? []).map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`ai-provider-${i}`}>
                  <StatusDot status={p.status} />
                  <div className="flex-1">
                    <p className="text-xs font-medium">{p.provider}</p>
                    <p className="text-[9px] text-muted-foreground">{p.tokensUsed30d.toLocaleString()} tokens / 30d</p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-xs font-bold">{p.latencyMs.toLocaleString()}ms</p>
                      <p className="text-[8px] text-muted-foreground">Latency</p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${p.successRate >= 99 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{p.successRate}%</p>
                      <p className="text-[8px] text-muted-foreground">Success</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Agent Health</h3></div>
            <div className="divide-y">
              {(data?.agentHealth ?? []).map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`agent-health-${i}`}>
                  <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs flex-1">{a.agent}</span>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">{a.executions30d}</p>
                      <p className="text-[8px] text-muted-foreground">Runs</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">{a.avgLatencyMs.toLocaleString()}ms</p>
                      <p className="text-[8px] text-muted-foreground">Avg</p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${a.successRate >= 99 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{a.successRate}%</p>
                      <p className="text-[8px] text-muted-foreground">OK</p>
                    </div>
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

// ─── Tab: Readiness ────────────────────────────────────────────────────────────

function ReadinessTab() {
  const { data, isLoading } = useQuery<ReadinessData>({ queryKey: ["/api/platform/readiness"], staleTime: 5 * 60_000 });
  const STATUS_COLORS: Record<string, string> = { enterprise_ready: "text-emerald-600 dark:text-emerald-400", production_ready: "text-blue-600 dark:text-blue-400", needs_work: "text-amber-600 dark:text-amber-400", not_ready: "text-rose-600 dark:text-rose-400" };
  const STATUS_LABELS: Record<string, string> = { enterprise_ready: "Enterprise Ready", production_ready: "Production Ready", needs_work: "Needs Work", not_ready: "Not Ready" };

  return (
    <div className="space-y-4" data-testid="tab-readiness">
      {!isLoading && data && (
        <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
          <div className="text-center shrink-0">
            <ScoreRing score={data.overallScore} />
            <p className="text-[9px] text-muted-foreground mt-0.5">Readiness Score</p>
            <p className="text-[10px] font-bold mt-0.5 text-primary">{data.overallStatus}</p>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {data.categories.map(cat => (
              <div key={cat.category} className="p-2 rounded-lg bg-background border text-center" data-testid={`readiness-cat-${cat.category.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className={`text-base font-bold ${STATUS_COLORS[cat.status]}`}>{cat.score}</p>
                <p className="text-[9px] text-muted-foreground">{cat.category}</p>
                <p className={`text-[8px] font-medium ${STATUS_COLORS[cat.status]}`}>{STATUS_LABELS[cat.status] ?? cat.status}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && (data?.warnings ?? []).length > 0 && (
        <div className="space-y-2">
          {data!.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900" data-testid={`readiness-warning-${i}`}>
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{w.area}</p>
                <p className="text-xs">{w.warning}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Observability ────────────────────────────────────────────────────────

function ObservabilityTab() {
  const { data, isLoading, refetch } = useQuery<ObservabilityData>({ queryKey: ["/api/platform/observability"], staleTime: 30_000, refetchInterval: 30_000 });

  return (
    <div className="space-y-4" data-testid="tab-observability">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Auto-refreshes every 30 seconds</p>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()} data-testid="button-refresh-observability"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Req/min",         value: data.currentRps,                                  color: "text-primary" },
            { label: "Errors/min",      value: data.errorsPerMin,                                color: data.errorsPerMin > 1 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
            { label: "Active Users",    value: data.activeUsers.toLocaleString(),                color: "text-blue-600 dark:text-blue-400" },
            { label: "Active Orgs",     value: data.activeOrgs.toLocaleString(),                 color: "text-muted-foreground" },
            { label: "AI Exec/min",     value: data.aiExecPerMin,                               color: "text-violet-600 dark:text-violet-400" },
            { label: "Workflow/min",    value: data.workflowRunsPerMin,                          color: "text-muted-foreground" },
            { label: "Revenue Ev/min",  value: data.revenueEventsPerMin,                         color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`obs-metric-${m.label.toLowerCase().replace(/\//g, "-").replace(/\s+/g, "-")}`}>
              <p className={`text-lg font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sparkline-style RPS chart */}
      {!isLoading && data?.timeline && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-xs font-semibold mb-3 flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5 text-primary" />Requests / minute — last 30 min</p>
          <div className="flex items-end gap-0.5 h-16">
            {data.timeline.map((t, i) => {
              const maxRps = Math.max(...data.timeline.map(x => x.rps));
              const h = Math.round((t.rps / maxRps) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col justify-end" title={`${t.rps} rps at ${new Date(t.ts).toLocaleTimeString()}`}>
                  <div className={`rounded-sm transition-all ${t.errors > 0 ? "bg-rose-400" : "bg-primary/60"}`} style={{ height: `${h}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[8px] text-muted-foreground">
            <span>30 min ago</span><span>Now</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Recovery ────────────────────────────────────────────────────────────

function RecoveryTab() {
  const { data, isLoading } = useQuery<RecoveryData>({ queryKey: ["/api/platform/recovery"], staleTime: 10 * 60_000 });
  const scoreColor = (data?.recoveryScore ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-recovery">
      {!isLoading && data && (
        <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5">
          <div className="text-center shrink-0">
            <ScoreRing score={data.recoveryScore} />
            <p className="text-[9px] text-muted-foreground mt-0.5">Recovery Score</p>
            <p className={`text-[10px] font-bold mt-0.5 ${scoreColor}`}>{data.recoveryReadiness}</p>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Backup Status",     value: data.backupStatus,      color: data.backupStatus === "Current" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
              { label: "Last Backup",       value: formatDistanceToNow(new Date(data.lastBackup), { addSuffix: true }), color: "text-muted-foreground" },
              { label: "RTO",               value: data.rto,               color: "text-primary" },
              { label: "RPO",               value: data.rpo,               color: "text-primary" },
            ].map(m => (
              <div key={m.label} className="p-2.5 rounded-lg bg-background border text-center">
                <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Recovery Checks</h3></div>
          <div className="divide-y">
            {(data?.checks ?? []).map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3" data-testid={`recovery-check-${i}`}>
                {c.status === "pass" ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-xs font-medium">{c.check}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{c.detail}</p>
                </div>
                {c.lastRun && <span className="text-[9px] text-muted-foreground shrink-0">{formatDistanceToNow(new Date(c.lastRun), { addSuffix: true })}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Release Audit ───────────────────────────────────────────────────────

function ReleaseAuditTab() {
  const { data, isLoading } = useQuery<ReleaseData>({ queryKey: ["/api/platform/release-readiness"], staleTime: 5 * 60_000 });
  const categories = [...new Set((data?.checklist ?? []).map(c => c.category))];
  const pctColor = (data?.launchReadinessPct ?? 0) >= 95 ? "text-emerald-600 dark:text-emerald-400" : (data?.launchReadinessPct ?? 0) >= 85 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-release">
      {!isLoading && data && (
        <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
          <div className="text-center shrink-0">
            <p className={`text-5xl font-extrabold ${pctColor}`}>{data.launchReadinessPct}%</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Launch Ready</p>
            <p className={`text-[10px] font-bold mt-0.5 ${pctColor}`}>{data.readinessLevel}</p>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Progress ({data.passed}/{data.totalChecks} passed)</span>
              <span className="text-xs font-bold">{data.blockingIssues} blocking</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden mb-3">
              <div className={`h-full rounded-full ${pctColor.includes("emerald") ? "bg-emerald-500" : pctColor.includes("blue") ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${data.launchReadinessPct}%` }} />
            </div>
            {data.blockingIssues === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle className="h-3.5 w-3.5" />No blocking issues — ready to deploy
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <>
          {categories.map(cat => {
            const items = (data?.checklist ?? []).filter(c => c.category === cat);
            return (
              <div key={cat} className="rounded-xl border overflow-hidden" data-testid={`release-category-${cat.toLowerCase()}`}>
                <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
                  <p className="text-xs font-semibold">{cat}</p>
                  <Badge className={`text-[8px] px-1.5 py-0 h-4 ml-auto ${items.every(i => i.passed) ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>{items.filter(i => i.passed).length}/{items.length} passed</Badge>
                </div>
                <div className="divide-y">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5" data-testid={`release-item-${cat.toLowerCase()}-${i}`}>
                      {item.passed ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />}
                      <div className="flex-1">
                        <p className={`text-xs ${item.passed ? "" : "font-medium"}`}>{item.item}</p>
                        {item.note && <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">{item.note}</p>}
                      </div>
                      <SeverityBadge s={item.severity} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {(data?.recommendedActions ?? []).length > 0 && (
            <div className="p-4 rounded-xl border bg-primary/5">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" />Recommended Actions</p>
              <div className="space-y-2">
                {data!.recommendedActions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2" data-testid={`release-action-${i}`}>
                    <span className={`text-[9px] font-semibold uppercase w-12 ${a.priority === "high" ? "text-rose-600 dark:text-rose-400" : a.priority === "medium" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{a.priority}</span>
                    <span className="text-xs flex-1">{a.action}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 capitalize">{a.effort} effort</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPlatformHealthPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const queryClient = useQueryClient();
  const { data: health } = useQuery<PlatformHealth>({ queryKey: ["/api/platform/health"], staleTime: 30_000, refetchInterval: 30_000 });

  // Auto-refresh overview queries every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/observability"] });
      setLastRefresh(Date.now());
    }, 30_000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const statusColor = health?.status === "Excellent" ? "text-emerald-600 dark:text-emerald-400" : health?.status === "Healthy" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-platform-health">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/billing-intelligence">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Revenue Engine
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Platform Reliability &amp; Enterprise Readiness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full-stack observability, security audits, AI reliability monitoring, and production deployment readiness.
          </p>
        </div>

        {health && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Health",    value: `${health.healthScore}/100`, color: statusColor },
              { label: "Status",    value: health.status,               color: statusColor },
              { label: "Uptime",    value: health.uptime,               color: "text-emerald-600 dark:text-emerald-400" },
            ].map((s, i) => (
              <div key={s.label} className="text-center">
                {i > 0 && <div className="hidden sm:block w-px h-8 bg-border mx-2 -mt-2" />}
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-base font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "AI Workforce",   href: "/admin/ai-workforce" },
          { label: "Workforce",      href: "/admin/ai-workforce/settings" },
          { label: "Operations",     href: "/admin/ai-operations" },
          { label: "Exec Intel",     href: "/admin/executive-intelligence" },
          { label: "Autonomous",     href: "/admin/autonomous-management" },
          { label: "Trust",          href: "/admin/trust-attribution" },
          { label: "External Intel", href: "/admin/market-intelligence" },
          { label: "Network Intel",  href: "/admin/network-intelligence" },
          { label: "Revenue Engine", href: "/admin/billing-intelligence" },
          { label: "Platform Health",href: null, active: true },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-platform">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "overview"      && <OverviewTab lastRefresh={lastRefresh} />}
        {activeTab === "endpoints"     && <EndpointsTab />}
        {activeTab === "errors"        && <ErrorsTab />}
        {activeTab === "isolation"     && <IsolationTab />}
        {activeTab === "permissions"   && <PermissionsTab />}
        {activeTab === "billing"       && <BillingAuditTab />}
        {activeTab === "ux"            && <UxAuditTab />}
        {activeTab === "workflows"     && <WorkflowsTab />}
        {activeTab === "ai"            && <AIHealthTab />}
        {activeTab === "readiness"     && <ReadinessTab />}
        {activeTab === "observability" && <ObservabilityTab />}
        {activeTab === "recovery"      && <RecoveryTab />}
        {activeTab === "release"       && <ReleaseAuditTab />}
      </div>

      {/* Forward navigation → Autonomous Business Execution Engine */}
      <Link href="/admin/execution-center">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-execution-center">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Autonomous Business Execution Engine</p>
            <p className="text-xs text-muted-foreground mt-0.5">Deploy approved strategies, run AI campaigns, recover missed revenue, and execute growth objectives with a full deployment workflow engine.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
