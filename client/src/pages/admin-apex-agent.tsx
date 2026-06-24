import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  Play,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Clock,
  CheckCircle,
  Zap,
  BarChart2,
  ShieldCheck,
  Calendar,
  DollarSign,
  Activity,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UrgencyLevel = "critical" | "high" | "medium" | "low";

interface ApexStatus {
  agentType: string;
  agentName: string;
  status: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunSignals: number | null;
  lastRunError: string | null;
  totalActions: number;
  actionsLast30Days: number;
  scheduledInterval: string;
  triggeredBy: string | null;
}

interface Recommendation {
  id: string;
  signalType: string;
  urgency: UrgencyLevel;
  entityType: string;
  entityId: string;
  entityName: string;
  estimatedValue: number;
  staleDays: number;
  recommendedAction: string;
  reasoningSummary: string;
  confidenceScore: number | null;
  riskLevel: string | null;
  createdAt: string | null;
  runId: string | null;
}

interface AuditData {
  table: string;
  actorType: string;
  agentName: string;
  totals: {
    allTime: number;
    last30Days: number;
    completed: number;
    pendingReview: number;
    failed: number;
    firstActionAt: string | null;
    lastActionAt: string | null;
  };
  bySignalType: { signalType: string; count: number; lastSeen: string }[];
  auditNote: string;
}

interface HistoryEntry {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  confidenceScore: number | null;
  riskLevel: string | null;
  reasoningSummary: string | null;
  createdAt: string | null;
  workflowRunId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
};

const URGENCY_ICON: Record<UrgencyLevel, typeof AlertTriangle> = {
  critical: AlertTriangle,
  high: Zap,
  medium: Clock,
  low: Activity,
};

