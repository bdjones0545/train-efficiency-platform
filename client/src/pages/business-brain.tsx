import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  Zap,
  TrendingUp,
  Users,
  Calendar,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  Activity,
  HeartPulse,
  ChevronRight,
  BarChart3,
  UserCheck,
  CircleDot,
  GitBranch,
  Play,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentRecommendation {
  id: string;
  agentType: string;
  crossAgentTypes: string[];
  title: string;
  description: string;
  reason: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  severity: string;
  estimatedImpact: number;
  priorityScore: number;
  status: string;
  actionType: string | null;
  executedAt: string | null;
  dismissedAt: string | null;
  outcomeType: string | null;
  outcomeValue: number;
  createdAt: string;
}

interface AgentSignal {
  id: string;
  agentType: string;
  signalType: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  description: string;
  severity: string;
  score: number;
  createdAt: string;
}

interface ExecutiveBrief {
  id: string;
  healthScore: number;
  biggestOpportunity: Record<string, any>;
  highestChurnRisk: Record<string, any>;
  schedulingInefficiency: Record<string, any>;
  mostValuableLead: Record<string, any>;
  projectedWeeklyRevenue: number;
  recommendedActions: string[];
  agentSummary: Record<string, { signals: number; recommendations: number }>;
  createdAt: string;
}

interface HealthData {
  healthScore: number | null;
  lastRunAt: string | null;
  lastBriefAt: string | null;
}

interface OrchestratorRun {
  id: string;
  triggeredBy: string;
  agentsRun: string[];
  signalsCreated: number;
  recommendationsCreated: number;
  status: string;
  completedAt: string | null;
  createdAt: string;
}

type WorkflowMeta = {
  workflowType: string;
  displayName: string;
  stepCount: number;
  approvalGates: number;
  estimatedDays: number;
  category: string;
};

type WorkflowEligibility = {
  workflowType: string | null;
  workflowMeta: WorkflowMeta | null;
  isDuplicate: boolean;
  existingRunId: string | null;
};

// ─── Config maps ─────────────────────────────────────────────────────────────

