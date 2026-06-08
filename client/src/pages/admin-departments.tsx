import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2, Zap, AlertTriangle, CheckCircle, TrendingUp,
  Shield, BarChart3, Brain, ChevronRight, RefreshCw, Star,
  Activity, Clock, ArrowRight, Trophy,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-500";
}

function statusBadge(status: string) {
  if (status === "healthy")  return <Badge className="bg-green-100 text-green-700 border-green-200">Healthy</Badge>;
  if (status === "warning")  return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Warning</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200">Critical</Badge>;
}

function priorityBadge(priority: string) {
  if (priority === "critical") return <Badge variant="destructive">Critical</Badge>;
  if (priority === "high")     return <Badge className="bg-orange-100 text-orange-700">High</Badge>;
  if (priority === "medium")   return <Badge variant="secondary">Medium</Badge>;
  return <Badge variant="outline">Low</Badge>;
}

function severityBadge(severity: string) {
  if (severity === "high")   return <Badge variant="destructive">High</Badge>;
  if (severity === "medium") return <Badge className="bg-orange-100 text-orange-700">Medium</Badge>;
  return <Badge variant="outline">Low</Badge>;
}

function healthBg(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

const MATURITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Foundation",      color: "bg-gray-200 text-gray-700" },
  2: { label: "Intelligence",    color: "bg-blue-100 text-blue-700" },
  3: { label: "Operations",      color: "bg-indigo-100 text-indigo-700" },
  4: { label: "Autonomy",        color: "bg-purple-100 text-purple-700" },
  5: { label: "Self-Optimizing", color: "bg-emerald-100 text-emerald-700" },
};

function deptRoute(id: string): string {
  const map: Record<string, string> = {
    "opportunity-acquisition": "/admin/opportunity-acquisition",
    "hiring":                  "/admin/hiring",
    "partnerships":            "/admin/partnerships",
    "sponsorships":            "/admin/sponsorships",
  };
  return map[id] ?? `/admin/${id}`;
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: any }) {
  const [, navigate] = useLocation();
  const health      = data?.organizationHealth ?? {};
  const bestAction  = data?.organizationBestAction;
  const depts       = data?.departments ?? [];
  const alerts      = depts.reduce((s: number, d: any) => s + d.openAlerts, 0);
  const pending     = depts.reduce((s: number, d: any) => s + (d.bestAction ? 1 : 0), 0);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Departments Active", value: health.totalDepts ?? 0,  icon: Building2,     color: "text-blue-600" },
          { label: "Organization Health", value: `${health.score ?? 100}`, icon: Activity,     color: healthColor(health.score ?? 100) },
          { label: "Open Alerts",        value: alerts,                   icon: AlertTriangle, color: alerts > 0 ? "text-red-500" : "text-green-600" },
          { label: "Pending Actions",    value: pending,                  icon: Zap,           color: "text-indigo-600" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </div>
              <p className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Organization health banner */}
      <Card className={`border-2 ${health.score >= 80 ? "border-green-200 bg-green-50 dark:bg-green-950/20" : health.score >= 60 ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organization Health</p>
              <div className="flex items-end gap-3 mt-1">
                <span className={`text-5xl font-bold ${healthColor(health.score ?? 100)}`}>{health.score ?? 100}</span>
                <span className="text-xl font-medium text-muted-foreground mb-1">/100 — {health.label}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Healthy",  value: health.healthyDepts ?? 0,  color: "text-green-600" },
                { label: "Warning",  value: health.warningDepts ?? 0,  color: "text-yellow-600" },
                { label: "Critical", value: health.criticalDepts ?? 0, color: "text-red-500" },
              ].map(s => (
                <div key={s.label}>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organization best action */}
      {bestAction && (
        <Card className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20">
          <CardContent className="pt-5">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                <Zap className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Highest Priority Action</p>
                  {priorityBadge(bestAction.priority)}
                  {bestAction.departmentName && (
                    <Badge variant="outline" className="text-xs">{bestAction.departmentName}</Badge>
                  )}
                </div>
                <p className="text-lg font-semibold">{bestAction.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{bestAction.description}</p>
                {bestAction.estimatedImpact && (
                  <p className="text-xs text-indigo-600 mt-1 font-medium">Impact: {bestAction.estimatedImpact}</p>
                )}
              </div>
              {bestAction.route && (
                <Button size="sm" onClick={() => navigate(bestAction.route!)} data-testid="button-best-action">
                  Take Action <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Department quick status */}
      <div className="grid md:grid-cols-2 gap-3">
        {depts.map((d: any) => (
          <Card key={d.departmentId} data-testid={`card-dept-${d.departmentId}`}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(deptRoute(d.departmentId))}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <p className="font-medium text-sm">{d.departmentName}</p>
                </div>
                {statusBadge(d.status)}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className={`font-semibold ${healthColor(d.healthScore)}`}>Health: {d.healthScore}</span>
                {d.openAlerts > 0 && <span className="text-red-500">⚠ {d.openAlerts} alert{d.openAlerts > 1 ? "s" : ""}</span>}
                {d.bestAction && <span className="text-indigo-600">⚡ Action ready</span>}
              </div>
              {d.executiveSummary && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{d.executiveSummary}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Departments Tab ───────────────────────────────────────────────────────────

function DepartmentsTab({ departments }: { departments: any[] }) {
  const [, navigate] = useLocation();

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {departments.map((d: any) => {
        const maturity = MATURITY_LABELS[d.maturityLevel] ?? MATURITY_LABELS[1];
        return (
          <Card key={d.departmentId} data-testid={`card-dept-detail-${d.departmentId}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{d.departmentName}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${maturity.color}`}>
                      Level {d.maturityLevel} — {maturity.label}
                    </span>
                    {statusBadge(d.status)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate(deptRoute(d.departmentId))}
                  data-testid={`button-goto-${d.departmentId}`}>
                  Open <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Health bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Health Score</span>
                  <span className={`font-semibold ${healthColor(d.healthScore)}`}>{d.healthScore}/100</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${healthBg(d.healthScore)} transition-all`}
                    style={{ width: `${d.healthScore}%` }} />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Alerts",       value: d.openAlerts,    color: d.openAlerts > 0 ? "text-red-500" : "text-green-600" },
                  { label: "Checks Run",   value: d.checksRun,     color: "text-muted-foreground" },
                  { label: "Checks Pass",  value: d.checksPassed,  color: "text-green-600" },
                ].map(s => (
                  <div key={s.label} className="bg-muted/30 rounded p-2">
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Capabilities */}
              {d.capabilities?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.capabilities.map((cap: string) => (
                    <Badge key={cap} variant="outline" className="text-xs">{cap}</Badge>
                  ))}
                </div>
              )}

              {/* Best action */}
              {d.bestAction && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Zap className="w-3 h-3 text-indigo-600" />
                    <p className="text-xs font-semibold text-indigo-600">Best Action</p>
                    {priorityBadge(d.bestAction.priority)}
                  </div>
                  <p className="text-xs">{d.bestAction.title}</p>
                </div>
              )}

              {/* Summary */}
              <p className="text-xs text-muted-foreground line-clamp-2">{d.executiveSummary}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Health Matrix Tab ─────────────────────────────────────────────────────────