function UrgencyBadge({ urgency }: { urgency: UrgencyLevel }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${URGENCY_COLOR[urgency]}`}>
      {urgency.toUpperCase()}
    </span>
  );
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SignalTypeLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    "apex:stale_active_deal": "Stale Deal",
    "apex:high_value_stale_deal": "High-Value Stale",
    "apex:abandoned_deal": "Abandoned Deal",
    "apex:overdue_followup": "Overdue Follow-up",
    "apex:hot_lead_cooling": "Hot Lead Cooling",
    "apex:uncontacted_high_value_prospect": "Uncontacted Prospect",
    "apex:new_lead_no_action": "New Lead Idle",
    "apex:run_complete": "Run Summary",
  };
  const clean = type.replace("apex:", "");
  return <span>{labels[type] ?? clean.replace(/_/g, " ")}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminApexAgentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("recommendations");

  const statusQ = useQuery<ApexStatus>({
    queryKey: ["/api/agents/apex/status"],
    refetchInterval: 30_000,
  });

  const recsQ = useQuery<{ recommendations: Recommendation[]; total: number }>({
    queryKey: ["/api/agents/apex/recommendations"],
  });

  const auditQ = useQuery<AuditData>({
    queryKey: ["/api/agents/apex/audit"],
  });

  const historyQ = useQuery<{ entries: HistoryEntry[]; total: number }>({
    queryKey: ["/api/agents/apex/history"],
  });

  const runMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agents/apex/run"),
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Apex run complete" : "Apex run finished with error",
        description: data.success
          ? `${data.signalsDetected} signal${data.signalsDetected !== 1 ? "s" : ""} detected in ${fmtMs(data.durationMs)}`
          : data.error ?? "Check logs for details",
      });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/status"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/recommendations"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/audit"] });
      qc.invalidateQueries({ queryKey: ["/api/agents/apex/history"] });
    },
    onError: () => {
      toast({ title: "Run failed", description: "Could not trigger Apex", variant: "destructive" });
    },
  });

  const status = statusQ.data;
  const recs = recsQ.data?.recommendations ?? [];
  const audit = auditQ.data;
  const history = historyQ.data?.entries ?? [];

  const criticalCount = recs.filter(r => r.urgency === "critical").length;
  const highCount = recs.filter(r => r.urgency === "high").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Target className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Apex — Growth Agent</h1>
            <p className="text-sm text-muted-foreground">
              Scores leads, detects stale deals, and surfaces ranked follow-up recommendations daily
            </p>
          </div>
        </div>
        <Button
          data-testid="button-apex-run"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="gap-2"
        >
          {runMut.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {runMut.isPending ? "Running…" : "Run Now"}
        </Button>
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Status</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                status?.status === "idle" ? "bg-green-500" :
                status?.status === "error" ? "bg-red-500" :
                "bg-gray-400"
              }`} />
              <span className="text-sm font-semibold capitalize" data-testid="text-apex-status">
                {statusQ.isLoading ? "…" : status?.status === "never_run" ? "Ready" : (status?.status ?? "—")}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Actions</p>
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400" data-testid="text-apex-total-actions">
              {statusQ.isLoading ? "…" : (status?.totalActions ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last 30 Days</p>
            <p className="text-2xl font-bold text-foreground" data-testid="text-apex-30d-actions">
              {statusQ.isLoading ? "…" : (status?.actionsLast30Days ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last Run</p>
            <p className="text-xs font-medium text-foreground" data-testid="text-apex-last-run">
              {statusQ.isLoading ? "…" : fmtTs(status?.lastRunAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Urgent alerts */}
      {(criticalCount > 0 || highCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              {criticalCount} critical signal{criticalCount !== 1 ? "s" : ""} need immediate attention
            </div>
          )}
          {highCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 text-sm font-medium">
              <Zap className="h-4 w-4" />
              {highCount} high-priority signal{highCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="recommendations" data-testid="tab-apex-recommendations">
            Recommendations {recs.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold">{recs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-apex-audit">Audit</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-apex-history">Action Log</TabsTrigger>
        </TabsList>

        {/* Recommendations */}
        <TabsContent value="recommendations" className="space-y-3 mt-4">
          {recsQ.isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading recommendations…</div>
          )}
          {!recsQ.isLoading && recs.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No signals in the last 7 days</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run Apex to scan your pipeline for stale deals, cooling leads, and overdue follow-ups.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-2"
                  onClick={() => runMut.mutate()}
                  disabled={runMut.isPending}
                  data-testid="button-apex-run-empty"
                >
                  <Play className="h-3 w-3" />
                  Run Apex Now
                </Button>
              </CardContent>
            </Card>
          )}
          {recs.map((rec, i) => {
            const Icon = URGENCY_ICON[rec.urgency] ?? Activity;
            return (
              <Card key={rec.id} data-testid={`card-apex-rec-${rec.id}`} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      rec.urgency === "critical" ? "bg-red-100 dark:bg-red-900/30" :
                      rec.urgency === "high" ? "bg-orange-100 dark:bg-orange-900/30" :
                      rec.urgency === "medium" ? "bg-yellow-100 dark:bg-yellow-900/30" :
                      "bg-blue-100 dark:bg-blue-900/30"
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        rec.urgency === "critical" ? "text-red-600 dark:text-red-400" :
                        rec.urgency === "high" ? "text-orange-600 dark:text-orange-400" :
                        rec.urgency === "medium" ? "text-yellow-600 dark:text-yellow-400" :
                        "text-blue-600 dark:text-blue-400"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium text-foreground">#{i + 1}</span>
                        <UrgencyBadge urgency={rec.urgency} />
                        <Badge variant="outline" className="text-[10px]">
                          <SignalTypeLabel type={`apex:${rec.signalType}`} />
                        </Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{rec.entityType}</Badge>
                        {rec.estimatedValue > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <DollarSign className="h-3 w-3" />
                            {rec.estimatedValue.toLocaleString()}
                          </span>
                        )}
                        {rec.staleDays > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {rec.staleDays}d stale
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground mb-1">{rec.recommendedAction}</p>
                      <p className="text-xs text-muted-foreground">{rec.reasoningSummary}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                        {rec.confidenceScore != null && (
                          <span>{Math.round(rec.confidenceScore * 100)}% confidence</span>
                        )}
                        <span>{fmtTs(rec.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          {auditQ.isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading audit data…</div>
          )}
          {audit && (
            <>
              <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Audit Proof</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{audit.auditNote}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Total Actions", value: audit.totals.allTime, color: "text-violet-600 dark:text-violet-400", testId: "text-audit-total" },
                  { label: "Last 30 Days", value: audit.totals.last30Days, color: "text-foreground", testId: "text-audit-30d" },
                  { label: "Pending Review", value: audit.totals.pendingReview, color: "text-amber-600 dark:text-amber-400", testId: "text-audit-pending" },
                  { label: "Completed", value: audit.totals.completed, color: "text-emerald-600 dark:text-emerald-400", testId: "text-audit-completed" },
                  { label: "Failed", value: audit.totals.failed, color: "text-red-600 dark:text-red-400", testId: "text-audit-failed" },
                ].map(kpi => (
                  <Card key={kpi.label}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                      <p className={`text-2xl font-bold ${kpi.color}`} data-testid={kpi.testId}>
                        {kpi.value.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Breakdown by Signal Type</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {audit.bySignalType.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-4 py-6 text-center">
                      No actions recorded yet — run Apex to populate
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left py-2 px-4 font-medium">Signal Type</th>
                          <th className="text-right py-2 px-4 font-medium">Count</th>
                          <th className="text-right py-2 px-4 font-medium">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.bySignalType.map(row => (
                          <tr key={row.signalType} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 px-4 font-mono text-xs">{row.signalType}</td>
                            <td className="py-2 px-4 text-right font-semibold">{row.count}</td>
                            <td className="py-2 px-4 text-right text-muted-foreground text-xs">{fmtTs(row.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Table: </span>
                      <code className="font-mono">{audit.table}</code>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">actor_type filter: </span>
                      <code className="font-mono">'{audit.actorType}'</code>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">First action: </span>
                      {fmtTs(audit.totals.firstActionAt)}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Latest action: </span>
                      {fmtTs(audit.totals.lastActionAt)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-violet-500" />
                unified_agent_action_log — actor_type = 'growth_agent'
                <Badge variant="outline" className="text-[10px]">{history.length} entries</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historyQ.isLoading && (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">Loading…</p>
              )}
              {!historyQ.isLoading && history.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">
                  No entries yet — run Apex to generate the first actions
                </p>
              )}
              {history.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Action Type</th>
                        <th className="text-left py-2 px-3 font-medium">Entity</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Risk</th>
                        <th className="text-left py-2 px-3 font-medium">Confidence</th>
                        <th className="text-left py-2 px-3 font-medium">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(entry => (
                        <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-apex-log-${entry.id}`}>
                          <td className="py-2 px-3 font-mono">{entry.actionType}</td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {entry.entityType ? `${entry.entityType}` : "—"}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              entry.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                              entry.status === "requires_approval" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                              entry.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
                              "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            }`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 capitalize">{entry.riskLevel ?? "—"}</td>
                          <td className="py-2 px-3">
                            {entry.confidenceScore != null ? `${Math.round(entry.confidenceScore * 100)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{fmtTs(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
