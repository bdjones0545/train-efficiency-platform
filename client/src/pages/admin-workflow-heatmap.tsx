/**
 * Operational Heatmap View — Phase 6
 *
 * Visualizes workflow bottlenecks, risk distribution, complexity,
 * and agent load across the organization.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Flame, AlertTriangle, ShieldAlert, Zap, CheckCircle,
  BarChart2, Layers, Activity, Clock, GitBranch, TrendingUp,
} from "lucide-react";

// ─── Risk Color Maps ──────────────────────────────────────────────────────────

const RISK_BG: Record<string, string> = {
  low:      "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
  medium:   "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  high:     "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
  critical: "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800",
};

const RISK_DOT: Record<string, string> = {
  low: "bg-green-500", medium: "bg-amber-500", high: "bg-red-500", critical: "bg-violet-500",
};

const CATEGORY_COLORS: Record<string, string> = {
  onboarding: "#3b82f6", retention: "#10b981", outreach: "#f59e0b",
  scheduling: "#8b5cf6", research: "#ec4899", executive: "#64748b", custom: "#94a3b8",
};

// ─── Heatmap Cell ─────────────────────────────────────────────────────────────

function HeatCell({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) : 0;
  const intensity = Math.round(pct * 9) * 10; // 0–90

  const bg = pct === 0 ? "bg-muted/30" :
    pct < 0.33 ? "bg-blue-200 dark:bg-blue-900/50" :
    pct < 0.66 ? "bg-amber-200 dark:bg-amber-900/50" :
    "bg-red-200 dark:bg-red-900/50";

  return (
    <div className={`rounded-md p-2 ${bg} transition-colors`} title={`${label}: ${value}`}>
      <p className="text-xs font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground truncate">{label}</p>
    </div>
  );
}

// ─── Complexity Bar ───────────────────────────────────────────────────────────

function ComplexityBar({ value, max, name, riskLevel, published }: {
  value: number; max: number; name: string; riskLevel: string; published: boolean;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const barColor = riskLevel === "low" ? "bg-green-500" : riskLevel === "medium" ? "bg-amber-500" : riskLevel === "high" ? "bg-red-500" : "bg-violet-500";

  return (
    <div className="space-y-1" data-testid={`heatmap-bar-${name}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="truncate max-w-[180px] font-medium">{name}</span>
        <div className="flex items-center gap-1.5">
          {published && <CheckCircle className="h-3 w-3 text-green-500" />}
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${RISK_BG[riskLevel] ?? RISK_BG.low}`}>{riskLevel}</span>
          <span className="text-muted-foreground w-6 text-right">{value}</span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminWorkflowHeatmapPage() {
  const { data: graphs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    select: (data: any) => Array.isArray(data) ? data : [],
  });

  const heatData = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs/heatmap"],
    select: (data: any) => Array.isArray(data) ? data : [],
  });

  const stats = useMemo(() => {
    if (!graphs.length) return null;
    const total = graphs.length;
    const published = graphs.filter((g: any) => g.published).length;
    const requiresApproval = graphs.filter((g: any) => g.requiresApproval).length;
    const byRisk: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCategory: Record<string, number> = {};
    let totalComplexity = 0;

    for (const g of graphs) {
      byRisk[g.riskLevel] = (byRisk[g.riskLevel] ?? 0) + 1;
      byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
      totalComplexity += g.estimatedComplexity ?? 0;
    }

    return { total, published, requiresApproval, byRisk, byCategory, avgComplexity: Math.round(totalComplexity / total) };
  }, [graphs]);

  const maxComplexity = useMemo(() => Math.max(...graphs.map((g: any) => g.estimatedComplexity ?? 0), 1), [graphs]);
  const maxNodes = useMemo(() => Math.max(...graphs.map((g: any) => ((g.graphDefinition as any)?.nodes ?? []).length), 1), [graphs]);

  const sortedByComplexity = useMemo(() =>
    [...graphs].sort((a, b) => (b.estimatedComplexity ?? 0) - (a.estimatedComplexity ?? 0)).slice(0, 15)
  , [graphs]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-workflow-heatmap">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/agent-ops">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" />
              Agent Ops
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Flame className="h-5 w-5 text-red-500" />
              Operational Heatmap
            </h1>
            <p className="text-sm text-muted-foreground">Workflow risk, complexity, and bottleneck visualization</p>
          </div>
        </div>
        <Link href="/admin/workflow-builder">
          <Button size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-new-workflow">
            <GitBranch className="h-3.5 w-3.5" />
            New Workflow
          </Button>
        </Link>
      </div>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Layers className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Workflows</p>
                <p className="text-[10px] text-green-600 mt-0.5">{stats.published} published</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{stats.requiresApproval}</p>
                <p className="text-xs text-muted-foreground">Require Approval</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{(stats.byRisk.high ?? 0) + (stats.byRisk.critical ?? 0)}</p>
                <p className="text-xs text-muted-foreground">High/Critical Risk</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Activity className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.avgComplexity}</p>
                <p className="text-xs text-muted-foreground">Avg Complexity</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              Risk Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {["low", "medium", "high", "critical"].map(risk => {
              const count = stats?.byRisk[risk] ?? 0;
              const pct = stats?.total ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={risk} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full inline-block ${RISK_DOT[risk]}`} />
                      <span className="capitalize">{risk}</span>
                    </div>
                    <span className="text-muted-foreground">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${RISK_DOT[risk]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              By Category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats && Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#94a3b8" }} />
                <span className="text-xs capitalize flex-1">{cat}</span>
                <span className="text-xs font-medium text-muted-foreground">{count as number}</span>
              </div>
            ))}
            {(!stats || Object.keys(stats.byCategory).length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">No data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Governance congestion */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Governance Congestion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xl font-bold text-amber-600">{graphs.filter((g: any) => g.requiresApproval).length}</p>
                <p className="text-[10px] text-muted-foreground">Approval Required</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xl font-bold text-green-600">{graphs.filter((g: any) => !g.requiresApproval).length}</p>
                <p className="text-[10px] text-muted-foreground">Autonomous</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {graphs.filter((g: any) => (g.governanceWarnings as any[])?.length > 0).slice(0, 4).map((g: any) => (
                <div key={g.id} className="flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                  <span className="truncate text-muted-foreground">{g.name} — {((g.governanceWarnings as any[]) ?? []).length} warning(s)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Complexity heatmap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Workflow Complexity Map
            <Badge variant="secondary" className="text-[10px]">{graphs.length} workflows</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedByComplexity.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No workflows yet</p>
              <Link href="/admin/workflow-builder">
                <Button variant="outline" size="sm" className="mt-3 text-xs gap-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  Build First Workflow
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedByComplexity.map(g => (
                <ComplexityBar
                  key={g.id}
                  name={g.name}
                  value={g.estimatedComplexity ?? 0}
                  max={maxComplexity}
                  riskLevel={g.riskLevel}
                  published={g.published}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Node count grid heatmap */}
      {graphs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Workflow Topology Grid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2">
              {graphs.map((g: any) => (
                <Link key={g.id} href={`/admin/workflow-builder?graphId=${g.id}`}>
                  <div className={`rounded-lg border p-2.5 cursor-pointer hover:shadow-md transition-all ${RISK_BG[g.riskLevel] ?? RISK_BG.low}`} data-testid={`grid-cell-${g.id}`}>
                    <p className="text-xs font-bold truncate">{((g.graphDefinition as any)?.nodes ?? []).length}</p>
                    <p className="text-[10px] mt-0.5 truncate opacity-80">{g.name}</p>
                    {g.published && <CheckCircle className="h-2.5 w-2.5 mt-1 opacity-70" />}
                  </div>
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
              <span>Number = node count</span>
              <span>·</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-green-400" /> low risk</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-amber-400" /> medium</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-red-400" /> high</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