function HealthMatrixTab({ departments }: { departments: any[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead className="text-center">Health Score</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center text-red-600">Critical</TableHead>
            <TableHead className="text-center text-orange-600">High</TableHead>
            <TableHead className="text-center text-yellow-600">Medium</TableHead>
            <TableHead className="text-center text-blue-600">Low</TableHead>
            <TableHead>Last Review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {departments.map((d: any) => {
            const critical = d.healthChecks?.filter((c: any) => !c.passed && c.severity === "high").length ?? 0;
            const high     = d.healthChecks?.filter((c: any) => !c.passed && c.severity === "medium").length ?? 0;
            const low      = d.healthChecks?.filter((c: any) => !c.passed && c.severity === "low").length ?? 0;
            return (
              <TableRow key={d.departmentId} data-testid={`row-health-${d.departmentId}`}>
                <TableCell className="font-medium">{d.departmentName}</TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${healthBg(d.healthScore)}`}
                        style={{ width: `${d.healthScore}%` }} />
                    </div>
                    <span className={`font-semibold text-sm ${healthColor(d.healthScore)}`}>{d.healthScore}</span>
                  </div>
                </TableCell>
                <TableCell className="text-center">{statusBadge(d.status)}</TableCell>
                <TableCell className="text-center">
                  {critical > 0 ? <span className="font-bold text-red-600">{critical}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center">
                  {high > 0 ? <span className="font-bold text-orange-600">{high}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center">
                  {low > 0 ? <span className="font-bold text-yellow-600">{low}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-muted-foreground">—</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date().toLocaleDateString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Best Actions Tab ──────────────────────────────────────────────────────────

function ActionsTab({ actions }: { actions: any[] }) {
  const [, navigate] = useLocation();

  return (
    <div className="space-y-3">
      {actions.length === 0 ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground">
          No actions available — departments have no active recommendations.
        </CardContent></Card>
      ) : actions.map((action: any, i: number) => (
        <Card key={i} data-testid={`card-action-${i}`}>
          <CardContent className="pt-4">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {priorityBadge(action.priority)}
                  <Badge variant="outline" className="text-xs">{action.departmentName}</Badge>
                  {i === 0 && <Badge className="bg-indigo-600 text-white text-xs">Top Priority</Badge>}
                </div>
                <p className="font-medium">{action.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{action.description}</p>
                {action.estimatedImpact && (
                  <p className="text-xs text-indigo-600 mt-1">Impact: {action.estimatedImpact}</p>
                )}
              </div>
              {action.route && (
                <Button size="sm" variant="outline" onClick={() => navigate(action.route)}
                  data-testid={`button-action-goto-${i}`}>
                  Go <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Alerts Tab ────────────────────────────────────────────────────────────────

function AlertsTab({ alerts }: { alerts: any[] }) {
  return (
    <div className="space-y-3">
      {alerts.length === 0 ? (
        <Card className="border-green-200">
          <CardContent className="pt-6 pb-6 text-center">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
            <p className="font-semibold text-green-700">All Clear</p>
            <p className="text-sm text-muted-foreground">No active alerts across any department.</p>
          </CardContent>
        </Card>
      ) : alerts.map((alert: any, i: number) => (
        <Card key={i} data-testid={`card-alert-${i}`}
          className={alert.severity === "high" ? "border-red-200" : alert.severity === "medium" ? "border-yellow-200" : ""}>
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${alert.severity === "high" ? "text-red-500" : alert.severity === "medium" ? "text-yellow-500" : "text-blue-400"}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {severityBadge(alert.severity)}
                  <Badge variant="outline" className="text-xs">{alert.departmentName}</Badge>
                </div>
                <p className="font-medium text-sm">{alert.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>
                {alert.recommendation && (
                  <p className="text-xs text-blue-600 mt-1">→ {alert.recommendation}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Maturity Tab ──────────────────────────────────────────────────────────────

const MATURITY_DEFINITIONS = [
  { level: 1, label: "Foundation",      desc: "Basic department structure, core tables, manual workflows.", color: "bg-gray-200 text-gray-700" },
  { level: 2, label: "Intelligence",    desc: "AI-powered scoring and qualification engine active.",        color: "bg-blue-100 text-blue-700" },
  { level: 3, label: "Operations",      desc: "Full pipeline, learning engine, executive intelligence.",    color: "bg-indigo-100 text-indigo-700" },
  { level: 4, label: "Autonomy",        desc: "Auto-execution, decision learning, proactive actions.",     color: "bg-purple-100 text-purple-700" },
  { level: 5, label: "Self-Optimizing", desc: "Continuous self-improvement with no human intervention.",   color: "bg-emerald-100 text-emerald-700" },
];

function MaturityTab({ departments }: { departments: any[] }) {
  const [, navigate] = useLocation();

  return (
    <div className="space-y-6">
      {MATURITY_DEFINITIONS.map(def => {
        const depts = departments.filter(d => d.maturityLevel === def.level);
        return (
          <div key={def.level}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-sm px-3 py-1 rounded-full font-semibold ${def.color}`}>
                Level {def.level}
              </span>
              <div>
                <span className="font-semibold">{def.label}</span>
                <p className="text-xs text-muted-foreground">{def.desc}</p>
              </div>
            </div>
            {depts.length === 0 ? (
              <div className="ml-4 text-xs text-muted-foreground italic">No departments at this level</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3 ml-4">
                {depts.map((d: any) => (
                  <Card key={d.departmentId} data-testid={`card-maturity-${d.departmentId}`}
                    className="cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => navigate(deptRoute(d.departmentId))}>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-sm">{d.departmentName}</p>
                        {statusBadge(d.status)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {d.capabilities?.map((cap: string) => (
                          <Badge key={cap} variant="outline" className="text-xs">{cap}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDepartmentsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/departments/overview"],
    staleTime: 60_000,
  });

  const departments = data?.departments ?? [];
  const health      = data?.organizationHealth ?? {};

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Building2 className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold">Department Command Center</h1>
            <Badge variant="outline" className="text-xs">Executive Department OS</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Executive view of the AI organization — {departments.length} department{departments.length !== 1 ? "s" : ""} active.
            Auto-discovers future departments.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}
          data-testid="button-refresh">
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <div className="text-center space-y-3">
            <Activity className="w-12 h-12 mx-auto animate-pulse" />
            <p className="text-lg font-medium">Querying all departments...</p>
            <p className="text-sm">Running health checks across the organization</p>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="overview"    data-testid="tab-overview"><Activity className="w-3 h-3 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="departments" data-testid="tab-departments"><Building2 className="w-3 h-3 mr-1" />Departments</TabsTrigger>
            <TabsTrigger value="health"      data-testid="tab-health"><Shield className="w-3 h-3 mr-1" />Health Matrix</TabsTrigger>
            <TabsTrigger value="actions"     data-testid="tab-actions"><Zap className="w-3 h-3 mr-1" />Best Actions</TabsTrigger>
            <TabsTrigger value="alerts"      data-testid="tab-alerts"><AlertTriangle className="w-3 h-3 mr-1" />Alerts</TabsTrigger>
            <TabsTrigger value="maturity"    data-testid="tab-maturity"><Trophy className="w-3 h-3 mr-1" />Maturity</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="overview">
              <OverviewTab data={data} />
            </TabsContent>
            <TabsContent value="departments">
              <DepartmentsTab departments={departments} />
            </TabsContent>
            <TabsContent value="health">
              <HealthMatrixTab departments={departments} />
            </TabsContent>
            <TabsContent value="actions">
              <ActionsTab actions={data?.allBestActions ?? []} />
            </TabsContent>
            <TabsContent value="alerts">
              <AlertsTab alerts={[]} />
            </TabsContent>
            <TabsContent value="maturity">
              <MaturityTab departments={departments} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
