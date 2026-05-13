import { useState, useEffect, useRef } from "react";
import {
  DashPageHeader,
  DashSectionReveal,
  DashStaggerList,
  DashStatCard,
  DashActionRow,
  DashPriorityCard,
  DashQuickActionGrid,
  DashQuickActionItem,
  DashAlertReveal,
  DashStaggerItem,
  IntelPulseDot,
} from "@/components/DashboardMotion";
import { useAiRevenueToasts } from "@/hooks/use-ai-revenue-toasts";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  DollarSign,
  Target,
  Zap,
  Calendar,
  Users,
  TrendingUp,
  AlertTriangle,
  Clock,
  ChevronRight,
  Bot,
  RefreshCw,
  Star,
  MessageSquare,
  Send,
  CheckCircle,
  ArrowRight,
  Building2,
  Flame,
  Undo2,
  ShieldAlert,
  XCircle,
  Info,
  Brain,
  Activity,
  Sparkles,
  Shield,
  ExternalLink,
  Play,
  X,
  ListChecks,
  BarChart3,
} from "lucide-react";
import { format, parseISO } from "date-fns";

type OpenSlot = {
  date: string;
  startTime: string;
  endTimeStr: string;
  startISO: string;
  endISO: string;
  estimatedValueCents: number;
  suggestedClientName: string | null;
  suggestedClientId: string | null;
  label: string;
};

type ClientOpportunity = {
  clientId: string;
  clientName: string;
  email: string | null;
  type: "should_book" | "renewal_due" | "churn_risk" | "missed_session";
  urgency: "high" | "medium" | "low";
  detail: string;
  estimatedValueCents: number;
  suggestedAction: string;
};

type BestAction = {
  headline: string;
  detail: string;
  actionType: string;
  estimatedValueCents: number;
  clientId: string | null;
  clientName: string | null;
  relatedSlot: Record<string, unknown> | null;
  rank: number;
};

type TeamPipelineEntry = {
  id: string;
  prospectName: string;
  sport: string;
  city: string;
  state: string;
  outreachStatus: string;
  confidenceScore: number;
  contactEmail: string | null;
  lastContactedAt: string | null;
};

type PendingDraft = {
  draftId: string;
  prospectId: string;
  prospectName: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
};

type GlobalAction = {
  id: string;
  actionType: string;
  title: string;
  reason: string;
  priorityScore: number;
  estimatedValue: number;
  confidence: "low" | "medium" | "high";
  sourceType: "prospect" | "deal" | "followup" | "risk";
  prospectId?: string;
  prospectName?: string;
  dealId?: string;
  dealStatus?: string;
  sport?: string;
  city?: string;
};

type GlobalPriorityQueue = {
  topAction: GlobalAction | null;
  topThree: GlobalAction[];
  fullQueue: GlobalAction[];
  generatedAt: string;
};

type AiRevenuePeriod = {
  revenue: number;
  actions: number;
  wonActions: number;
  engagedActions: number;
  avgPerAction: number;
};

type AiRevenueImpactItem = {
  id: string;
  actionType: string;
  actionSource: string;
  prospectName: string | null;
  sport?: string | null;
  outcomeStatus: string;
  outcomeValue: number;
  outcomeTimestamp?: string | null;
  timeToOutcomeHours?: number | null;
  createdAt: string;
};

type AiRevenueOutcomes = {
  today: AiRevenuePeriod;
  week: AiRevenuePeriod;
  month: AiRevenuePeriod;
  autoVsManual: {
    autoCount: number;
    manualCount: number;
    autoRevenue: number;
    manualRevenue: number;
    autoMultiplier: number;
  };
  byActionType: { actionType: string; count: number; revenue: number; avgRevenue: number }[];
  impactFeed: AiRevenueImpactItem[];
  streaks: { daysStreak: number; weeklyWins: number };
  recentlyAttributed: AiRevenueImpactItem[];
};

type CommandCenterData = {
  generatedAt: string;
  timezone: string;
  todayRevenueCents: number;
  openSlotValueTodayCents: number;
  projectedMonthRevenueCents: number;
  monthRevenueCents: number;
  monthGoalCents: number | null;
  revenueGapCents: number | null;
  sessionsNeededToClose: number | null;
  avgSessionValueCents: number;
  daysRemainingInMonth: number;
  daysElapsedInMonth: number;
  todaySchedule: { time: string; clientName: string; service: string; status: string }[];
  openSlotsToday: OpenSlot[];
  openSlotsTomorrow: OpenSlot[];
  bestAction: BestAction | null;
  clientOpportunities: ClientOpportunity[];
  teamPipeline: {
    totalProspects: number;
    highConfidenceLeads: number;
    draftsAwaitingApproval: number;
    repliesNeedingFollowUp: number;
    estimatedPipelineValueCents: number;
    activeLeads: TeamPipelineEntry[];
    pendingDrafts: PendingDraft[];
  };
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

// ─── Unified Action Inbox Types ───────────────────────────────────────────────

type UnifiedAction = {
  id: string;
  source: "brain" | "revenue_agent";
  agentType: string;
  title: string;
  description: string;
  priorityScore: number;
  severity: "critical" | "high" | "medium" | "low";
  estimatedImpact: number;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  status: string;
  crossAgent: boolean;
  deepLinkType: "deal" | "lead" | "client" | "schedule" | null;
  deepLinkUrl: string | null;
  deepLinkLabel: string | null;
};

type BriefSummary = {
  biggestOpportunity: { title?: string; detail?: string; value?: number } | null;
  highestChurnRisk: { name?: string; detail?: string } | null;
  mostValuableLead: { name?: string; detail?: string; value?: number } | null;
  projectedWeeklyRevenue: number;
  recommendedActions: string[];
};

type CommandCenterSummary = {
  healthScore: number | null;
  lastRunAt: string | null;
  briefSummary: BriefSummary | null;
  topActions: UnifiedAction[];
  totalPending: number;
};

// ─── Daily Operator Mode Types ────────────────────────────────────────────────

type ChecklistTask = {
  id: string;
  rank: number;
  category: "revenue" | "churn_prevention" | "schedule_gap" | "lead_follow_up" | "client_success";
  title: string;
  reason: string;
  expectedImpact: number;
  source: "brain" | "revenue_agent";
  sourceId: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  deepLinkType: string | null;
  deepLinkUrl: string | null;
  deepLinkLabel: string | null;
  status: "pending" | "done" | "dismissed";
  priorityScore: number;
  crossAgent: boolean;
  severity: string;
};

type StartMyDayResult = {
  tasks: ChecklistTask[];
  totalGenerated: number;
  healthScore: number | null;
  generatedAt: string;
};

type DayReview = {
  tasksCompleted: number;
  revenueInfluenced: number;
  followUpsSent: number;
  clientsSaved: number;
  dealsAdvanced: number;
  missedOpportunities: number;
  completedItems: { title: string; category: string; impact: number }[];
};

type OperatorScore = {
  todayScore: number;
  streakDays: number;
  actionsHandledToday: number;
  totalActionsToday: number;
};

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  revenue: {
    label: "Revenue Action",
    icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/30",
  },
  churn_prevention: {
    label: "Prevent Churn",
    icon: Shield,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/15",
    border: "border-red-500/30",
  },
  schedule_gap: {
    label: "Fill Schedule",
    icon: Calendar,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/15",
    border: "border-blue-500/30",
  },
  lead_follow_up: {
    label: "Follow Up Lead",
    icon: Building2,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/15",
    border: "border-purple-500/30",
  },
  client_success: {
    label: "Client Success",
    icon: Users,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/15",
    border: "border-cyan-500/30",
  },
} as const;

// ─── Operator Score Bar ────────────────────────────────────────────────────────

