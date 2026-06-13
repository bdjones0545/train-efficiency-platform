import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Zap,
  CheckCircle,
  XCircle,
  TrendingUp,
  Activity,
  Target,
  BarChart3,
  RefreshCw,
  Play,
  Clock,
  ArrowRight,
  Star,
  AlertTriangle,
  Shield,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface HermesStats {
  totalRecommendations: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  executed: number;
  approvalRate: number;
  avgConfidence: number;
  lastRunAt: string | null;
  signalsProcessed: number;
  queuedForReview: number;
}

interface HermesHealth {
  status: "healthy" | "degraded" | "offline";
  lastRunAt: string | null;
  signalCount: number;
  issues: string[];
  score: number;
}

interface HermesRec {
  id: string;
  type: string;
  title: string;
  reason: string;
  confidence: number;
  status: string;
  sourceSystem?: string;
  gmailThreadId?: string;
  createdAt: string;
}

interface FeedbackSummary {
  feedback: any[];
  summary: Array<{
    type: string;
    total: number;
    approved: number;
    rejected: number;
    edited: number;
    avgConfidence: number;
    approvalRate: number;
  }>;
}

interface ExecutionMetrics {
  totalExecutions: number;
  completed: number;
  failed: number;
  successRate: number;
  avgLatencyMs: number;
  byType: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusBadge(s: string) {
  const styles: Record<string, string> = {
    pending:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    approved: "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400",
    rejected: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",
    executed: "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[s] ?? styles.pending}`}>
      {s}
    </span>
  );
}

function typeLabel(t: string) {
  const m: Record<string, string> = {
    follow_up:          "Follow-Up",
    prospect_outreach:  "Prospect Outreach",
    lead_recovery:      "Lead Recovery",
    policy_review:      "Policy Review",
    approval_needed:    "Approval Needed",
    engineering_review: "Engineering Review",
  };
  return m[t] ?? t.replace(/_/g, " ");
}

function typeColor(t: string) {
  const m: Record<string, string> = {
    follow_up:          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    prospect_outreach:  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    lead_recovery:      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    policy_review:      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    approval_needed:    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    engineering_review: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };
  return m[t] ?? "bg-gray-100 text-gray-700";
}

function healthColor(status: string) {
  if (status === "healthy")  return "text-green-600 dark:text-green-400";
  if (status === "degraded") return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  stats,
  health,
  onRun,
  running,
}: {
  stats: HermesStats;
  health: HermesHealth;
  onRun: () => void;
  running: boolean;
}) {
  const statCards = [
    { label: "Total Recs", value: stats.totalRecommendations, icon: Brain, color: "text-primary" },
    { label: "Pending Review", value: stats.pendingReview, icon: Clock, color: "text-yellow-500" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, color: "text-green-500" },
    { label: "Rejected", value: stats.rejected, icon: XCircle, color: "text-red-500" },
    { label: "Approval Rate", value: `${stats.approvalRate}%`, icon: TrendingUp, color: "text-emerald-500" },
    { label: "Avg Confidence", value: `${stats.avgConfidence}%`, icon: Target, color: "text-blue-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Health Banner */}
      <Card className={`border ${health.status === "healthy" ? "border-green-200 dark:border-green-900/50" : "border-yellow-200 dark:border-yellow-900/50"}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className={`h-5 w-5 ${healthColor(health.status)}`} />
            <div>
              <p className={`font-semibold text-sm ${healthColor(health.status)}`}>
                Hermes Engine — {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                Score: {health.score}/100 ·{" "}
                {health.lastRunAt
                  ? `Last run: ${new Date(health.lastRunAt).toLocaleString()}`
                  : "Never run"}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={onRun}
            disabled={running}
            className="bg-primary hover:bg-primary/90"
            data-testid="btn-run-hermes"
          >
            {running ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Now
          </Button>
        </CardContent>
      </Card>

      {health.issues.length > 0 && (
        <div className="space-y-1">
          {health.issues.map((issue, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/10 rounded px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {issue}
            </div>
          ))}
        </div>
      )}

      {/* Stat Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {statCards.map((s) => (
          <Card key={s.label} className="border border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Recommendations Tab ──────────────────────────────────────────────────────
function RecommendationsTab({ recs }: { recs: HermesRec[] }) {
  return (
    <div className="space-y-3">
      {recs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Brain className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">No recommendations yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run a Hermes cycle to generate recommendations from live signals.
            </p>
          </CardContent>
        </Card>
      ) : (
        recs.map((rec) => (
          <Card key={rec.id} className="border border-border/60" data-testid={`rec-card-${rec.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(rec.type)}`}>
                      {typeLabel(rec.type)}
                    </span>
                    {statusBadge(rec.status)}
                  </div>
                  <p className="font-medium text-sm mb-1 truncate">{rec.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{rec.reason}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>
                      Confidence:{" "}
                      <span className={`font-bold ${rec.confidence >= 0.8 ? "text-green-600" : rec.confidence >= 0.6 ? "text-yellow-600" : "text-red-600"}`}>
                        {Math.round(rec.confidence * 100)}%
                      </span>
                    </span>
                    <span>{new Date(rec.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {rec.status === "pending" && (
                  <Badge variant="outline" className="shrink-0 text-yellow-600 border-yellow-300">
                    Awaiting Review
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ─── Feedback Learning Tab ────────────────────────────────────────────────────
function FeedbackTab({ data }: { data: FeedbackSummary }) {
  return (
    <div className="space-y-4">
      {data.summary.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <TrendingUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">No feedback data yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Approve or reject recommendations to train Hermes confidence calibration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Approval Rate by Type (last 30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.summary.map((s) => (
                  <div key={s.type} data-testid={`feedback-type-${s.type}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(s.type)}`}>
                        {typeLabel(s.type)}
                      </span>
                      <span className="font-semibold">{s.approvalRate}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${s.approvalRate}%` }}
                      />
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                      <span>{s.approved} approved</span>
                      <span>{s.rejected} rejected</span>
                      <span>{s.edited} edited</span>
                      <span>Avg conf: {s.avgConfidence}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent feedback */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.feedback.slice(0, 8).map((f: any) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      {f.outcome === "approved" ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      ) : f.outcome === "rejected" ? (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      ) : (
                        <Star className="h-3.5 w-3.5 text-yellow-500" />
                      )}
                      <span className="font-medium">{f.recommendation_title ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{f.outcome}</span>
                      <span>{new Date(f.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Execution Outcomes Tab ───────────────────────────────────────────────────
function ExecutionOutcomesTab({ metrics }: { metrics: ExecutionMetrics }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Executed", value: metrics.totalExecutions, icon: Zap, color: "text-primary" },
          { label: "Completed", value: metrics.completed, icon: CheckCircle, color: "text-green-500" },
          { label: "Failed", value: metrics.failed, icon: XCircle, color: "text-red-500" },
          { label: "Success Rate", value: `${metrics.successRate}%`, icon: TrendingUp, color: "text-emerald-500" },
        ].map((s) => (
          <Card key={s.label} className="border border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold" data-testid={`exec-metric-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Avg latency */}
      <Card className="border border-border/60">
        <CardContent className="p-4 flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Average Execution Latency</p>
            <p className="font-bold text-lg" data-testid="exec-metric-avg-latency">
              {metrics.avgLatencyMs}ms
            </p>
          </div>
        </CardContent>
      </Card>

      {/* By type */}
      {Object.keys(metrics.byType).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Executions by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(metrics.byType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(type)}`}>
                      {typeLabel(type)}
                    </span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Top Signals Tab ──────────────────────────────────────────────────────────
function TopSignalsTab({ stats }: { stats: HermesStats }) {
  const signals = [
    { label: "Signals Processed", value: stats.signalsProcessed, icon: Activity },
    { label: "Queued for Review", value: stats.queuedForReview, icon: ArrowRight },
    { label: "Avg Confidence", value: `${stats.avgConfidence}%`, icon: Target },
    { label: "Net Recommendations", value: stats.totalRecommendations, icon: Brain },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {signals.map((s) => (
          <Card key={s.label} className="border border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Signal Sources Monitored
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { label: "Gmail Conversations — open threads needing follow-up", type: "follow_up" },
              { label: "Blocked Outbound Emails — policy review required", type: "policy_review" },
              { label: "Stale Prospects — no contact in 7+ days", type: "prospect_outreach" },
              { label: "Pending Approvals — awaiting review 48h+", type: "approval_needed" },
              { label: "Workflow Failures — 3+ failures in 24h", type: "engineering_review" },
            ].map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-3 text-sm py-1.5 border-b border-border/40 last:border-0"
              >
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${typeColor(s.type)}`}>
                  {typeLabel(s.type)}
                </span>
                <span className="text-muted-foreground text-xs">{s.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Success Rates Tab ────────────────────────────────────────────────────────
function SuccessRatesTab({ feedback, metrics }: { feedback: FeedbackSummary; metrics: ExecutionMetrics }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Overall Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold text-green-600">{metrics.successRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">Execution Success Rate</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-600">
                {feedback.summary.length > 0
                  ? Math.round(
                      feedback.summary.reduce((a, s) => a + s.approvalRate, 0) /
                        feedback.summary.length
                    )
                  : "—"}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">Avg Approval Rate</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-purple-600">{metrics.avgLatencyMs}ms</p>
              <p className="text-xs text-muted-foreground mt-1">Avg Execution Latency</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {feedback.summary.map((s) => (
        <Card key={s.type} data-testid={`success-rate-${s.type}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(s.type)}`}>
                {typeLabel(s.type)}
              </span>
              <span className="text-lg font-bold">{s.approvalRate}% approved</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${s.approvalRate}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-center text-muted-foreground">
              <div>
                <p className="font-semibold text-green-600">{s.approved}</p>
                <p>Approved</p>
              </div>
              <div>
                <p className="font-semibold text-red-600">{s.rejected}</p>
                <p>Rejected</p>
              </div>
              <div>
                <p className="font-semibold text-yellow-600">{s.edited}</p>
                <p>Edited</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminHermesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: stats, isLoading: statsLoading } = useQuery<HermesStats>({
    queryKey: ["/api/hermes/stats"],
    refetchInterval: 30000,
  });

  const { data: health, isLoading: healthLoading } = useQuery<HermesHealth>({
    queryKey: ["/api/hermes/health"],
    refetchInterval: 30000,
  });

  const { data: recsData, isLoading: recsLoading } = useQuery<{ recommendations: HermesRec[] }>({
    queryKey: ["/api/hermes/recommendations"],
    refetchInterval: 30000,
  });

  const { data: feedbackData } = useQuery<FeedbackSummary>({
    queryKey: ["/api/hermes/feedback"],
    refetchInterval: 60000,
  });

  const { data: execMetrics } = useQuery<ExecutionMetrics>({
    queryKey: ["/api/executions/metrics"],
    refetchInterval: 30000,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hermes/run", {}).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hermes/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hermes/recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hermes/health"] });
      toast({
        title: "Hermes cycle complete",
        description: `${data.signalsProcessed ?? 0} signals → ${data.recommendationsGenerated ?? 0} recommendations`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Run failed", description: e?.message, variant: "destructive" });
    },
  });

  const isLoading = statsLoading || healthLoading;

  const defaultStats: HermesStats = {
    totalRecommendations: 0,
    pendingReview: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    approvalRate: 0,
    avgConfidence: 0,
    lastRunAt: null,
    signalsProcessed: 0,
    queuedForReview: 0,
  };

  const defaultHealth: HermesHealth = {
    status: "offline",
    lastRunAt: null,
    signalCount: 0,
    issues: [],
    score: 0,
  };

  const defaultExecMetrics: ExecutionMetrics = {
    totalExecutions: 0,
    completed: 0,
    failed: 0,
    successRate: 0,
    avgLatencyMs: 0,
    byType: {},
  };

  const defaultFeedback: FeedbackSummary = { feedback: [], summary: [] };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Hermes Intelligence
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Recommendations · Approval Rates · Feedback Learning · Execution Outcomes
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          data-testid="btn-run-hermes-header"
        >
          {runMutation.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Run Cycle
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-28 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="recommendations" data-testid="tab-recommendations">
              Recommendations
              {(stats?.pendingReview ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 text-xs">
                  {stats?.pendingReview}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="feedback" data-testid="tab-feedback">Feedback Learning</TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">Top Signals</TabsTrigger>
            <TabsTrigger value="executions" data-testid="tab-executions">Execution Outcomes</TabsTrigger>
            <TabsTrigger value="success" data-testid="tab-success">Success Rates</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5">
            <OverviewTab
              stats={stats ?? defaultStats}
              health={health ?? defaultHealth}
              onRun={() => runMutation.mutate()}
              running={runMutation.isPending}
            />
          </TabsContent>

          <TabsContent value="recommendations" className="mt-5">
            {recsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-24 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : (
              <RecommendationsTab recs={(recsData?.recommendations ?? []) as HermesRec[]} />
            )}
          </TabsContent>

          <TabsContent value="feedback" className="mt-5">
            <FeedbackTab data={feedbackData ?? defaultFeedback} />
          </TabsContent>

          <TabsContent value="signals" className="mt-5">
            <TopSignalsTab stats={stats ?? defaultStats} />
          </TabsContent>

          <TabsContent value="executions" className="mt-5">
            <ExecutionOutcomesTab metrics={execMetrics ?? defaultExecMetrics} />
          </TabsContent>

          <TabsContent value="success" className="mt-5">
            <SuccessRatesTab
              feedback={feedbackData ?? defaultFeedback}
              metrics={execMetrics ?? defaultExecMetrics}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