const AGENT_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  retention: { label: "Retention", icon: HeartPulse, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950" },
  scheduling: { label: "Scheduling", icon: Calendar, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950" },
  growth: { label: "Growth", icon: TrendingUp, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950" },
  client_success: { label: "Client Success", icon: UserCheck, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950" },
  revenue: { label: "Revenue", icon: Target, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950" },
  executive: { label: "Executive", icon: Brain, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950" },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; badge: "destructive" | "secondary" | "outline" | "default" }> = {
  critical: { label: "Critical", color: "text-red-600 dark:text-red-400", badge: "destructive" },
  high: { label: "High", color: "text-orange-600 dark:text-orange-400", badge: "destructive" },
  medium: { label: "Medium", color: "text-yellow-600 dark:text-yellow-400", badge: "secondary" },
  low: { label: "Low", color: "text-muted-foreground", badge: "outline" },
};

// ─── Health Score Ring ────────────────────────────────────────────────────────

function HealthScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex items-center justify-center" data-testid="health-score-ring">
      <svg width={128} height={128} className="-rotate-90">
        <circle cx={64} cy={64} r={radius} strokeWidth={10} fill="none" className="stroke-muted" />
        <circle
          cx={64} cy={64} r={radius} strokeWidth={10} fill="none"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums" style={{ color }} data-testid="health-score-value">{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Health</span>
      </div>
    </div>
  );
}

// ─── Agent Badge ──────────────────────────────────────────────────────────────

function AgentBadge({ agentType }: { agentType: string }) {
  const cfg = AGENT_CONFIG[agentType];
  if (!cfg) return <Badge variant="outline">{agentType}</Badge>;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Workflow Pill ────────────────────────────────────────────────────────────

function WorkflowPill({ meta, isDuplicate }: { meta: WorkflowMeta; isDuplicate: boolean }) {
  if (isDuplicate) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
        <GitBranch className="w-2.5 h-2.5" /> Workflow active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
      <GitBranch className="w-2.5 h-2.5" /> {meta.stepCount} steps · {meta.approvalGates} gate{meta.approvalGates !== 1 ? "s" : ""}
    </span>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  eligibility,
  onExecute,
  onDismiss,
  onStartWorkflow,
  isPending,
}: {
  rec: AgentRecommendation;
  eligibility?: WorkflowEligibility | null;
  onExecute: (id: string) => void;
  onDismiss: (id: string) => void;
  onStartWorkflow: (rec: AgentRecommendation, workflowType: string) => void;
  isPending: boolean;
}) {
  const [, setLocation] = useLocation();
  const sevCfg = SEVERITY_CONFIG[rec.severity] || SEVERITY_CONFIG.medium;
  const isCrossAgent = rec.crossAgentTypes && rec.crossAgentTypes.length > 0;
  const [expanded, setExpanded] = useState(false);

  const hasWorkflow = !!eligibility?.workflowType;
  const isDuplicate = eligibility?.isDuplicate ?? false;
  const meta = eligibility?.workflowMeta ?? null;

  return (
    <div
      className={`border rounded-xl p-4 bg-card hover:shadow-sm transition-shadow space-y-3 ${rec.severity === "critical" ? "border-red-300 dark:border-red-800" : rec.severity === "high" ? "border-orange-200 dark:border-orange-900" : "border-border"}`}
      data-testid={`rec-card-${rec.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant={sevCfg.badge} className="text-[10px]" data-testid={`badge-severity-${rec.id}`}>{sevCfg.label}</Badge>
            <AgentBadge agentType={rec.agentType} />
            {isCrossAgent && (
              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950" data-testid={`badge-cross-agent-${rec.id}`}>
                <Sparkles className="w-2.5 h-2.5" />
                Cross-Agent
              </span>
            )}
            {rec.entityName && (
              <span className="text-[10px] text-muted-foreground truncate">{rec.entityName}</span>
            )}
            {hasWorkflow && meta && <WorkflowPill meta={meta} isDuplicate={isDuplicate} />}
          </div>
          <p className="font-semibold text-sm leading-snug">{rec.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{rec.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground tabular-nums" data-testid={`score-${rec.id}`}>
            {rec.priorityScore}
          </span>
          {rec.estimatedImpact > 0 && (
            <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
              +${(rec.estimatedImpact / 100).toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Why this matters:</p>
          <p>{rec.reason}</p>
          {isCrossAgent && rec.crossAgentTypes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="font-medium text-foreground">Also flagged by:</span>
              {rec.crossAgentTypes.map((t) => <AgentBadge key={t} agentType={t} />)}
            </div>
          )}
          {hasWorkflow && meta && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <p className="font-medium text-foreground mb-1 flex items-center gap-1">
                <GitBranch className="w-3 h-3" /> Recommended workflow: {meta.displayName}
              </p>
              <p>{meta.stepCount} steps · {meta.approvalGates} approval gate{meta.approvalGates !== 1 ? "s" : ""} · ~{meta.estimatedDays} days</p>
            </div>
          )}
        </div>
      )}

      {/* Workflow start banner */}
      {hasWorkflow && meta && !isDuplicate && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center gap-3"
          data-testid={`workflow-banner-${rec.id}`}>
          <GitBranch className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">{meta.displayName}</p>
            <p className="text-[11px] text-muted-foreground">{meta.stepCount} steps · {meta.approvalGates} approval gate{meta.approvalGates !== 1 ? "s" : ""} · ~{meta.estimatedDays}d</p>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => onStartWorkflow(rec, eligibility!.workflowType!)}
            disabled={isPending}
            data-testid={`button-start-workflow-${rec.id}`}
          >
            <Play className="w-3 h-3 mr-1" /> Start Workflow
          </Button>
        </div>
      )}

      {hasWorkflow && isDuplicate && eligibility?.existingRunId && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-center gap-2"
          data-testid={`workflow-active-banner-${rec.id}`}>
          <GitBranch className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300 flex-1">Workflow already running</p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950"
            onClick={() => setLocation("/admin/workflows")}
            data-testid={`button-view-workflow-${rec.id}`}
          >
            View <ExternalLink className="w-2.5 h-2.5 ml-1" />
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => onExecute(rec.id)}
          disabled={isPending}
          data-testid={`button-execute-${rec.id}`}
        >
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Done
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => onDismiss(rec.id)}
          disabled={isPending}
          data-testid={`button-dismiss-${rec.id}`}
        >
          <XCircle className="w-3 h-3 mr-1" />
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs ml-auto"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`button-expand-${rec.id}`}
        >
          {expanded ? "Less" : "Why?"}
          <ChevronRight className={`w-3 h-3 ml-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </Button>
      </div>
    </div>
  );
}

// ─── Executive Brief Card ─────────────────────────────────────────────────────

function ExecutiveBriefCard({ brief }: { brief: ExecutiveBrief }) {
  const sections = [
    {
      icon: Target,
      label: "Biggest Opportunity",
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950",
      data: brief.biggestOpportunity,
      render: (d: any) =>
        d.title ? (
          <div>
            <p className="font-medium text-sm">{d.title}</p>
            {d.value > 0 && <p className="text-xs text-muted-foreground">${(d.value / 100).toFixed(0)} potential revenue</p>}
          </div>
        ) : <p className="text-xs text-muted-foreground">No opportunity detected yet</p>,
    },
    {
      icon: AlertTriangle,
      label: "Highest Churn Risk",
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950",
      data: brief.highestChurnRisk,
      render: (d: any) =>
        d.clientName ? (
          <div>
            <p className="font-medium text-sm">{d.clientName}</p>
            <p className="text-xs text-muted-foreground capitalize">{d.severity} risk — {d.title}</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">No churn risks detected</p>,
    },
    {
      icon: Calendar,
      label: "Schedule Gap",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950",
      data: brief.schedulingInefficiency,
      render: (d: any) =>
        d.openSlots > 0 ? (
          <div>
            <p className="font-medium text-sm">{d.openSlots} open slots this week</p>
            <p className="text-xs text-muted-foreground">${(d.lostRevenue / 100).toFixed(0)} unrealized · {d.utilizationPct}% utilization</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Schedule is fully utilized</p>,
    },
    {
      icon: TrendingUp,
      label: "Best Lead",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950",
      data: brief.mostValuableLead,
      render: (d: any) =>
        d.prospectName ? (
          <div>
            <p className="font-medium text-sm">{d.prospectName}</p>
            {d.value && <p className="text-xs text-muted-foreground">${(Number(d.value) / 100).toFixed(0)}/yr estimated</p>}
          </div>
        ) : <p className="text-xs text-muted-foreground">No active hot leads</p>,
    },
  ];

  return (
    <Card data-testid="executive-brief-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-indigo-500" />
            Daily Executive Brief
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {new Date(brief.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sections.map(({ icon: Icon, label, color, bg, data, render }) => (
            <div key={label} className={`rounded-xl p-3 ${bg}`}>
              <div className={`flex items-center gap-1.5 mb-2 ${color}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
              </div>
              {render(data || {})}
            </div>
          ))}
        </div>

        {brief.projectedWeeklyRevenue > 0 && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm">Projected weekly revenue:</span>
            <span className="font-bold ml-auto">${(brief.projectedWeeklyRevenue / 100).toFixed(0)}</span>
          </div>
        )}

        {brief.recommendedActions && brief.recommendedActions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Actions</p>
            {brief.recommendedActions.slice(0, 4).map((action, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <CircleDot className="w-3 h-3 mt-0.5 text-indigo-500 shrink-0" />
                <span>{action}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Agent Status Panel ───────────────────────────────────────────────────────

function AgentStatusPanel({ agentSummary }: { agentSummary: Record<string, { signals: number; recommendations: number }> }) {
  const agents = Object.entries(agentSummary);
  if (agents.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="agent-status-panel">
      {agents.map(([type, data]) => {
        const cfg = AGENT_CONFIG[type];
        if (!cfg) return null;
        const Icon = cfg.icon;
        return (
          <div key={type} className={`rounded-xl p-3 ${cfg.bg} flex flex-col gap-1`} data-testid={`agent-stat-${type}`}>
            <div className={`flex items-center gap-1.5 ${cfg.color}`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">{cfg.label}</span>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{data.signals} signals</span>
              <span>{data.recommendations} actions</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BusinessBrainPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");

  const { data: health, isLoading: healthLoading } = useQuery<HealthData>({
    queryKey: ["/api/admin/business-brain/health-score"],
  });

  const { data: brief, isLoading: briefLoading } = useQuery<ExecutiveBrief | null>({
    queryKey: ["/api/admin/business-brain/brief"],
  });

  const { data: feedData, isLoading: feedLoading } = useQuery<{ recommendations: AgentRecommendation[]; signals: AgentSignal[] }>({
    queryKey: ["/api/admin/business-brain/feed"],
  });

  const { data: runs } = useQuery<OrchestratorRun[]>({
    queryKey: ["/api/admin/business-brain/runs"],
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/business-brain/run"),
    onSuccess: () => {
      toast({ title: "Business Brain ran successfully", description: "All agents have analyzed your business." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/brief"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/health-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/runs"] });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const executeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/execute`),
    onSuccess: () => {
      toast({ title: "Marked as done" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/feed"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/feed"] });
    },
  });

  // ── Workflow eligibility (batch check for visible recs) ──────────────────
  const recs = feedData?.recommendations || [];
  const signals = feedData?.signals || [];
  const pending = recs.filter((r) => r.status === "pending");
  const history = recs.filter((r) => r.status !== "pending");
  const crossAgentRecs = pending.filter((r) => r.crossAgentTypes && r.crossAgentTypes.length > 0);

  const { data: eligibilityMap = {} } = useQuery<Record<string, WorkflowEligibility>>({
    queryKey: ["/api/admin/workflows/eligibility", pending.map(r => r.id).join(",")],
    queryFn: async () => {
      if (pending.length === 0) return {};
      const res = await fetch("/api/admin/workflows/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: pending.map(r => ({
            id: r.id,
            agentType: r.agentType,
            actionType: r.actionType,
            entityId: r.entityId,
            source: "brain",
          })),
        }),
      });
      return res.json();
    },
    enabled: pending.length > 0,
    staleTime: 30_000,
  });

  const startWorkflowMutation = useMutation({
    mutationFn: ({ rec, workflowType }: { rec: AgentRecommendation; workflowType: string }) =>
      apiRequest("POST", "/api/admin/workflows/trigger", {
        workflowType,
        entityId: rec.entityId ?? undefined,
        entityName: rec.entityName ?? undefined,
        entityType: rec.entityType ?? undefined,
        triggerReason: rec.description || rec.title,
        triggerSource: "brain_recommendation",
        sourceRecommendationId: rec.id,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.duplicate) {
        toast({ title: "Workflow already running", description: data.error, variant: "default" });
      } else {
        toast({ title: "Workflow started", description: "View it in the Workflows timeline." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/active-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/stats"] });
    },
    onError: (e: Error) => toast({ title: "Failed to start workflow", description: e.message, variant: "destructive" }),
  });

  const healthScore = health?.healthScore ?? null;

  const lastRunStr = health?.lastRunAt
    ? new Date(health.lastRunAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6" data-testid="business-brain-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950">
            <Brain className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight" data-testid="text-page-title">Business Brain</h1>
            <p className="text-sm text-muted-foreground">
              {lastRunStr ? `Last analyzed ${lastRunStr}` : "Run your first analysis below"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/admin/workflows")}
            data-testid="button-view-workflows"
          >
            <GitBranch className="w-4 h-4 mr-1.5" /> Workflows
          </Button>
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            data-testid="button-run-brain"
          >
            {runMutation.isPending ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Analyzing…</>
            ) : (
              <><Zap className="w-4 h-4 mr-2" />Run All Agents</>
            )}
          </Button>
        </div>
      </div>

      {/* Health Score + Agent Summary */}
      {brief && (
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
          <Card className="flex items-center justify-center p-6" data-testid="card-health-score">
            <div className="text-center space-y-2">
              <HealthScoreRing score={healthScore ?? 50} />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{pending.length}</span> actions pending
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{signals.length}</span> signals detected
              </div>
            </div>
          </Card>
          <AgentStatusPanel agentSummary={(brief.agentSummary as any) || {}} />
        </div>
      )}

      {/* Executive Brief */}
      {brief && !briefLoading && <ExecutiveBriefCard brief={brief} />}

      {!brief && !briefLoading && (
        <Card data-testid="card-no-brief">
          <CardContent className="py-10 text-center text-muted-foreground space-y-3">
            <Brain className="w-10 h-10 mx-auto opacity-30" />
            <p className="font-medium">No executive brief yet</p>
            <p className="text-sm">Run all agents to generate your first intelligence report.</p>
          </CardContent>
        </Card>
      )}

      {/* Cross-Agent Insights Banner */}
      {crossAgentRecs.length > 0 && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-4 space-y-2" data-testid="cross-agent-banner">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
            <Sparkles className="w-4 h-4" />
            {crossAgentRecs.length} Cross-Agent Insight{crossAgentRecs.length > 1 ? "s" : ""}
          </div>
          {crossAgentRecs.slice(0, 2).map((r) => (
            <div key={r.id} className="text-sm text-indigo-800 dark:text-indigo-200 flex items-start gap-2">
              <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{r.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Priority Feed */}
      <Card data-testid="card-priority-feed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Unified Priority Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "pending" | "history")}>
            <TabsList className="mb-4" data-testid="tabs-feed">
              <TabsTrigger value="pending" data-testid="tab-pending">
                Actions
                {pending.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px]" data-testid="badge-pending-count">{pending.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              {feedLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : pending.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground space-y-2" data-testid="empty-feed">
                  <CheckCircle2 className="w-10 h-10 mx-auto opacity-30" />
                  <p className="font-medium">All clear — no pending actions</p>
                  <p className="text-sm">Run all agents to generate fresh recommendations.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.map((rec) => (
                    <RecommendationCard
                      key={rec.id}
                      rec={rec}
                      eligibility={eligibilityMap[rec.id] ?? null}
                      onExecute={(id) => executeMutation.mutate(id)}
                      onDismiss={(id) => dismissMutation.mutate(id)}
                      onStartWorkflow={(rec, wt) => startWorkflowMutation.mutate({ rec, workflowType: wt })}
                      isPending={executeMutation.isPending || dismissMutation.isPending || startWorkflowMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              {history.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground" data-testid="empty-history">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No completed or dismissed actions yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((rec) => {
                    const cfg = AGENT_CONFIG[rec.agentType];
                    const Icon = cfg?.icon || Brain;
                    return (
                      <div key={rec.id} className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`history-item-${rec.id}`}>
                        <div className={`p-1.5 rounded-lg ${cfg?.bg || "bg-muted"} shrink-0 mt-0.5`}>
                          <Icon className={`w-3 h-3 ${cfg?.color || "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{rec.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <AgentBadge agentType={rec.agentType} />
                            <Badge
                              variant={rec.status === "executed" ? "default" : "secondary"}
                              className="text-[10px]"
                              data-testid={`badge-status-${rec.id}`}
                            >
                              {rec.status === "executed" ? "Done" : "Dismissed"}
                            </Badge>
                            {rec.outcomeType && (
                              <Badge variant="outline" className="text-[10px] text-green-600">
                                {rec.outcomeType}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(rec.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Run History */}
      {runs && runs.length > 0 && (
        <Card data-testid="card-run-history">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              Recent Agent Runs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center gap-3 text-sm" data-testid={`run-row-${run.id}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${run.status === "completed" ? "bg-green-500" : run.status === "failed" ? "bg-red-500" : "bg-yellow-500"}`} />
                <span className="text-muted-foreground text-xs w-20 shrink-0">
                  {new Date(run.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
                <span className="truncate flex-1">{run.agentsRun?.length || 0} agents · {run.signalsCreated} signals · {run.recommendationsCreated} actions</span>
                <Badge variant="outline" className="text-[10px] capitalize shrink-0">{run.triggeredBy}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