function OperatorScoreBar() {
  const { data, isLoading } = useQuery<OperatorScore>({
    queryKey: ["/api/admin/operator-score"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const { todayScore, streakDays, actionsHandledToday, totalActionsToday } = data;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-muted/50 border border-border/60"
      data-testid="card-operator-score"
    >
      {/* Streak */}
      {streakDays >= 1 && (
        <div className="flex items-center gap-1 shrink-0">
          <Flame className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{streakDays}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">day streak</span>
        </div>
      )}

      {/* Score bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">
            {actionsHandledToday}/{totalActionsToday} tasks handled today
          </span>
          <span className="text-xs font-semibold text-foreground">{todayScore}%</span>
        </div>
        <Progress value={todayScore} className="h-1.5" data-testid="progress-operator-score" />
      </div>

      {/* Score label */}
      <div className="shrink-0 text-right">
        <p className={`text-sm font-bold ${
          todayScore >= 80 ? "text-emerald-600 dark:text-emerald-400" :
          todayScore >= 50 ? "text-yellow-600 dark:text-yellow-400" :
          "text-muted-foreground"
        }`} data-testid="text-operator-score">
          {todayScore >= 80 ? "Crushing it" : todayScore >= 50 ? "On track" : todayScore > 0 ? "Getting started" : "Ready to go"}
        </p>
      </div>
    </div>
  );
}

// ─── Day Review Panel ─────────────────────────────────────────────────────────

function DayReviewPanel() {
  const { data, isLoading } = useQuery<DayReview>({
    queryKey: ["/api/admin/day-review"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!data) return null;

  const { tasksCompleted, revenueInfluenced, followUpsSent, clientsSaved, dealsAdvanced, missedOpportunities, completedItems } = data;

  const stats = [
    { label: "Tasks Done", value: tasksCompleted, icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Revenue Influenced", value: revenueInfluenced > 0 ? `$${revenueInfluenced.toLocaleString()}` : "—", icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Follow-ups Sent", value: followUpsSent, icon: Send, color: "text-blue-600 dark:text-blue-400" },
    { label: "Clients Saved", value: clientsSaved, icon: Shield, color: "text-purple-600 dark:text-purple-400" },
    { label: "Deals Advanced", value: dealsAdvanced, icon: TrendingUp, color: "text-primary" },
    { label: "Missed Opps", value: missedOpportunities, icon: AlertTriangle, color: missedOpportunities > 0 ? "text-orange-500" : "text-muted-foreground" },
  ];

  return (
    <div className="space-y-4" data-testid="section-day-review">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s, i) => (
          <Card key={i} className="p-3 text-center" data-testid={`card-review-stat-${i}`}>
            <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
            <p className="text-lg font-bold">{s.value}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
          </Card>
        ))}
      </div>

      {completedItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Completed Today</p>
          <div className="space-y-1.5">
            {completedItems.map((item, i) => {
              const cfg = CATEGORY_CONFIG[item.category as keyof typeof CATEGORY_CONFIG] ?? CATEGORY_CONFIG.revenue;
              const Icon = cfg.icon;
              return (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40" data-testid={`row-completed-${i}`}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                  <p className="text-xs flex-1 min-w-0 truncate">{item.title}</p>
                  {item.impact > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                      ${item.impact.toLocaleString()}
                    </p>
                  )}
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tasksCompleted === 0 && (
        <Card className="p-4 text-center border-dashed" data-testid="card-review-empty">
          <p className="text-sm text-muted-foreground">No tasks completed yet today.</p>
          <p className="text-xs text-muted-foreground mt-1">Complete actions from the checklist to see your impact here.</p>
        </Card>
      )}
    </div>
  );
}

// ─── Daily Operator Mode ──────────────────────────────────────────────────────

function DailyOperatorMode({ openAgentWith }: { openAgentWith: (msg: string) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showReview, setShowReview] = useState(false);

  // Restore checklist from sessionStorage (same-day only)
  const [tasks, setTasks] = useState<ChecklistTask[]>(() => {
    try {
      const stored = sessionStorage.getItem("daily_checklist");
      if (stored) {
        const p = JSON.parse(stored);
        if (p.date === new Date().toISOString().slice(0, 10)) return p.tasks;
      }
    } catch {}
    return [];
  });

  const [localStatus, setLocalStatus] = useState<Record<string, "pending" | "done" | "dismissed">>(() => {
    try {
      const stored = sessionStorage.getItem("daily_checklist_status");
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  function persistStatus(newStatus: Record<string, "pending" | "done" | "dismissed">) {
    setLocalStatus(newStatus);
    sessionStorage.setItem("daily_checklist_status", JSON.stringify(newStatus));
  }

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/start-my-day").then(r => r.json()),
    onSuccess: (data: StartMyDayResult) => {
      setTasks(data.tasks);
      sessionStorage.setItem("daily_checklist", JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        tasks: data.tasks,
      }));
      sessionStorage.setItem("daily_checklist_status", JSON.stringify({}));
      setLocalStatus({});
      toast({
        title: `Your day is ready`,
        description: `${data.tasks.length} prioritized actions · Health score ${data.healthScore ?? "—"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/day-review"] });
    },
    onError: (e: Error) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const executeBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/execute`).then(r => r.json()),
    onSuccess: (_, id) => {
      const ns = { ...localStatus, [id]: "done" as const };
      persistStatus(ns);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/day-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
    },
  });

  const dismissBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/dismiss`).then(r => r.json()),
    onSuccess: (_, id) => {
      const ns = { ...localStatus, [id]: "dismissed" as const };
      persistStatus(ns);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
    },
  });

  const executeRevenueMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/execute`).then(r => r.json()),
    onSuccess: (_, id) => {
      const ns = { ...localStatus, [id]: "done" as const };
      persistStatus(ns);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/day-review"] });
    },
  });

  const dismissRevenueMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/dismiss`).then(r => r.json()),
    onSuccess: (_, id) => {
      const ns = { ...localStatus, [id]: "dismissed" as const };
      persistStatus(ns);
    },
  });

  function handleDone(task: ChecklistTask) {
    if (task.source === "brain") executeBrainMutation.mutate(task.id);
    else executeRevenueMutation.mutate(task.id);
  }

  function handleDismiss(task: ChecklistTask) {
    if (task.source === "brain") dismissBrainMutation.mutate(task.id);
    else dismissRevenueMutation.mutate(task.id);
  }

  function handleNavigate(task: ChecklistTask) {
    if (!task.deepLinkUrl) { openAgentWith(`Help me with: ${task.title}`); return; }
    if (task.deepLinkType === "deal" && task.entityId) sessionStorage.setItem("open_deal_id", task.entityId);
    if (task.deepLinkType === "lead" && task.entityId) sessionStorage.setItem("open_lead_id", task.entityId);
    if (task.deepLinkType === "client" && task.entityId) sessionStorage.setItem("open_client_id", task.entityId);
    setLocation(task.deepLinkUrl);
  }

  const isRunning = startMutation.isPending;
  const hasTasks = tasks.length > 0;
  const visibleTasks = tasks.filter(t => (localStatus[t.id] ?? t.status) !== "dismissed");
  const doneTasks = visibleTasks.filter(t => (localStatus[t.id] ?? t.status) === "done");
  const pendingTasks = visibleTasks.filter(t => (localStatus[t.id] ?? t.status) === "pending");
  const completionPct = hasTasks ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  return (
    <section data-testid="section-daily-operator-mode" className="space-y-4">
      {/* ─── Start My Day Hero Button ─────────────────────────── */}
      {!hasTasks ? (
        <Card
          className="p-5 border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-transparent"
          data-testid="card-start-my-day-empty"
        >
          <div className="text-center space-y-3">
            <div className="inline-flex rounded-full bg-primary/10 p-3 mb-1">
              <Brain className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Start Your Day</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Run a full analysis across all agents — get your ranked execution checklist in seconds.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full sm:w-auto px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              onClick={() => startMutation.mutate()}
              disabled={isRunning}
              data-testid="button-start-my-day"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing your business…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start My Day
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Runs: Brain Analysis · Revenue Agent · Retention Scan · Schedule Gaps · Lead Follow-ups
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* ─── Header row with score + refresh ─────────────── */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Brain className="h-4 w-4 text-primary shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Today's Execution Checklist</h2>
              <Badge
                className={`text-xs py-0 px-1.5 ${
                  completionPct === 100 ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                  completionPct > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
                data-testid="badge-completion"
              >
                {doneTasks.length}/{tasks.length} done
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => setShowReview(v => !v)}
                data-testid="button-toggle-review"
              >
                {showReview ? <Brain className="h-3.5 w-3.5 mr-1" /> : <BarChart3 className="h-3.5 w-3.5 mr-1" />}
                {showReview ? "Checklist" : "Day Review"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => startMutation.mutate()}
                disabled={isRunning}
                data-testid="button-restart-analysis"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* ─── Completion progress ──────────────────────────── */}
          {hasTasks && (
            <div className="space-y-1">
              <Progress value={completionPct} className="h-1.5" data-testid="progress-checklist" />
              {completionPct === 100 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium text-center">
                  All tasks done! Great work today.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Operator Score Bar ───────────────────────────────── */}
      {hasTasks && <OperatorScoreBar />}

      {/* ─── Day Review Toggle ────────────────────────────────── */}
      {showReview && hasTasks && (
        <DashSectionReveal>
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" /> What Happened Today
            </h3>
            <DayReviewPanel />
          </div>
        </DashSectionReveal>
      )}

      {/* ─── Execution Checklist ─────────────────────────────── */}
      {hasTasks && !showReview && (
        <div className="space-y-2.5" data-testid="list-execution-checklist">
          {pendingTasks.map((task) => {
            const cfg = CATEGORY_CONFIG[task.category] ?? CATEGORY_CONFIG.revenue;
            const Icon = cfg.icon;
            const isPending = (localStatus[task.id] ?? task.status) === "pending";

            return (
              <DashStaggerItem key={task.id}>
                <Card
                  className={`p-4 border transition-all ${
                    !isPending ? "opacity-60 bg-muted/30" :
                    task.severity === "critical" ? "border-red-500/30 bg-red-500/3" :
                    task.severity === "high" ? "border-orange-500/30 bg-orange-500/3" :
                    "border-border"
                  }`}
                  data-testid={`card-checklist-task-${task.rank}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Rank + category */}
                    <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                      <div className="text-xs font-black text-muted-foreground/60 leading-none w-5 text-center">
                        {task.rank}
                      </div>
                      <div className={`rounded-full p-1.5 ${cfg.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap mb-0.5">
                        <Badge className={`text-[10px] px-1.5 py-0 border ${cfg.border} ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                        {task.crossAgent && (
                          <Badge className="text-[10px] px-1 py-0 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                            <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Cross-Agent
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-snug" data-testid={`text-task-title-${task.rank}`}>
                        {task.title}
                      </p>
                      {task.entityName && (
                        <p className="text-xs text-muted-foreground mt-0.5">→ {task.entityName}</p>
                      )}
                      {task.reason && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                          {task.reason}
                        </p>
                      )}
                      {task.expectedImpact > 0 && (
                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          ${task.expectedImpact.toLocaleString()} expected impact
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {isPending && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                      <Button
                        size="sm"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                        onClick={() => handleDone(task)}
                        disabled={executeBrainMutation.isPending || executeRevenueMutation.isPending}
                        data-testid={`button-done-task-${task.rank}`}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Done
                      </Button>
                      {task.deepLinkUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs"
                          onClick={() => handleNavigate(task)}
                          data-testid={`button-open-task-${task.rank}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          {task.deepLinkLabel ?? "Open"}
                        </Button>
                      )}
                      {!task.deepLinkUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs"
                          onClick={() => openAgentWith(`Help me execute: ${task.title}. Context: ${task.reason}`)}
                          data-testid={`button-ask-agent-task-${task.rank}`}
                        >
                          <Bot className="h-3.5 w-3.5 mr-1.5" /> Ask Agent
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground"
                        onClick={() => handleDismiss(task)}
                        data-testid={`button-dismiss-task-${task.rank}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}

                  {/* Done overlay */}
                  {!isPending && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <p className="text-xs text-muted-foreground">Handled</p>
                    </div>
                  )}
                </Card>
              </DashStaggerItem>
            );
          })}

          {/* Completed tasks collapsed */}
          {doneTasks.length > 0 && pendingTasks.length === 0 && (
            <Card className="p-4 border-emerald-500/30 bg-emerald-500/5 text-center" data-testid="card-all-done">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold">All tasks complete!</p>
              <p className="text-xs text-muted-foreground mt-1">
                You've handled every priority for today. Check the Day Review for your impact.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setShowReview(true)}
                data-testid="button-see-review"
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> See Day Review
              </Button>
            </Card>
          )}

          {doneTasks.length > 0 && pendingTasks.length > 0 && (
            <div className="text-xs text-muted-foreground text-center py-1">
              {doneTasks.length} completed · {pendingTasks.length} remaining
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Brain Brief Strip ────────────────────────────────────────────────────────

function healthScoreColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function healthScoreBg(score: number | null) {
  if (score === null) return "border-border";
  if (score >= 80) return "border-emerald-500/40 bg-emerald-500/5";
  if (score >= 60) return "border-yellow-500/40 bg-yellow-500/5";
  return "border-red-500/40 bg-red-500/5";
}

function severityStyle(sev: string) {
  switch (sev) {
    case "critical": return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25";
    case "high": return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25";
    case "medium": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25";
    default: return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-transparent";
  }
}

function agentBadgeStyle(agentType: string) {
  const map: Record<string, string> = {
    retention: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    scheduling: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    growth: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    client_success: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    revenue: "bg-primary/15 text-primary",
    executive: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  };
  return map[agentType] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
}

function agentLabel(agentType: string) {
  const map: Record<string, string> = {
    retention: "Retention",
    scheduling: "Scheduling",
    growth: "Growth",
    client_success: "Client Success",
    revenue: "Revenue",
    executive: "Executive",
  };
  return map[agentType] ?? agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

function BrainBriefStrip({ onRunBrain }: { onRunBrain: () => void }) {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<CommandCenterSummary>({
    queryKey: ["/api/admin/business-brain/command-center-summary"],
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const hasData = !isLoading && data;
  const hasScore = hasData && data.healthScore !== null;
  const hasBrief = hasData && data.briefSummary !== null;

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </Card>
    );
  }

  if (!hasScore && !hasBrief) {
    return (
      <Card className="p-4 border-dashed flex items-center gap-4" data-testid="card-brain-brief-empty">
        <div className="rounded-full bg-muted p-3 shrink-0">
          <Brain className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Business Brain not yet analyzed</p>
          <p className="text-xs text-muted-foreground mt-0.5">Run a full analysis to see health score, opportunities, and risks.</p>
        </div>
        <Button size="sm" onClick={onRunBrain} className="shrink-0" data-testid="button-run-brain-strip">
          <Play className="h-3.5 w-3.5 mr-1.5" /> Analyze
        </Button>
      </Card>
    );
  }

  const score = data!.healthScore ?? 0;
  const brief = data!.briefSummary;

  return (
    <Card className={`p-4 border ${healthScoreBg(score)}`} data-testid="card-brain-brief-strip">
      <div className="flex items-start gap-4">
        {/* Health score gauge */}
        <div className="shrink-0 flex flex-col items-center gap-0.5">
          <div className={`text-3xl font-black leading-none ${healthScoreColor(score)}`} data-testid="text-health-score">
            {score}
          </div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Health</p>
          <div className="flex gap-0.5 mt-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`h-1 w-4 rounded-full transition-colors ${
                  i < Math.round(score / 20)
                    ? score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Brief highlights */}
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {brief?.biggestOpportunity?.title && (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Opportunity
              </p>
              <p className="text-xs font-medium mt-0.5 line-clamp-2">{brief.biggestOpportunity.title}</p>
            </div>
          )}
          {brief?.highestChurnRisk?.name && (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-1">
                <Shield className="h-3 w-3" /> Churn Risk
              </p>
              <p className="text-xs font-medium mt-0.5 line-clamp-2">{brief.highestChurnRisk.name}</p>
            </div>
          )}
          {brief?.mostValuableLead?.name && (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Best Lead
              </p>
              <p className="text-xs font-medium mt-0.5 line-clamp-2">{brief.mostValuableLead.name}</p>
            </div>
          )}
          {brief?.projectedWeeklyRevenue != null && brief.projectedWeeklyRevenue > 0 && (
            <div className="min-w-0 sm:col-span-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Projected This Week</p>
              <p className="text-sm font-bold text-foreground">${brief.projectedWeeklyRevenue.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Full analysis link */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs text-muted-foreground hidden sm:flex items-center gap-1"
          onClick={() => setLocation("/admin/business-brain")}
          data-testid="button-full-analysis"
        >
          Full Analysis <ExternalLink className="h-3 w-3" />
        </Button>
      </div>

      {data!.totalPending > 0 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{data!.totalPending}</span> pending action{data!.totalPending !== 1 ? "s" : ""} ranked below
          </p>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setLocation("/admin/business-brain")}
            data-testid="button-view-all-actions"
          >
            View full analysis →
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Unified Action Inbox ─────────────────────────────────────────────────────

function UnifiedActionInbox({ onRunBrain, openAgentWith }: { onRunBrain: () => void; openAgentWith: (msg: string) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<CommandCenterSummary>({
    queryKey: ["/api/admin/business-brain/command-center-summary"],
    staleTime: 120_000,
  });

  const executeBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/execute`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Action marked done", description: "Business Brain has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/health-score"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dismissBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/dismiss`).then(r => r.json()),
    onSuccess: (_, id) => {
      setDismissed(prev => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
    },
  });

  const executeRevenueMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/execute`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Action executed", description: "Revenue action marked done." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/revenue-agent/actions"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dismissRevenueMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/dismiss`).then(r => r.json()),
    onSuccess: (_, id) => {
      setDismissed(prev => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
    },
  });

  function handleExecute(action: UnifiedAction) {
    if (action.source === "brain") {
      executeBrainMutation.mutate(action.id);
    } else {
      executeRevenueMutation.mutate(action.id);
    }
  }

  function handleDismiss(action: UnifiedAction) {
    if (action.source === "brain") {
      dismissBrainMutation.mutate(action.id);
    } else {
      dismissRevenueMutation.mutate(action.id);
    }
  }

  function handleNavigate(action: UnifiedAction) {
    if (!action.deepLinkUrl) {
      openAgentWith(`Help me with: ${action.title}`);
      return;
    }
    if (action.deepLinkType === "deal" && action.entityId) {
      sessionStorage.setItem("open_deal_id", action.entityId);
    }
    if (action.deepLinkType === "lead" && action.entityId) {
      sessionStorage.setItem("open_lead_id", action.entityId);
    }
    if (action.deepLinkType === "client" && action.entityId) {
      sessionStorage.setItem("open_client_id", action.entityId);
    }
    setLocation(action.deepLinkUrl);
  }

  function handleGenerateMessage(action: UnifiedAction) {
    const entityCtx = action.entityName ? ` for ${action.entityName}` : "";
    openAgentWith(`Generate a message${entityCtx}: ${action.title}. Reason: ${action.description}`);
  }

  const visibleActions = (data?.topActions ?? []).filter(a => !dismissed.has(a.id));
  const topAction = visibleActions[0];
  const restActions = visibleActions.slice(1, 5);

  if (isLoading) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-primary" /> Today's Business Priorities
        </h2>
        <Skeleton className="h-40 rounded-xl" />
        <div className="space-y-2 mt-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </section>
    );
  }

  if (!topAction) {
    return (
      <section data-testid="section-unified-inbox">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-primary" /> Today's Business Priorities
        </h2>
        <Card className="p-6 text-center" data-testid="card-inbox-empty">
          <Brain className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium">No pending actions</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Run a Business Brain analysis to generate ranked priorities across all agents.</p>
          <Button size="sm" onClick={onRunBrain} data-testid="button-run-brain-inbox">
            <Play className="h-3.5 w-3.5 mr-1.5" /> Run Analysis
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section data-testid="section-unified-inbox">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-primary" /> Today's Business Priorities
          {data!.totalPending > 0 && (
            <Badge className="ml-1 bg-primary/15 text-primary border-primary/20 text-xs py-0">
              {data!.totalPending}
            </Badge>
          )}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => refetch()}
          data-testid="button-refresh-inbox"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Hero: #1 priority action */}
      <DashPriorityCard variant={topAction.severity === "critical" ? "orange" : undefined}>
        <Card
          className={`p-4 border ${
            topAction.severity === "critical"
              ? "border-red-500/40 bg-gradient-to-br from-red-500/10 to-orange-500/5 dark:from-red-500/15"
              : topAction.severity === "high"
              ? "border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-yellow-500/5 dark:from-orange-500/15"
              : "border-primary/30 bg-primary/5 dark:bg-primary/10"
          }`}
          data-testid="card-top-unified-action"
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-full p-2 shrink-0 ${
              topAction.severity === "critical" ? "bg-red-500/20" :
              topAction.severity === "high" ? "bg-orange-500/20" : "bg-primary/20"
            }`}>
              <Flame className={`h-4 w-4 ${
                topAction.severity === "critical" ? "text-red-500" :
                topAction.severity === "high" ? "text-orange-500" : "text-primary"
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <Badge className={`text-[10px] px-1.5 py-0 border ${severityStyle(topAction.severity)}`}>
                  {topAction.severity.charAt(0).toUpperCase() + topAction.severity.slice(1)}
                </Badge>
                <Badge className={`text-[10px] px-1.5 py-0 ${agentBadgeStyle(topAction.agentType)}`}>
                  {agentLabel(topAction.agentType)}
                </Badge>
                {topAction.crossAgent && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 gap-0.5">
                    <Sparkles className="h-2.5 w-2.5" /> Cross-Agent
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">Score {topAction.priorityScore}</span>
              </div>
              <p className="font-semibold text-sm leading-snug" data-testid="text-top-unified-title">{topAction.title}</p>
              {topAction.entityName && (
                <p className="text-xs text-muted-foreground mt-0.5">→ {topAction.entityName}</p>
              )}
              {topAction.estimatedImpact > 0 && (
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                  Est. ${topAction.estimatedImpact.toLocaleString()} impact
                </p>
              )}
              {expanded.has(topAction.id) && topAction.description && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border/50 pt-2">
                  {topAction.description}
                </p>
              )}
              <button
                className="text-[10px] text-muted-foreground mt-1 hover:text-foreground transition-colors"
                onClick={() => setExpanded(prev => {
                  const s = new Set(prev);
                  s.has(topAction.id) ? s.delete(topAction.id) : s.add(topAction.id);
                  return s;
                })}
              >
                {expanded.has(topAction.id) ? "Hide reason ↑" : "Why? ↓"}
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-4 flex-wrap">
            <Button
              size="sm"
              className="flex-1 sm:flex-none bg-primary hover:bg-primary/90"
              onClick={() => handleExecute(topAction)}
              disabled={executeBrainMutation.isPending || executeRevenueMutation.isPending}
              data-testid="button-execute-top-unified"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Done
            </Button>
            {topAction.deepLinkUrl && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => handleNavigate(topAction)}
                data-testid="button-navigate-top-unified"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> {topAction.deepLinkLabel ?? "Open"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleGenerateMessage(topAction)}
              data-testid="button-message-top-unified"
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Message
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => handleDismiss(topAction)}
              data-testid="button-dismiss-top-unified"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </DashPriorityCard>

      {/* Next 4 priorities */}
      {restActions.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="list-next-unified-actions">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Next Best Actions
          </p>
          {restActions.map((action, i) => (
            <DashStaggerItem key={action.id}>
              <Card
                className="p-3 flex items-start gap-3 hover:border-primary/30 transition-colors"
                data-testid={`card-unified-action-${i}`}
              >
                <div className={`mt-0.5 rounded-full p-1.5 shrink-0 ${
                  action.severity === "critical" ? "bg-red-500/15" :
                  action.severity === "high" ? "bg-orange-500/15" : "bg-primary/10"
                }`}>
                  <ChevronRight className={`h-3 w-3 ${
                    action.severity === "critical" ? "text-red-500" :
                    action.severity === "high" ? "text-orange-500" : "text-primary"
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap mb-0.5">
                    <Badge className={`text-[10px] px-1 py-0 border ${severityStyle(action.severity)}`}>
                      {action.severity}
                    </Badge>
                    <Badge className={`text-[10px] px-1 py-0 ${agentBadgeStyle(action.agentType)}`}>
                      {agentLabel(action.agentType)}
                    </Badge>
                    {action.crossAgent && (
                      <Sparkles className="h-3 w-3 text-indigo-500" />
                    )}
                  </div>
                  <p className="text-sm font-medium leading-snug" data-testid={`text-unified-action-title-${i}`}>
                    {action.title}
                  </p>
                  {action.entityName && (
                    <p className="text-xs text-muted-foreground">→ {action.entityName}</p>
                  )}
                  {action.estimatedImpact > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      ${action.estimatedImpact.toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground font-mono mr-1">{action.priorityScore}</span>
                  {action.deepLinkUrl && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleNavigate(action)}
                      data-testid={`button-navigate-action-${i}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
                    onClick={() => handleExecute(action)}
                    data-testid={`button-execute-action-${i}`}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => handleDismiss(action)}
                    data-testid={`button-dismiss-action-${i}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            </DashStaggerItem>
          ))}
        </div>
      )}

      {/* Footer: view all link */}
      {data!.totalPending > visibleActions.length && (
        <button
          className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-2 border border-dashed border-border rounded-lg transition-colors"
          onClick={() => setLocation("/admin/business-brain")}
          data-testid="button-view-all-brain"
        >
          View all {data!.totalPending} actions in Business Brain →
        </button>
      )}
    </section>
  );
}

// ─── Trigger Alerts Panel ─────────────────────────────────────────────────────

type TriggerAlert = {
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  affectedCount: number;
  suggestedAction: string;
};

type TriggerAlertsResult = {
  alerts: TriggerAlert[];
  hasActive: boolean;
  criticalCount: number;
  warningCount: number;
  topRisk: string | null;
};

function TriggerAlertsPanel() {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<TriggerAlertsResult>({
    queryKey: ["/api/email-agent/trigger-alerts"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading || !data || !data.hasActive) return null;

  const visible = data.alerts.filter((a) => !dismissed.has(a.type));
  if (visible.length === 0) return null;

  function severityStyle(s: TriggerAlert["severity"]) {
    if (s === "critical")
      return "border-red-400/60 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200";
    if (s === "warning")
      return "border-yellow-400/60 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200";
    return "border-blue-300/60 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200";
  }

  function SeverityIcon({ s }: { s: TriggerAlert["severity"] }) {
    if (s === "critical") return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
    if (s === "warning") return <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />;
    return <Info className="h-4 w-4 shrink-0 text-blue-500" />;
  }

  return (
    <section data-testid="section-trigger-alerts">
      <h2
        className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
        onClick={() => setLocation("/admin/trigger-audit")}
        data-testid="heading-trigger-alerts"
      >
        <ShieldAlert className="h-4 w-4 text-red-500" />
        System Alerts
        <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold w-4 h-4">
          {visible.length}
        </span>
      </h2>
      <div className="space-y-2">
        {visible.map((alert) => (
          <div
            key={alert.type}
            className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm ${severityStyle(alert.severity)}`}
            data-testid={`alert-${alert.type.toLowerCase()}`}
          >
            <SeverityIcon s={alert.severity} />
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-snug">{alert.message}</p>
              <p className="text-xs mt-0.5 opacity-75 leading-snug">{alert.suggestedAction}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="text-xs underline opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => setLocation("/admin/trigger-audit")}
                data-testid={`button-view-audit-${alert.type.toLowerCase()}`}
              >
                View
              </button>
              <button
                className="text-xs opacity-40 hover:opacity-80 transition-opacity ml-1"
                onClick={() => setDismissed((prev) => new Set([...prev, alert.type]))}
                aria-label="Dismiss alert"
                data-testid={`button-dismiss-alert-${alert.type.toLowerCase()}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GlobalPriorityPanel() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<GlobalPriorityQueue>({
    queryKey: ["/api/email-agent/intelligence/global-priority"],
    staleTime: 60_000,
  });

  function execute(action: GlobalAction) {
    sessionStorage.setItem(
      "agent_prefill_message",
      `Execute this top priority action: ${action.title}. Reason: ${action.reason}. Estimated value: $${action.estimatedValue.toLocaleString()}.`
    );
    setLocation("/scheduling/agent");
  }

  if (isLoading) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-orange-500" /> Top Priority
        </h2>
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </section>
    );
  }

  if (!data?.topAction) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-orange-500" /> Top Priority
        </h2>
        <Card className="p-4 text-center text-sm text-muted-foreground" data-testid="card-global-priority-empty">
          No high-priority actions identified right now. Add prospects or advance deals to unlock recommendations.
        </Card>
      </section>
    );
  }

  const { topAction, topThree } = data;
  const nextTwo = topThree.slice(1);

  return (
    <section data-testid="section-global-priority">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Flame className="h-4 w-4 text-orange-500" /> Top Priority
      </h2>

      {/* Primary focus card */}
      <DashPriorityCard variant="orange">
      <Card
        className="p-4 border-orange-400/50 bg-gradient-to-br from-orange-500/10 to-red-500/5 dark:from-orange-500/15 dark:to-red-500/10"
        data-testid="card-top-priority"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-orange-500/20 p-2 shrink-0">
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge className="bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30 text-xs">
                Score {topAction.priorityScore}/100
              </Badge>
              <Badge className={`text-xs ${CONFIDENCE_BADGE[topAction.confidence]}`}>
                {topAction.confidence.charAt(0).toUpperCase() + topAction.confidence.slice(1)} confidence
              </Badge>
              {topAction.sport && (
                <Badge variant="outline" className="text-xs">{topAction.sport}</Badge>
              )}
            </div>
            <p className="font-semibold text-base text-foreground leading-tight" data-testid="text-top-priority-title">
              {topAction.title}
            </p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed" data-testid="text-top-priority-reason">
              {topAction.reason}
            </p>
            {topAction.estimatedValue > 0 && (
              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 mt-1">
                Estimated: ${topAction.estimatedValue.toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <Button
          className="w-full mt-4 bg-orange-500 hover:bg-orange-600 text-white"
          size="sm"
          onClick={() => execute(topAction)}
          data-testid="button-execute-top-priority"
        >
          <Zap className="h-4 w-4 mr-1.5" />
          Execute Now
        </Button>
      </Card>
      </DashPriorityCard>

      {/* Next best actions */}
      {nextTwo.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Next Best Actions</p>
          <DashStaggerList className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="list-next-best-actions">
            {nextTwo.map((action, i) => (
              <DashStaggerItem key={action.id} clickable>
              <Card
                className="p-3 flex items-start gap-3 hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => execute(action)}
                data-testid={`card-next-action-${i}`}
              >
                <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 shrink-0">
                  <ChevronRight className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{action.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{action.reason}</p>
                  {action.estimatedValue > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                      ${action.estimatedValue.toLocaleString()}
                    </p>
                  )}
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-xs shrink-0 self-start">
                  {action.priorityScore}
                </Badge>
              </Card>
              </DashStaggerItem>
            ))}
          </DashStaggerList>
        </div>
      )}
    </section>
  );
}

// ─── Auto-Execution Monitor ───────────────────────────────────────────────────
function useAutoExecution() {
  const { toast } = useToast();
  const triggeredRef = useRef(false);

  type EmailAgentSettings = { autoExecuteEnabled?: boolean };
  type AutoExecution = { id: string; actionType: string; title: string; estimatedValue: number };
  type AutoExecResult = { executed: boolean; execution: AutoExecution | null; reason?: string };

  const { data: settings } = useQuery<EmailAgentSettings>({
    queryKey: ["/api/email-agent/settings"],
    staleTime: 30_000,
  });

  const undoMutation = useMutation({
    mutationFn: (executionId: string) =>
      apiRequest("POST", `/api/email-agent/auto-execute/undo/${executionId}`).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Auto-execution undone", description: "The action has been reversed." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/auto-execute/log"] });
    },
    onError: (e: any) => toast({ title: "Undo failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-agent/auto-execute/run").then((r) => r.json()),
    onSuccess: (data: AutoExecResult) => {
      if (!data.executed || !data.execution) return;
      const exec = data.execution;
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/auto-execute/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      toast({
        title: `AI executed: ${exec.actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
        description: (
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-sm leading-tight">{exec.title}</span>
            <button
              className="shrink-0 text-xs font-semibold underline flex items-center gap-1"
              onClick={() => undoMutation.mutate(exec.id)}
              data-testid="button-undo-auto-exec-cmd"
            >
              <Undo2 className="h-3 w-3" />
              Undo (8s)
            </button>
          </div>
        ) as any,
        duration: 8000,
      });
    },
  });

  useEffect(() => {
    if (triggeredRef.current) return;
    if (!settings) return;
    if (!settings.autoExecuteEnabled) return;
    triggeredRef.current = true;
    const timer = setTimeout(() => {
      runMutation.mutate();
    }, 2500);
    return () => clearTimeout(timer);
  }, [settings?.autoExecuteEnabled]);
}

// ─── AI Revenue Panel ─────────────────────────────────────────────────────────
function fmtDollars(dollars: number) {
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toLocaleString()}`;
}

function actionLabel(actionType: string): string {
  const map: Record<string, string> = {
    send_follow_up: "Follow-up",
    generate_draft: "Draft outreach",
    send_initial_email: "Initial email",
    create_deal: "Deal created",
    generate_response: "Response generated",
    schedule_call: "Call scheduled",
    create_proposal: "Proposal sent",
  };
  return map[actionType] ?? actionType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function outcomeStatusBadge(status: string, value: number) {
  switch (status) {
    case "won":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Won {value > 0 ? `· ${fmtDollars(value)}` : ""}
        </span>
      );
    case "engaged":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
          <MessageSquare className="h-3 w-3" />
          Reply received
        </span>
      );
    case "booked":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
          <Calendar className="h-3 w-3" />
          Booked
        </span>
      );
    default:
      return (
        <span className="text-xs text-muted-foreground">Pending outcome</span>
      );
  }
}

function AiImpactHighlight({ data }: { data: AiRevenueOutcomes }) {
  const [idx, setIdx] = useState(0);

  const msgs: string[] = [
    data.week.revenue > 0
      ? `This week: AI generated ${fmtDollars(data.week.revenue)} from ${data.week.wonActions > 0 ? `${data.week.wonActions} win${data.week.wonActions !== 1 ? "s" : ""}` : `${data.week.actions} actions`}`
      : "",
    data.streaks.weeklyWins > 1
      ? `AI closed ${data.streaks.weeklyWins} deals this week`
      : "",
    data.autoVsManual.autoRevenue > 0
      ? `Auto-executed actions: ${fmtDollars(data.autoVsManual.autoRevenue)} earned`
      : "",
    data.byActionType[0]?.revenue > 0
      ? `Best action: ${actionLabel(data.byActionType[0].actionType)} · avg ${fmtDollars(data.byActionType[0].avgRevenue)}/win`
      : "",
  ].filter(Boolean);

  useEffect(() => {
    if (msgs.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % msgs.length), 4000);
    return () => clearInterval(t);
  }, [msgs.length]);

  if (!msgs.length) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/15 rounded-lg mb-3"
      data-testid="card-ai-impact-highlight"
    >
      <Flame className="h-3.5 w-3.5 text-primary flex-shrink-0" />
      <p className="text-xs font-medium text-foreground">{msgs[idx]}</p>
    </div>
  );
}

function AiRevenuePanel() {
  const { data, isLoading } = useQuery<AiRevenueOutcomes>({
    queryKey: ["/api/email-agent/revenue-outcomes"],
    staleTime: 60_000,
  });

  const hasData = !isLoading && data;
  const hasAnyRevenue = hasData && (data.month.revenue > 0 || data.month.actions > 0);
  const recentOutcomes = hasData
    ? data.impactFeed.filter(i => i.outcomeStatus !== "pending").slice(0, 5)
    : [];

  return (
    <section data-testid="section-ai-revenue-panel">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Bot className="h-3.5 w-3.5" />
        AI-Generated Revenue
      </h2>

      {/* Rotating impact highlight */}
      {hasData && hasAnyRevenue && <AiImpactHighlight data={data} />}

      {/* Streak badges */}
      {hasData && (data.streaks.daysStreak >= 2 || data.streaks.weeklyWins > 0) && (
        <div className="flex items-center gap-2 mb-3" data-testid="row-streak-badges">
          {data.streaks.daysStreak >= 2 && (
            <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20 text-xs gap-1">
              <Flame className="h-3 w-3" />
              {data.streaks.daysStreak}-day streak
            </Badge>
          )}
          {data.streaks.weeklyWins > 0 && (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20 text-xs">
              🏆 {data.streaks.weeklyWins} win{data.streaks.weeklyWins !== 1 ? "s" : ""} this week
            </Badge>
          )}
        </div>
      )}

      {/* Revenue stat cards */}
      <DashStaggerList className="grid grid-cols-3 gap-3 mb-3">
        {/* Today */}
        <DashStatCard scanLine>
          <Card className="p-3 space-y-0.5" data-testid="card-ai-revenue-today">
            <p className="text-xs text-muted-foreground">Today</p>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-xl font-bold text-foreground">
                {fmtDollars(data?.today.revenue ?? 0)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {isLoading ? "—" : `${data?.today.wonActions ?? 0} won · ${data?.today.engagedActions ?? 0} engaged`}
            </p>
          </Card>
        </DashStatCard>

        {/* This Week */}
        <DashStatCard scanLine>
          <Card className="p-3 space-y-0.5" data-testid="card-ai-revenue-week">
            <p className="text-xs text-muted-foreground">This Week</p>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-xl font-bold text-foreground">
                {fmtDollars(data?.week.revenue ?? 0)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {isLoading ? "—" : `${data?.week.actions ?? 0} actions tracked`}
            </p>
          </Card>
        </DashStatCard>

        {/* This Month */}
        <DashStatCard scanLine>
          <Card className="p-3 space-y-0.5" data-testid="card-ai-revenue-month">
            <p className="text-xs text-muted-foreground">This Month</p>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-xl font-bold text-primary">
                {fmtDollars(data?.month.revenue ?? 0)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {isLoading ? "—" : data?.month.avgPerAction && data.month.wonActions > 0
                ? `avg ${fmtDollars(data.month.avgPerAction)}/win`
                : `${data?.month.actions ?? 0} actions`}
            </p>
          </Card>
        </DashStatCard>
      </DashStaggerList>

      {/* Impact Feed */}
      {!isLoading && !hasAnyRevenue && (
        <Card className="border-dashed" data-testid="card-ai-revenue-empty">
          <div className="py-5 text-center">
            <TrendingUp className="h-7 w-7 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground font-medium">Revenue tracking starts now</p>
            <p className="text-xs text-muted-foreground mt-1">
              Every AI action — auto-executed or manual — will be tracked here once outcomes are recorded.
            </p>
          </div>
        </Card>
      )}

      {recentOutcomes.length > 0 && (
        <Card data-testid="card-ai-impact-feed">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Impact Feed</p>
          </div>
          <div className="divide-y divide-border">
            {recentOutcomes.map((item) => (
              <div
                key={item.id}
                className="px-4 py-2.5 flex items-start gap-3"
                data-testid={`row-impact-feed-${item.id}`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {item.actionSource === "auto_executed"
                    ? <Zap className="h-3.5 w-3.5 text-primary" />
                    : <Send className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug truncate">
                    {actionLabel(item.actionType)}
                    {item.prospectName ? ` → ${item.prospectName}` : ""}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    {outcomeStatusBadge(item.outcomeStatus, item.outcomeValue)}
                    {item.timeToOutcomeHours != null && (
                      <span className="text-xs text-muted-foreground">
                        {item.timeToOutcomeHours < 24
                          ? `${item.timeToOutcomeHours}h`
                          : `${Math.round(item.timeToOutcomeHours / 24)}d`}
                      </span>
                    )}
                    {item.sport && (
                      <span className="text-xs text-muted-foreground capitalize">{item.sport}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  {item.actionSource === "auto_executed" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/5 text-primary border-primary/20">
                      Auto
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Auto vs Manual efficiency bar (only show when we have data) */}
      {hasData && data.autoVsManual.autoCount > 0 && data.autoVsManual.manualCount > 0 && data.autoVsManual.autoMultiplier > 0 && (
        <Card className="p-3 mt-3 flex items-center gap-3" data-testid="card-ai-vs-manual">
          <Zap className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Auto-executed actions generate{" "}
            <span className="font-semibold text-foreground">{data.autoVsManual.autoMultiplier}×</span>{" "}
            more revenue per action than manual sends
          </p>
        </Card>
      )}
    </section>
  );
}

function fmt$(cents: number) {
  if (cents >= 100000) return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${(cents / 100).toFixed(0)}`;
}

function urgencyColor(urgency: string) {
  if (urgency === "high") return "text-red-600 dark:text-red-400";
  if (urgency === "medium") return "text-yellow-600 dark:text-yellow-400";
  return "text-blue-600 dark:text-blue-400";
}

function opportunityBadge(type: string) {
  switch (type) {
    case "churn_risk": return <Badge variant="destructive" className="text-xs">Churn Risk</Badge>;
    case "renewal_due": return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 text-xs">Renewal Due</Badge>;
    case "should_book": return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30 text-xs">Should Book</Badge>;
    case "missed_session": return <Badge className="bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30 text-xs">Missed Session</Badge>;
    default: return <Badge variant="outline" className="text-xs">{type}</Badge>;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "New": return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30 text-xs">New</Badge>;
    case "Needs Review": return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 text-xs">Needs Review</Badge>;
    case "Approved": return <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 text-xs">Approved</Badge>;
    case "Contacted": return <Badge className="bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30 text-xs">Contacted</Badge>;
    case "Replied": return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">Replied</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export default function BusinessCommandCenterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  useAutoExecution();
  useAiRevenueToasts((opts) =>
    toast({ title: opts.title, description: opts.description, duration: opts.duration })
  );

  const { data, isLoading, refetch, isRefetching } = useQuery<CommandCenterData>({
    queryKey: ["/api/business-command-center"],
  });

  const runBrainMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/business-brain/run").then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Business Brain analysis complete", description: "Health score and priorities have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/health-score"] });
    },
    onError: (e: Error) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  function handleRunBrain() {
    toast({ title: "Running Business Brain analysis…", description: "Analyzing your business across all agents." });
    runBrainMutation.mutate();
  }

  const setGoalMutation = useMutation({
    mutationFn: async (goalCents: number) => {
      const res = await apiRequest("POST", "/api/business-command-center/monthly-goal", { goalCents });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Monthly goal set", description: "Your revenue goal has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/business-command-center"] });
      setGoalDialogOpen(false);
      setGoalInput("");
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function handleSetGoal() {
    const val = parseFloat(goalInput.replace(/[^0-9.]/g, ""));
    if (isNaN(val) || val <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid dollar amount.", variant: "destructive" });
      return;
    }
    setGoalMutation.mutate(Math.round(val * 100));
  }

  function openAgentWith(message: string) {
    // Phase 5 — Agent Voice: inject recent-win context on first open after a win
    let prefill = message;
    if (!message && !sessionStorage.getItem("ai_win_announced")) {
      const winRaw = sessionStorage.getItem("ai_recent_win");
      if (winRaw) {
        try {
          const win = JSON.parse(winRaw);
          sessionStorage.setItem("ai_win_announced", "1");
          prefill = `We just closed ${win.prospectName} for $${win.amount.toLocaleString()}. What should we do next?`;
        } catch {}
      }
    }
    sessionStorage.setItem("agent_prefill_message", prefill);
    setLocation("/scheduling/agent");
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const hasGoal = data.monthGoalCents != null;
  const goalProgress = hasGoal && data.monthGoalCents! > 0
    ? Math.min(100, Math.round((data.monthRevenueCents / data.monthGoalCents!) * 100))
    : null;
  const projectedProgress = hasGoal && data.monthGoalCents! > 0
    ? Math.min(100, Math.round((data.projectedMonthRevenueCents / data.monthGoalCents!) * 100))
    : null;

  const allOpenSlots = [...data.openSlotsToday, ...data.openSlotsTomorrow];

  return (
    <div className="space-y-5 pb-24 sm:pb-6">
      {/* Header */}
      <DashPageHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-command-center-title">Today's Command Center</h1>
            <p className="text-sm text-muted-foreground">
              {format(new Date(), "EEEE, MMMM d")} · {data.daysRemainingInMonth} days left this month
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="shrink-0"
            data-testid="button-refresh-command-center"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </DashPageHeader>

      {/* ─── Daily Operator Mode (Start My Day + Checklist) ──────────────── */}
      <DashSectionReveal>
        <DailyOperatorMode openAgentWith={openAgentWith} />
      </DashSectionReveal>

      {/* ─── Business Brain Intelligence Strip ───────────────────────────── */}
      <DashSectionReveal delay={0.01}>
        <BrainBriefStrip onRunBrain={handleRunBrain} />
      </DashSectionReveal>

      {/* ─── Trigger System Alerts ────────────────────────────────────────── */}
      <DashAlertReveal>
        <TriggerAlertsPanel />
      </DashAlertReveal>

      {/* ─── Unified Action Inbox (Today's Business Priorities) ──────────── */}
      <DashSectionReveal delay={0.02}>
        <UnifiedActionInbox onRunBrain={handleRunBrain} openAgentWith={openAgentWith} />
      </DashSectionReveal>

      {/* ─── AI Revenue Outcome Engine ────────────────────────────────────── */}
      <DashSectionReveal delay={0.04}>
        <AiRevenuePanel />
      </DashSectionReveal>

      {/* ─── Revenue Snapshot ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Revenue Snapshot</h2>
        <DashStaggerList className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <DashStatCard scanLine>
            <Card className="p-4 space-y-1" data-testid="card-revenue-today">
              <p className="text-xs text-muted-foreground">Booked Today</p>
              <p className="text-xl font-bold text-foreground">{fmt$(data.todayRevenueCents)}</p>
            </Card>
          </DashStatCard>
          <DashStatCard scanLine>
            <Card className="p-4 space-y-1" data-testid="card-open-slot-value">
              <p className="text-xs text-muted-foreground">Open Slot Value Today</p>
              <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{fmt$(data.openSlotValueTodayCents)}</p>
            </Card>
          </DashStatCard>
          <DashStatCard className="col-span-2 sm:col-span-1" scanLine>
            <Card className="p-4 space-y-1" data-testid="card-month-revenue">
              <p className="text-xs text-muted-foreground">Month to Date</p>
              <p className="text-xl font-bold">{fmt$(data.monthRevenueCents)}</p>
            </Card>
          </DashStatCard>
        </DashStaggerList>

        {hasGoal ? (
          <Card className="p-4 mt-3 space-y-3" data-testid="card-revenue-goal">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Monthly Goal: {fmt$(data.monthGoalCents!)}</p>
                <p className="text-xs text-muted-foreground">
                  Projected: {fmt$(data.projectedMonthRevenueCents)} · Gap: {fmt$(data.revenueGapCents || 0)} · {data.sessionsNeededToClose ?? 0} sessions needed
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setGoalDialogOpen(true)} data-testid="button-edit-goal">
                Edit
              </Button>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Current: {goalProgress}%</span>
                <span>Projected: {projectedProgress}%</span>
              </div>
              <Progress value={goalProgress ?? 0} className="h-2" data-testid="progress-monthly-goal" />
              <Progress value={projectedProgress ?? 0} className="h-1.5 opacity-50" />
            </div>
          </Card>
        ) : (
          <Card className="p-4 mt-3 flex items-center justify-between gap-3" data-testid="card-no-goal">
            <p className="text-sm text-muted-foreground">Set a monthly goal to unlock revenue recommendations.</p>
            <Button size="sm" onClick={() => setGoalDialogOpen(true)} data-testid="button-set-goal">
              <Target className="h-4 w-4 mr-1" /> Set Goal
            </Button>
          </Card>
        )}
      </section>

      {/* ─── Best Action Today ────────────────────────────────────────────── */}
      {data.bestAction ? (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Best Action Today</h2>
          <DashPriorityCard>
          <Card className="p-4 border-primary/40 bg-primary/5 dark:bg-primary/10" data-testid="card-best-action">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-primary/20 p-2 shrink-0">
                <Star className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground leading-tight" data-testid="text-best-action-headline">
                  {data.bestAction.headline}
                </p>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-best-action-detail">
                  {data.bestAction.detail}
                </p>
                <p className="text-xs text-primary font-medium mt-1">
                  Est. {fmt$(data.bestAction.estimatedValueCents)} opportunity
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => openAgentWith(`Help me take action on: ${data.bestAction!.headline}`)}
                data-testid="button-take-action"
              >
                <Zap className="h-4 w-4 mr-1" /> Take Action
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openAgentWith(`Why is "${data.bestAction!.headline}" your top recommendation today?`)}
                data-testid="button-ask-why"
              >
                Ask Agent Why
              </Button>
            </div>
          </Card>
          </DashPriorityCard>
        </section>
      ) : null}

      {/* ─── Schedule Gaps ────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Schedule Gaps</h2>
          <span className="text-xs text-muted-foreground">{allOpenSlots.length} open slot{allOpenSlots.length !== 1 ? "s" : ""}</span>
        </div>
        {allOpenSlots.length === 0 ? (
          <Card className="p-4 text-center" data-testid="card-no-gaps">
            <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-medium">Schedule is full today and tomorrow!</p>
            <p className="text-xs text-muted-foreground mt-1">No open slots to fill.</p>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="list-schedule-gaps">
            {allOpenSlots.slice(0, 8).map((slot, i) => (
              <DashActionRow key={`${slot.startISO}-${i}`}>
              <Card className="p-3 flex items-center gap-3" data-testid={`card-slot-${i}`}>
                <div className="rounded-lg bg-orange-500/10 p-2 shrink-0">
                  <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{slot.startTime} – {slot.endTimeStr}</p>
                  <p className="text-xs text-muted-foreground">{slot.date}</p>
                  {slot.suggestedClientName && (
                    <p className="text-xs text-primary mt-0.5">Suggested: {slot.suggestedClientName}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmt$(slot.estimatedValueCents)}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs mt-1"
                    onClick={() => openAgentWith(`Help me fill the ${slot.startTime} slot on ${slot.date}`)}
                    data-testid={`button-fill-slot-${i}`}
                  >
                    Fill <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </Card>
              </DashActionRow>
            ))}
          </div>
        )}
      </section>

      {/* ─── Client Revenue Opportunities ─────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Client Opportunities</h2>
          <span className="text-xs text-muted-foreground">{data.clientOpportunities.length}</span>
        </div>
        {data.clientOpportunities.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground" data-testid="card-no-client-opportunities">
            No client opportunities identified yet.
          </Card>
        ) : (
          <div className="space-y-2" data-testid="list-client-opportunities">
            {data.clientOpportunities.slice(0, 8).map((opp, i) => (
              <DashActionRow key={`${opp.clientId}-${opp.type}-${i}`}>
              <Card className="p-3 flex items-start gap-3" data-testid={`card-opportunity-${i}`}>
                <div className={`mt-0.5 shrink-0 ${urgencyColor(opp.urgency)}`}>
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{opp.clientName}</p>
                    {opportunityBadge(opp.type)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{opp.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{fmt$(opp.estimatedValueCents)}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs mt-1"
                    onClick={() => openAgentWith(opp.suggestedAction)}
                    data-testid={`button-act-opportunity-${i}`}
                  >
                    Act <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </Card>
              </DashActionRow>
            ))}
          </div>
        )}
      </section>

      {/* ─── Team Training Pipeline ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Team Training Pipeline</h2>
          <Badge variant="outline" className="text-xs text-muted-foreground">Potential — not booked</Badge>
        </div>
        <DashStaggerList className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <DashStatCard>
            <Card className="p-3 text-center" data-testid="card-pipeline-total">
              <p className="text-lg font-bold">{data.teamPipeline.totalProspects}</p>
              <p className="text-xs text-muted-foreground">Total Leads</p>
            </Card>
          </DashStatCard>
          <DashStatCard>
            <Card className="p-3 text-center" data-testid="card-pipeline-highconf">
              <p className="text-lg font-bold text-primary">{data.teamPipeline.highConfidenceLeads}</p>
              <p className="text-xs text-muted-foreground">High Confidence</p>
            </Card>
          </DashStatCard>
          <DashStatCard>
            <Card className="p-3 text-center" data-testid="card-pipeline-drafts">
              <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{data.teamPipeline.draftsAwaitingApproval}</p>
              <p className="text-xs text-muted-foreground">Drafts Pending</p>
            </Card>
          </DashStatCard>
          <DashStatCard>
            <Card className="p-3 text-center" data-testid="card-pipeline-replies">
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{data.teamPipeline.repliesNeedingFollowUp}</p>
              <p className="text-xs text-muted-foreground">Replies</p>
            </Card>
          </DashStatCard>
        </DashStaggerList>

        {data.teamPipeline.estimatedPipelineValueCents > 0 && (
          <Card className="p-3 mb-3 flex items-center gap-2" data-testid="card-pipeline-value">
            <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Estimated pipeline: <span className="font-semibold text-foreground">{fmt$(data.teamPipeline.estimatedPipelineValueCents)}</span>
              <span className="text-xs"> — potential, not booked revenue</span>
            </p>
          </Card>
        )}

        {data.teamPipeline.pendingDrafts.length > 0 && (
          <div className="space-y-2 mb-3" data-testid="list-pending-drafts">
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" /> Drafts awaiting your approval
            </p>
            {data.teamPipeline.pendingDrafts.map((draft, i) => (
              <Card key={draft.draftId} className="p-3" data-testid={`card-draft-${i}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{draft.prospectName}</p>
                    <p className="text-xs text-muted-foreground truncate">{draft.subject}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{draft.bodyPreview}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs"
                    onClick={() => openAgentWith(`Review and approve the team outreach draft for ${draft.prospectName} (draft ID: ${draft.draftId})`)}
                    data-testid={`button-review-draft-${i}`}
                  >
                    Review
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {data.teamPipeline.activeLeads.length > 0 && (
          <div className="space-y-2" data-testid="list-active-leads">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> Active leads
            </p>
            {data.teamPipeline.activeLeads.map((lead, i) => (
              <Card key={lead.id} className="p-3 flex items-center gap-3" data-testid={`card-lead-${i}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{lead.prospectName}</p>
                    {statusBadge(lead.outreachStatus)}
                  </div>
                  <p className="text-xs text-muted-foreground">{lead.sport} · {lead.city}, {lead.state}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">Conf: {lead.confidenceScore}%</p>
                </div>
              </Card>
            ))}
          </div>
        )}

        {data.teamPipeline.totalProspects === 0 && (
          <Card className="p-4 text-center text-sm text-muted-foreground" data-testid="card-no-team-pipeline">
            No team training prospects yet.{" "}
            <button
              className="text-primary underline"
              onClick={() => openAgentWith("Find me some team training leads")}
              data-testid="button-find-leads"
            >
              Find leads with Agent
            </button>
          </Card>
        )}
      </section>

      {/* ─── Agent Quick Actions ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agent Quick Actions</h2>
        <DashQuickActionGrid className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: "What should I do today?", icon: Flame, msg: "What should I do today to grow my revenue and fill my schedule?" },
            { label: "Fill open slots", icon: Calendar, msg: "Help me fill my open schedule slots for today and tomorrow." },
            { label: "Draft team outreach", icon: Send, msg: "Draft team outreach for my highest-confidence leads." },
            { label: "Review team drafts", icon: MessageSquare, msg: "Show me team outreach drafts waiting for my approval." },
            { label: "Follow up with replies", icon: Users, msg: "Show me team training prospects who replied and need follow-up." },
            { label: "Show revenue gap", icon: TrendingUp, msg: "What is my current revenue gap and what's the fastest way to close it?" },
          ].map((action, i) => (
            <DashQuickActionItem key={action.label}>
              <Button
                variant="outline"
                className="w-full h-auto py-3 flex flex-col items-center gap-1.5 text-center"
                onClick={() => openAgentWith(action.msg)}
                data-testid={`button-quick-action-${i}`}
              >
                <action.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs leading-tight">{action.label}</span>
              </Button>
            </DashQuickActionItem>
          ))}
        </DashQuickActionGrid>
      </section>

      {/* ─── Sticky bottom agent button (mobile) ─────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-sm border-t sm:hidden z-40">
        <Button
          className="w-full"
          size="lg"
          onClick={() => openAgentWith("What should I do today to grow my revenue and fill my schedule?")}
          data-testid="button-sticky-agent"
        >
          <Bot className="h-5 w-5 mr-2" />
          Ask Agent: What Should I Do Today?
        </Button>
      </div>

      {/* ─── Set Goal Dialog ──────────────────────────────────────────────── */}
      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Monthly Revenue Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Enter your monthly revenue target. The command center will track your progress and recommend actions to close the gap.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">$</span>
              <Input
                type="number"
                placeholder="e.g. 10000"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="text-lg"
                min={0}
                data-testid="input-monthly-goal"
              />
            </div>
            {data.monthGoalCents && (
              <p className="text-xs text-muted-foreground">Current goal: {fmt$(data.monthGoalCents)}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalDialogOpen(false)} data-testid="button-cancel-goal">Cancel</Button>
            <Button onClick={handleSetGoal} disabled={setGoalMutation.isPending} data-testid="button-confirm-goal">
              {setGoalMutation.isPending ? "Saving..." : "Save Goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
