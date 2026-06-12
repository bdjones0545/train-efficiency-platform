import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Shield,
  Zap, Server, Database, Mail, DollarSign, Clock, TrendingUp, Bell,
  AlertCircle, Info, Eye, Timer, Trash2, Gauge
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
function fmtHour(d: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: "operational" | "degraded" | "outage" | string }) {
  if (status === "operational")
    return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-200" data-testid="badge-operational">Operational</Badge>;
  if (status === "degraded")
    return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-200" data-testid="badge-degraded">Degraded</Badge>;
  return <Badge className="bg-red-500/15 text-red-600 border-red-200" data-testid="badge-outage">Outage</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") return <Badge variant="destructive" className="text-[10px]" data-testid="badge-critical">CRITICAL</Badge>;
  if (severity === "warning")  return <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-300 text-[10px]" data-testid="badge-warning">WARNING</Badge>;
  return <Badge variant="outline" className="text-[10px]" data-testid="badge-info">INFO</Badge>;
}

function CheckBadge({ status }: { status: string }) {
  return status === "pass"
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    : <XCircle className="h-4 w-4 text-red-500" />;
}

function SloGauge({ label, value, target, unit, invert = false }: {
  label: string; value: number | null; target: number; unit: string; invert?: boolean;
}) {
  const display = value == null ? "—" : `${value}${unit}`;
  const passing = value == null ? true
    : invert ? value <= target
    : value >= target;
  return (
    <div className="text-center space-y-1" data-testid={`slo-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className={`text-2xl font-bold tabular-nums ${passing ? "text-emerald-500" : "text-red-500"}`}>{display}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground">
        Target: {invert ? "<" : ">"}{target}{unit}
        <span className={`ml-1 ${passing ? "text-emerald-500" : "text-red-500"}`}>
          {passing ? "✓" : "✗"}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AdminReliabilityPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();
  const qc = useQueryClient();

  const dashboard = useQuery<any>({
    queryKey: ["/api/reliability/dashboard"],
    refetchInterval: 30_000,
  });
  const slos = useQuery<any>({
    queryKey: ["/api/reliability/slos"],
    refetchInterval: 60_000,
  });
  const alerts = useQuery<any[]>({
    queryKey: ["/api/reliability/alerts"],
    refetchInterval: 30_000,
  });
  const healthChecks = useQuery<any[]>({
    queryKey: ["/api/reliability/health-checks"],
    refetchInterval: 30_000,
  });
  const execSummary = useQuery<any>({
    queryKey: ["/api/reliability/executive-summary"],
    refetchInterval: 30_000,
  });
  const probeLatency = useQuery<any[]>({
    queryKey: ["/api/reliability/probe-latency"],
    refetchInterval: 60_000,
  });
  const retentionHistory = useQuery<any>({
    queryKey: ["/api/reliability/retention-history"],
    refetchInterval: 120_000,
  });

  const runChecks = useMutation({
    mutationFn: () => apiRequest("POST", "/api/reliability/run-health-checks"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reliability/health-checks"] });
      qc.invalidateQueries({ queryKey: ["/api/reliability/dashboard"] });
      toast({ title: "Health checks complete" });
    },
  });

  const resolveAlert = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/reliability/alerts/${id}/resolve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reliability/alerts"] });
      qc.invalidateQueries({ queryKey: ["/api/reliability/dashboard"] });
      toast({ title: "Alert resolved" });
    },
  });

  const d = dashboard.data;
  const s = slos.data;
  const summary = execSummary.data;

  // Build hourly error chart data
  const errorChartData = (() => {
    const map = new Map<string, { hour: string; clientErrors: number; queryFailures: number }>();
    for (const row of d?.ceHourly ?? []) {
      const h = fmtHour(row.hour);
      const e = map.get(h) ?? { hour: h, clientErrors: 0, queryFailures: 0 };
      e.clientErrors += row.count;
      map.set(h, e);
    }
    for (const row of d?.qfHourly ?? []) {
      const h = fmtHour(row.hour);
      const e = map.get(h) ?? { hour: h, clientErrors: 0, queryFailures: 0 };
      e.queryFailures += row.count;
      map.set(h, e);
    }
    return Array.from(map.values()).slice(-24);
  })();

  const activeAlerts: any[] = d?.activeAlerts ?? [];
  const openCritical = activeAlerts.filter((a: any) => a.severity === "critical").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2" data-testid="text-reliability-title">
            <Shield className="h-6 w-6 text-indigo-500" />
            Reliability Dashboard
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Live platform health, SLOs, error trends, and alerts</p>
        </div>
        <div className="flex items-center gap-2">
          {summary && <StatusBadge status={summary.status} />}
          {openCritical > 0 && (
            <Badge variant="destructive" className="gap-1" data-testid="badge-critical-count">
              <AlertTriangle className="h-3 w-3" /> {openCritical} Critical
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => runChecks.mutate()}
            disabled={runChecks.isPending} data-testid="button-run-health-checks">
            <RefreshCw className={`h-4 w-4 mr-1 ${runChecks.isPending ? "animate-spin" : ""}`} />
            Run Health Checks
          </Button>
        </div>
      </div>

      {/* SLO summary strip */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-500" />
            Service Level Objectives — last 24 hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          {slos.isLoading ? (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
              <SloGauge label="Availability"        value={s?.availability?.value}        target={s?.availability?.target ?? 99.9}  unit="%" />
              <SloGauge label="API Error Rate"      value={s?.apiErrorRate?.value}        target={s?.apiErrorRate?.target ?? 1.0}   unit="%" invert />
              <SloGauge label="Client Crash Rate"   value={s?.clientCrashRate?.value}     target={s?.clientCrashRate?.target ?? 0.1} unit="%" invert />
              <SloGauge label="Agent Success"       value={s?.agentSuccessRate?.value}    target={s?.agentSuccessRate?.target ?? 95} unit="%" />
              <SloGauge label="Billing Success"     value={s?.billingSuccessRate?.value}  target={s?.billingSuccessRate?.target ?? 99} unit="%" />
              <SloGauge label="Email Success"       value={s?.emailSuccessRate?.value}    target={s?.emailSuccessRate?.target ?? 99} unit="%" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto flex overflow-x-auto" data-testid="tabs-reliability">
          <TabsTrigger value="overview"        className="text-xs gap-1" data-testid="tab-overview"><Activity className="h-3 w-3"/>Overview</TabsTrigger>
          <TabsTrigger value="errors"          className="text-xs gap-1" data-testid="tab-errors"><AlertCircle className="h-3 w-3"/>Errors</TabsTrigger>
          <TabsTrigger value="infrastructure"  className="text-xs gap-1" data-testid="tab-infra"><Server className="h-3 w-3"/>Infrastructure</TabsTrigger>
          <TabsTrigger value="agents"          className="text-xs gap-1" data-testid="tab-agents"><Zap className="h-3 w-3"/>Agents</TabsTrigger>
          <TabsTrigger value="financial"       className="text-xs gap-1" data-testid="tab-financial"><DollarSign className="h-3 w-3"/>Financial</TabsTrigger>
          <TabsTrigger value="maintenance"     className="text-xs gap-1" data-testid="tab-maintenance"><Trash2 className="h-3 w-3"/>Maintenance</TabsTrigger>
          <TabsTrigger value="alerts"          className="text-xs gap-1" data-testid="tab-alerts">
            <Bell className="h-3 w-3"/>Alerts
            {activeAlerts.length > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{activeAlerts.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Client Errors (24h)", value: d?.totals?.client_errors_24h ?? 0, icon: AlertCircle, color: "text-red-500" },
              { label: "Query Failures (24h)", value: d?.totals?.query_failures_24h ?? 0, icon: XCircle, color: "text-orange-500" },
              { label: "Open Alerts", value: d?.totals?.open_alerts ?? 0, icon: Bell, color: "text-yellow-500" },
              { label: "System Errors (24h)", value: d?.totals?.system_errors_24h ?? 0, icon: AlertTriangle, color: "text-red-600" },
            ].map((s) => (
              <Card key={s.label} data-testid={`stat-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <s.icon className={`h-5 w-5 ${s.color}`} />
                    <span className="text-2xl font-bold tabular-nums">{dashboard.isLoading ? "—" : s.value}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Error trend chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Error Trends — last 24 hours (hourly)</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.isLoading ? <Skeleton className="h-48 w-full" /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={errorChartData ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="clientErrors" stroke="#ef4444" name="Client Errors" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="queryFailures" stroke="#f97316" name="Query Failures" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4 text-yellow-500" /> Active Alerts ({activeAlerts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {activeAlerts.map((alert: any) => (
                    <div key={alert.id} className="flex items-start gap-3 px-4 py-3" data-testid={`alert-${alert.id}`}>
                      <SeverityBadge severity={alert.severity} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{alert.title}</div>
                        <div className="text-xs text-muted-foreground">{alert.description}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(alert.created_at)}</div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => resolveAlert.mutate(alert.id)}
                        data-testid={`button-resolve-${alert.id}`}>
                        Resolve
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── ERRORS ── */}
        <TabsContent value="errors" className="space-y-4 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Client errors */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" /> Client Errors (recent 50)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-80">
                  {(d?.recentClientErrors ?? []).length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">No client errors recorded</div>
                  ) : (
                    <div className="divide-y">
                      {(d?.recentClientErrors ?? []).map((e: any) => (
                        <div key={e.id} className="px-4 py-2.5" data-testid={`client-error-${e.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-xs font-medium truncate flex-1">{e.message || "—"}</div>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmt(e.created_at)}</span>
                          </div>
                          {e.route && <div className="text-[10px] text-muted-foreground">Route: {e.route}</div>}
                          {e.source && <div className="text-[10px] text-muted-foreground">Source: {e.source}:{e.line}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Query failures */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-orange-500" /> Query Failures (recent 50)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-80">
                  {(d?.recentQueryFailures ?? []).length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">No query failures recorded</div>
                  ) : (
                    <div className="divide-y">
                      {(d?.recentQueryFailures ?? []).map((e: any) => (
                        <div key={e.id} className="px-4 py-2.5" data-testid={`query-failure-${e.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">{e.status_code ?? "?"}</Badge>
                              <span className="text-xs font-medium truncate">{e.query_key || e.route || "—"}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmt(e.created_at)}</span>
                          </div>
                          {e.message && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{e.message}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Top failing routes */}
          {(d?.topFailingRoutes ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Failing Routes (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={d?.topFailingRoutes ?? []} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={160} />
                    <Tooltip />
                    <Bar dataKey="count" name="Failures" fill="#f97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── INFRASTRUCTURE ── */}
        <TabsContent value="infrastructure" className="space-y-4 pt-4">
          {/* Latest health check per service */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-blue-500" /> Current Health Check Status
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => runChecks.mutate()} disabled={runChecks.isPending}
                  data-testid="button-run-checks-infra">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${runChecks.isPending ? "animate-spin" : ""}`} />
                  Run Now
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {healthChecks.isLoading ? <Skeleton className="h-40 w-full" /> : (
                <div className="space-y-2">
                  {(d?.hcLatest ?? []).map((check: any) => (
                    <div key={check.check_name}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                      data-testid={`health-check-${check.check_name}`}>
                      <CheckBadge status={check.status} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{check.check_name.replace(/_/g, " ")}</div>
                        {check.details && <div className="text-xs text-muted-foreground">{check.details}</div>}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {check.response_time_ms != null ? `${check.response_time_ms}ms` : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{fmt(check.created_at)}</div>
                    </div>
                  ))}
                  {(d?.hcLatest ?? []).length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      No health check results yet. Click "Run Now" above.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Health check performance over time */}
          {(d?.hcSummary ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Health Check Performance (24h average)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={d?.hcSummary ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis dataKey="check_name" tick={{ fontSize: 9 }} tickFormatter={v => v.replace(/_/g, " ").slice(0, 12)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="avg_ms" name="Avg Response (ms)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* HTTP Probe Latency Percentiles */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Timer className="h-4 w-4 text-indigo-500" /> HTTP Probe Latency — last 24h
              </CardTitle>
              <CardDescription className="text-xs">
                p50 / p95 / max response times. Warning: p95 &gt; 1500ms · Critical: p95 &gt; 3000ms
              </CardDescription>
            </CardHeader>
            <CardContent>
              {probeLatency.isLoading ? <Skeleton className="h-24 w-full" /> :
               (Array.isArray(probeLatency.data) ? probeLatency.data : []).length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No probe latency data yet — run health checks first.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-probe-latency">
                    <thead>
                      <tr className="text-left text-[10px] text-muted-foreground border-b">
                        <th className="pb-2 font-medium">Probe</th>
                        <th className="pb-2 font-medium text-right">p50</th>
                        <th className="pb-2 font-medium text-right">p95</th>
                        <th className="pb-2 font-medium text-right">Max</th>
                        <th className="pb-2 font-medium text-right">Samples</th>
                        <th className="pb-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(Array.isArray(probeLatency.data) ? probeLatency.data : []).map((row: any) => {
                        const p95 = row.p95 ?? 0;
                        const latencyStatus = p95 >= 3000 ? "critical" : p95 >= 1500 ? "warning" : "ok";
                        return (
                          <tr key={row.check_name} className="py-2" data-testid={`latency-row-${row.check_name}`}>
                            <td className="py-2 font-mono text-xs">{row.check_name.replace(/^http_/, "")}</td>
                            <td className="py-2 text-right tabular-nums text-xs">{row.p50 ?? "—"}ms</td>
                            <td className={`py-2 text-right tabular-nums text-xs font-semibold ${
                              latencyStatus === "critical" ? "text-red-500" :
                              latencyStatus === "warning"  ? "text-yellow-500" : ""
                            }`}>{row.p95 ?? "—"}ms</td>
                            <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">{row.max_ms ?? "—"}ms</td>
                            <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">{row.sample_count}</td>
                            <td className="py-2 text-right">
                              {latencyStatus === "critical" && <Badge variant="destructive" className="text-[10px]">CRITICAL</Badge>}
                              {latencyStatus === "warning"  && <Badge className="text-[10px] bg-yellow-500/15 text-yellow-700 border-yellow-300">WARN</Badge>}
                              {latencyStatus === "ok"       && <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">OK</Badge>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AGENTS ── */}
        <TabsContent value="agents" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" /> Agent Health
              </CardTitle>
              <CardDescription className="text-xs">Based on agent action logs and quality scores</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-500">
                    {s?.agentSuccessRate?.value != null ? `${s.agentSuccessRate.value}%` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Success Rate (24h)</div>
                  <div className="text-[10px] text-muted-foreground">Target: &gt;95%</div>
                </div>
                <div className="rounded-lg border p-4 text-center">
                  <div className="text-2xl font-bold text-blue-500">
                    {d?.totals?.system_errors_24h ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">System Errors (24h)</div>
                </div>
                <div className="rounded-lg border p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-500">
                    {activeAlerts.filter((a: any) => a.title?.toLowerCase().includes("agent")).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Active Agent Alerts</div>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg border bg-muted/30 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 inline mr-1 text-blue-400" />
                Detailed agent metrics available in Agent Quality and CEO Heartbeat dashboards.
                Reliability tracks aggregate success/failure rates from{" "}
                <span className="font-mono text-xs">unified_agent_action_log</span>.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── MAINTENANCE ── */}
        <TabsContent value="maintenance" className="space-y-4 pt-4">
          {/* Retention policies */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-orange-500" /> Log Retention Policies
              </CardTitle>
              <CardDescription className="text-xs">
                Automated cleanup runs daily. Logs beyond policy age are permanently deleted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {(retentionHistory.data?.policies ?? []).map((p: any) => (
                  <div key={p.table} className="flex items-center justify-between py-2.5" data-testid={`policy-${p.table.replace(/\s+/g, "-")}`}>
                    <span className="font-mono text-xs">{p.table}</span>
                    <Badge variant="outline" className="text-[10px]">{p.retentionDays}d</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Schedule status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <Clock className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
                <div className="text-sm font-semibold mt-1">
                  {retentionHistory.data?.lastRunAt
                    ? new Date(retentionHistory.data.lastRunAt).toLocaleString()
                    : "Not yet run"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Last Cleanup</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <Activity className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                <div className="text-sm font-semibold mt-1">
                  {retentionHistory.data?.nextRunAt
                    ? new Date(retentionHistory.data.nextRunAt).toLocaleString()
                    : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Next Scheduled Run</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <Trash2 className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
                <div className="text-2xl font-bold tabular-nums mt-1">
                  {retentionHistory.data?.history?.length ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Runs Recorded</div>
              </CardContent>
            </Card>
          </div>

          {/* Cleanup history */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" /> Cleanup History (last 10 runs)
                </CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => qc.invalidateQueries({ queryKey: ["/api/reliability/retention-history"] })}
                  data-testid="button-refresh-retention">
                  <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {retentionHistory.isLoading ? (
                <div className="p-4 space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10 w-full"/>)}</div>
              ) : (retentionHistory.data?.history ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  No cleanup runs yet. First run scheduled for{" "}
                  {retentionHistory.data?.nextRunAt
                    ? new Date(retentionHistory.data.nextRunAt).toLocaleString()
                    : "24h after server startup"}.
                </div>
              ) : (
                <div className="divide-y">
                  {(retentionHistory.data?.history ?? []).map((run: any) => {
                    const meta = run.metadata as any;
                    const del = meta?.deleted ?? {};
                    return (
                      <div key={run.id} className="px-4 py-3" data-testid={`retention-run-${run.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-muted-foreground">{fmt(run.created_at)}</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                              {del.systemLogs      != null && <span className="text-[11px]"><span className="text-muted-foreground">system_logs</span> <span className="font-semibold">{del.systemLogs}</span> deleted</span>}
                              {del.queryFailures   != null && <span className="text-[11px]"><span className="text-muted-foreground">query_failures</span> <span className="font-semibold">{del.queryFailures}</span> deleted</span>}
                              {del.healthChecks    != null && <span className="text-[11px]"><span className="text-muted-foreground">health_checks</span> <span className="font-semibold">{del.healthChecks}</span> deleted</span>}
                              {del.clientErrors    != null && <span className="text-[11px]"><span className="text-muted-foreground">client_errors</span> <span className="font-semibold">{del.clientErrors}</span> deleted</span>}
                              {del.resolvedAlerts  != null && <span className="text-[11px]"><span className="text-muted-foreground">resolved_alerts</span> <span className="font-semibold">{del.resolvedAlerts}</span> deleted</span>}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 flex-shrink-0">Completed</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── FINANCIAL ── */}
        <TabsContent value="financial" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" /> Financial System Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-500">
                    {s?.billingSuccessRate?.value != null ? `${s.billingSuccessRate.value}%` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Billing Success Rate (24h)</div>
                  <div className="text-[10px] text-muted-foreground">Target: &gt;99%</div>
                </div>
                <div className="rounded-lg border p-4 text-center">
                  <div className="text-2xl font-bold text-blue-500">
                    {(d?.logsByService ?? []).filter((l: any) => l.service === "stripe" && l.level === "error").reduce((a: number, b: any) => a + b.count, 0)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Stripe Errors (24h)</div>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg border bg-muted/30 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 inline mr-1 text-blue-400" />
                Financial events are logged to system_logs with service="stripe". Detailed reconciliation available in{" "}
                Financial Reconciliation and Wallet dashboards.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ALERTS ── */}
        <TabsContent value="alerts" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4 text-yellow-500" /> All Alerts
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["/api/reliability/alerts"] })}
                  data-testid="button-refresh-alerts">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {alerts.isLoading ? (
                  <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div>
                ) : (Array.isArray(alerts.data) ? alerts.data : []).length === 0 ? (
                  <div className="p-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    <div className="text-sm text-muted-foreground">No alerts — all systems normal</div>
                  </div>
                ) : (
                  <div className="divide-y">
                    {(Array.isArray(alerts.data) ? alerts.data : []).map((alert: any) => (
                      <div key={alert.id} className={`flex items-start gap-3 px-4 py-3 ${alert.resolved_at ? "opacity-50" : ""}`}
                        data-testid={`alert-history-${alert.id}`}>
                        <SeverityBadge severity={alert.severity} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{alert.title}</div>
                          {alert.description && <div className="text-xs text-muted-foreground">{alert.description}</div>}
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Fired: {fmt(alert.created_at)}
                            {alert.resolved_at && <span className="ml-2 text-emerald-500">• Resolved: {fmt(alert.resolved_at)}</span>}
                          </div>
                        </div>
                        {!alert.resolved_at && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs flex-shrink-0"
                            onClick={() => resolveAlert.mutate(alert.id)}
                            data-testid={`button-resolve-alert-${alert.id}`}>
                            Resolve
                          </Button>
                        )}
                        {alert.resolved_at && <Badge variant="outline" className="text-[10px] flex-shrink-0">Resolved</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
