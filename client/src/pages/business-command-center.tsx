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
  Brain,
  Activity,
  Sparkles,
  Shield,
  ExternalLink,
  Play,
  X,
  ListChecks,
  BarChart3,
  Plug,
  GitBranch,
  Inbox,
  AlertCircle,
  Lightbulb,
  CalendarCheck,
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

// ─── Top Attention Strip ──────────────────────────────────────────────────────
// Shows top 1-3 critical/important attention items from the Unified Attention
// System. All other alerts are routed to the full Attention Inbox.

type AttentionPreviewItem = {
  id: string;
  level: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  score: number;
  status: string;
};

const ATTENTION_LEVEL_STYLE: Record<string, { bg: string; border: string; icon: typeof AlertTriangle; iconCls: string; badge: string }> = {
  critical: {
    bg: "bg-red-500/8 dark:bg-red-950/20",
    border: "border-red-400/30",
    icon: AlertTriangle,
    iconCls: "text-red-500",
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  },
  escalated: {
    bg: "bg-red-500/8 dark:bg-red-950/20",
    border: "border-red-400/30",
    icon: AlertTriangle,
    iconCls: "text-red-500",
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  },
  important: {
    bg: "bg-amber-500/8 dark:bg-amber-950/20",
    border: "border-amber-400/30",
    icon: AlertCircle,
    iconCls: "text-amber-500",
    badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  },
  suggested: {
    bg: "bg-violet-500/5 dark:bg-violet-950/10",
    border: "border-violet-300/30",
    icon: Lightbulb,
    iconCls: "text-violet-500",
    badge: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
  },
};

function TopAttentionStrip() {
  const [, setLocation] = useLocation();

  const { data: items = [] } = useQuery<AttentionPreviewItem[]>({
    queryKey: ["/api/attention"],
    refetchInterval: 3 * 60 * 1000,
    staleTime: 90_000,
  });

  const active = items.filter(
    (i) => i.status === "active" || i.status === "escalated"
  );
  const priority = active.filter(
    (i) => i.level === "critical" || i.level === "important" || i.status === "escalated"
  );

  if (priority.length === 0) return null;

  const top = priority.slice(0, 3);
  const remaining = active.length - top.length;

  return (
    <div className="space-y-1.5" data-testid="strip-top-attention">
      {top.map((item) => {
        const effectiveLevel = item.status === "escalated" ? "escalated" : item.level;
        const style = ATTENTION_LEVEL_STYLE[effectiveLevel] ?? ATTENTION_LEVEL_STYLE.important;
        const Icon = style.icon;
        const dest = item.actionUrl ?? "/admin/attention";
        return (
          <div
            key={item.id}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border ${style.bg} ${style.border}`}
            data-testid={`strip-attention-item-${item.id}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${style.iconCls}`} />
            <p className="text-sm font-medium flex-1 min-w-0 truncate">{item.title}</p>
            <button
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${style.badge}`}
              onClick={() => setLocation(dest)}
              data-testid={`button-attention-action-${item.id}`}
            >
              {item.actionLabel ?? "View"}
            </button>
          </div>
        );
      })}
      {(remaining > 0 || active.length > 3) && (
        <button
          className="flex items-center gap-1.5 px-3.5 py-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setLocation("/admin/attention")}
          data-testid="link-attention-view-all-strip"
        >
          <Inbox className="h-3.5 w-3.5" />
          <span>
            {remaining > 0
              ? `+${remaining} more item${remaining !== 1 ? "s" : ""} in Attention Inbox`
              : "View all in Attention Inbox"}
          </span>
          <ArrowRight className="h-3 w-3 ml-auto" />
        </button>
      )}
    </div>
  );
}

// ─── Workflow Status Strip ────────────────────────────────────────────────────

type WorkflowActiveSummary = {
  total: number;
  needingApproval: number;
  runs: Array<{
    id: string;
    workflowType: string;
    displayName: string;
    status: string;
    entityName: string | null;
    currentStepIndex: number | null;
    totalSteps: number | null;
  }>;
};

function WorkflowStatusStrip() {
  const [, setLocation] = useLocation();

  const { data } = useQuery<WorkflowActiveSummary>({
    queryKey: ["/api/admin/workflows/active-summary"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!data || data.total === 0) return null;

  const approvalNeeded = data.needingApproval > 0;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border ${
        approvalNeeded
          ? "bg-amber-500/10 border-amber-500/30"
          : "bg-primary/5 border-primary/20"
      }`}
      data-testid="strip-workflow-status"
    >
      <div className="flex items-center gap-2 min-w-0">
        <GitBranch className={`h-4 w-4 shrink-0 ${approvalNeeded ? "text-amber-500" : "text-primary"}`} />
        <div className="min-w-0">
          <p className={`text-sm font-medium truncate ${approvalNeeded ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
            <span className="font-bold">{data.total}</span> active workflow{data.total > 1 ? "s" : ""}
            {approvalNeeded && (
              <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                · <span className="font-bold">{data.needingApproval}</span> need{data.needingApproval === 1 ? "s" : ""} approval
              </span>
            )}
          </p>
          {data.runs.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              {data.runs.slice(0, 2).map(r => r.displayName || r.workflowType).join(" · ")}
              {data.runs.length > 2 && ` + ${data.runs.length - 2} more`}
            </p>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className={`h-7 text-xs shrink-0 ${
          approvalNeeded
            ? "border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
            : "border-primary/30 text-primary hover:bg-primary/10"
        }`}
        onClick={() => setLocation("/admin/workflows")}
        data-testid="button-view-workflows-strip"
      >
        View
      </Button>
    </div>
  );
}

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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
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

  const [toolCallFeedbackDOM, setToolCallFeedbackDOM] = useState<Record<string, { requiresConfirmation: boolean; toolCallId: string; success: boolean }>>({});

  const executeBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/execute`).then(r => r.json()),
    onSuccess: (data: any, id) => {
      const ns = { ...localStatus, [id]: "done" as const };
      persistStatus(ns);
      if (data?.toolCall) {
        setToolCallFeedbackDOM(prev => ({ ...prev, [id]: { requiresConfirmation: data.toolCall.requiresConfirmation, toolCallId: data.toolCall.toolCallId, success: data.toolCall.success } }));
        if (data.toolCall.requiresConfirmation) {
          toast({ title: "Action queued for approval", description: `${data.toolCall.message} — check Agent Tools.` });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/day-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
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
    onSuccess: (data: any, id) => {
      const ns = { ...localStatus, [id]: "done" as const };
      persistStatus(ns);
      if (data?.toolCall) {
        setToolCallFeedbackDOM(prev => ({ ...prev, [id]: { requiresConfirmation: data.toolCall.requiresConfirmation, toolCallId: data.toolCall.toolCallId, success: data.toolCall.success } }));
        if (data.toolCall.requiresConfirmation) {
          toast({ title: "Action queued for approval", description: `${data.toolCall.message} — check Agent Tools.` });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/operator-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/day-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
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
                        {(executeBrainMutation.isPending || executeRevenueMutation.isPending) ? (
                          <><span className="animate-spin mr-1.5">⟳</span> Running...</>
                        ) : (
                          <><CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Execute</>
                        )}
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
                      {toolCallFeedbackDOM[task.id]?.requiresConfirmation ? (
                        <>
                          <Clock className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          <p className="text-xs text-orange-600 dark:text-orange-400">Awaiting Approval</p>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <p className="text-xs text-muted-foreground">{toolCallFeedbackDOM[task.id] ? "Executed" : "Handled"}</p>
                        </>
                      )}
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
  const [toolCallFeedback, setToolCallFeedback] = useState<Record<string, { requiresConfirmation: boolean; toolCallId: string; success: boolean; toolName?: string }>>({});

  const { data, isLoading, refetch } = useQuery<CommandCenterSummary>({
    queryKey: ["/api/admin/business-brain/command-center-summary"],
    staleTime: 120_000,
  });

  const executeBrainMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/business-brain/recommendations/${id}/execute`).then(r => r.json()),
    onSuccess: (data: any, id) => {
      if (data?.toolCall) {
        setToolCallFeedback(prev => ({ ...prev, [id]: { requiresConfirmation: data.toolCall.requiresConfirmation, toolCallId: data.toolCall.toolCallId, success: data.toolCall.success ?? true, toolName: data.toolCall.message } }));
        toast({
          title: data.toolCall.requiresConfirmation ? "Queued for approval" : "Action executed",
          description: data.toolCall.message,
        });
      } else {
        toast({ title: "Action marked done", description: "Business Brain has been updated." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/health-score"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
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
    onSuccess: (data: any, id) => {
      if (data?.toolCall) {
        setToolCallFeedback(prev => ({ ...prev, [id]: { requiresConfirmation: data.toolCall.requiresConfirmation, toolCallId: data.toolCall.toolCallId, success: data.toolCall.success ?? true, toolName: data.toolCall.message } }));
        toast({
          title: data.toolCall.requiresConfirmation ? "Queued for approval" : "Action executed",
          description: data.toolCall.message,
        });
      } else {
        toast({ title: "Action executed", description: "Revenue action marked done." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-brain/command-center-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/revenue-agent/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
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

  // ── Workflow eligibility ──────────────────────────────────────────────────
  type WorkflowEligibility = {
    workflowType: string | null;
    workflowMeta: { workflowType: string; displayName: string; stepCount: number; approvalGates: number; estimatedDays: number } | null;
    isDuplicate: boolean;
    existingRunId: string | null;
  };

  const visibleForEligibility = (data?.topActions ?? []);
  const { data: eligibilityMap = {} } = useQuery<Record<string, WorkflowEligibility>>({
    queryKey: ["/api/admin/workflows/eligibility", visibleForEligibility.map(a => a.id).join(",")],
    queryFn: async () => {
      if (visibleForEligibility.length === 0) return {};
      const res = await fetch("/api/admin/workflows/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: visibleForEligibility.map(a => ({
            id: a.id,
            agentType: a.agentType,
            actionType: a.actionType,
            entityId: a.entityId,
            source: a.source,
          })),
        }),
      });
      return res.json();
    },
    enabled: visibleForEligibility.length > 0,
    staleTime: 30_000,
  });

  const startWorkflowMutation = useMutation({
    mutationFn: (action: UnifiedAction) => {
      const elig = eligibilityMap[action.id];
      if (!elig?.workflowType) throw new Error("No workflow mapped for this action");
      return apiRequest("POST", "/api/admin/workflows/trigger", {
        workflowType: elig.workflowType,
        entityId: action.entityId ?? undefined,
        entityName: action.entityName ?? undefined,
        entityType: action.entityType ?? undefined,
        triggerReason: action.description || action.title,
        triggerSource: action.source === "brain" ? "brain_recommendation" : "revenue_agent_action",
        sourceRecommendationId: action.source === "brain" ? action.id : undefined,
        sourceRevenueActionId: action.source === "revenue_agent" ? action.id : undefined,
      }).then(r => r.json());
    },
    onSuccess: (result: any) => {
      if (result.duplicate) {
        toast({ title: "Workflow already running", description: result.error });
      } else {
        toast({ title: "Workflow started", description: "View progress in the Workflows timeline." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/active-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows/stats"] });
    },
    onError: (e: Error) => toast({ title: "Failed to start workflow", description: e.message, variant: "destructive" }),
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
            {toolCallFeedback[topAction.id] ? (
              toolCallFeedback[topAction.id].requiresConfirmation ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 sm:flex-none border-orange-400 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                  onClick={() => setLocation("/admin/agent-tools")}
                  data-testid="button-execute-top-unified"
                >
                  <Clock className="h-3.5 w-3.5 mr-1.5" /> Needs Approval
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="flex-1 sm:flex-none bg-emerald-600 text-white cursor-default"
                  disabled
                  data-testid="button-execute-top-unified"
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Executed ✓
                </Button>
              )
            ) : (
              <Button
                size="sm"
                className="flex-1 sm:flex-none bg-primary hover:bg-primary/90"
                onClick={() => handleExecute(topAction)}
                disabled={executeBrainMutation.isPending || executeRevenueMutation.isPending}
                data-testid="button-execute-top-unified"
              >
                {(executeBrainMutation.isPending || executeRevenueMutation.isPending) ? (
                  <><span className="animate-spin mr-1.5 inline-block">⟳</span> Running...</>
                ) : (
                  <><CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Execute</>
                )}
              </Button>
            )}
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
            {(() => {
              const elig = eligibilityMap[topAction.id];
              if (!elig?.workflowType) return null;
              if (elig.isDuplicate) {
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-none border-emerald-400/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                    onClick={() => setLocation("/admin/workflows")}
                    data-testid="button-view-workflow-top-unified"
                  >
                    <GitBranch className="h-3.5 w-3.5 mr-1.5" /> Workflow Active
                  </Button>
                );
              }
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 sm:flex-none border-primary/40 text-primary hover:bg-primary/10"
                  onClick={() => startWorkflowMutation.mutate(topAction)}
                  disabled={startWorkflowMutation.isPending}
                  data-testid="button-start-workflow-top-unified"
                >
                  <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                  {elig.workflowMeta ? elig.workflowMeta.displayName : "Start Workflow"}
                </Button>
              );
            })()}
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
                  {(() => {
                    const elig = eligibilityMap[action.id];
                    if (!elig?.workflowType) return null;
                    if (elig.isDuplicate) {
                      return (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
                          onClick={() => setLocation("/admin/workflows")}
                          title="Workflow already running — view"
                          data-testid={`button-workflow-active-action-${i}`}
                        >
                          <GitBranch className="h-3.5 w-3.5" />
                        </Button>
                      );
                    }
                    return (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-primary"
                        onClick={() => startWorkflowMutation.mutate(action)}
                        disabled={startWorkflowMutation.isPending}
                        title={elig.workflowMeta ? `Start: ${elig.workflowMeta.displayName}` : "Start Workflow"}
                        data-testid={`button-start-workflow-action-${i}`}
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                      </Button>
                    );
                  })()}
                  {toolCallFeedback[action.id] ? (
                    toolCallFeedback[action.id].requiresConfirmation ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-orange-500"
                        onClick={() => setLocation("/admin/agent-tools")}
                        title="Needs approval — click to review"
                        data-testid={`button-execute-action-${i}`}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
                        disabled
                        data-testid={`button-execute-action-${i}`}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                    )
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
                      onClick={() => handleExecute(action)}
                      data-testid={`button-execute-action-${i}`}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
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

function GlobalPriorityPanel() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<GlobalPriorityQueue>({
    queryKey: ["/api/email-agent/intelligence/global-priority"],
    staleTime: 60_000,
  });

  function execute(action: GlobalAction) {
    sessionStorage.setItem(
      "agent_prefill_message",
      `Execute this top priority action: ${action.title}. Reason: ${action.reason}. Estimated value: $${(action.estimatedValue ?? 0).toLocaleString()}.`
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
      <DashStaggerList className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
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

// ─── Program Leads Panel v4 — Sales Intelligence OS ──────────────────────────

type AiSalesAnalysis = {
  recommendedTone: string;
  recommendedCta: string;
  objectionLikelihood: "low" | "medium" | "high";
  topObjection: string;
  probabilityToBook: number;
  probabilityToConvert: number;
  suggestedSms: string;
  suggestedEmail: string;
  urgencyNote: string;
  recommendedAction: string;
};

type ProgramLead = {
  id: string;
  athleteName: string;
  email: string;
  phone: string | null;
  sport: string | null;
  school: string | null;
  aiQualificationScore: number | null;
  commitmentLevel: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  createdAt: string;
  contactedAt: string | null;
  lastFollowUpAt: string | null;
  followUpCount: number | null;
  sequenceStatus: string | null;
  aiNextAction: string | null;
  bookingStatus: string | null;
  bookedAt: string | null;
  convertedAt: string | null;
  estimatedValueCents: number | null;
  aiSalesAnalysis: AiSalesAnalysis | null;
  isHot: boolean;
  isContacted: boolean;
  needsAction: boolean;
  isAbandonedRisk: boolean;
  ageHours: number;
  slaUrgency: "green" | "yellow" | "orange" | "red" | null;
  timeSinceContactHrs: number | null;
  adminEmailStatus: string | null;
  adminEmailError: string | null;
  applicantEmailStatus: string | null;
  applicantEmailError: string | null;
};

type AbandonedLead = {
  id: string;
  athleteName: string;
  email: string;
  phone: string | null;
  utmSource: string | null;
  createdAt: string;
  followupCount: number | null;
  recoverySequenceStatus: string | null;
};

type PipelineStages = { applied: number; contacted: number; booked: number; attended: number; converted: number };
type SlaData = { green: number; yellow: number; red: number; critical: number };

type ProgramLeadsSummary = {
  totalSubmissions: number;
  newToday: number;
  highIntent: number;
  abandonedCount: number;
  abandonedToday: number;
  hotNotContacted: number;
  needsFollowUp: number;
  bestSourceThisWeek: { source: string; count: number } | null;
  bestCampaign: { campaign: string; count: number } | null;
  estimatedPipelineValue: number;
  projectedRevenue: number;
  bookedRevenue: number;
  convertedRevenue: number;
  pipelineStages: PipelineStages;
  slaData: SlaData;
  recentLeads: ProgramLead[];
  abandonedLeads: AbandonedLead[];
};

function bookingStatusBadge(status: string | null) {
  switch (status) {
    case "booked": return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">📅 Booked</Badge>;
    case "completed": return <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-xs">✅ Attended</Badge>;
    case "converted": return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">🏆 Converted</Badge>;
    case "lost": return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">✗ Lost</Badge>;
    default: return null;
  }
}

function slaTimerLabel(lead: ProgramLead) {
  if (!lead.slaUrgency) return null;
  const h = lead.ageHours;
  const mins = Math.round(h * 60);
  const label = h < 1 ? `${mins}m ago` : `${Math.round(h)}h ago`;
  const cls =
    lead.slaUrgency === "green" ? "text-green-600 dark:text-green-400" :
    lead.slaUrgency === "yellow" ? "text-yellow-600 dark:text-yellow-400" :
    lead.slaUrgency === "orange" ? "text-orange-500" :
    "text-red-600 dark:text-red-400 font-bold";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {lead.slaUrgency === "red" ? `🚨 ${label}` : lead.slaUrgency === "orange" ? `⚠️ ${label}` : label}
    </span>
  );
}

function ProgramLeadsPanel() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"hot" | "followup" | "booked" | "abandoned" | "all">("all");
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [expandedMoreActions, setExpandedMoreActions] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<ProgramLeadsSummary>({
    queryKey: ["/api/lead-capture/command-center-summary"],
    refetchInterval: 60000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/command-center-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/business-command-center"] });
  };

  const moveToDeal = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/submissions/${id}/move-to-deal`, {}).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Moved to Deal Pipeline" }); invalidate(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const sendFollowUp = useMutation({
    mutationFn: ({ id, step }: { id: string; step: string }) =>
      apiRequest("POST", `/api/lead-capture/submissions/${id}/send-followup`, { step }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Follow-up sent" }); invalidate(); },
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const startSequence = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/submissions/${id}/start-sequence`, {}).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Sequence started" }); invalidate(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const markContacted = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/submissions/${id}/mark-contacted`, {}).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Marked as contacted" }); invalidate(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const updateBooking = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("POST", `/api/lead-capture/submissions/${id}/update-booking`, { status }).then((r) => r.json()),
    onSuccess: (_, { status }) => {
      toast({ title: status === "converted" ? "🏆 Marked as Converted!" : status === "booked" ? "📅 Booking confirmed!" : "Status updated" });
      invalidate();
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const generateAiAnalysis = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/lead-capture/submissions/${id}/ai-sales-analysis`, {}).then((r) => r.json()),
    onSuccess: (data, id) => {
      toast({ title: "AI analysis complete" });
      setExpandedAnalysis(id);
      invalidate();
    },
    onError: () => toast({ title: "AI analysis failed", variant: "destructive" }),
  });

  const recoverAbandoned = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/abandoned/${id}/recover`, { step: "recovery_30min" }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Recovery email sent" }); invalidate(); },
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const resendAdminEmail = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/submissions/${id}/resend-admin-email`, {}).then((r) => r.json()),
    onSuccess: (data) => { toast({ title: `Admin notification resent to ${data.sentTo || "admin"}` }); invalidate(); },
    onError: (err: any) => toast({ title: err?.message || "Failed to resend", variant: "destructive" }),
  });

  const resendApplicantEmail = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/lead-capture/submissions/${id}/resend-applicant-email`, {}).then((r) => r.json()),
    onSuccess: (data) => { toast({ title: `Confirmation email resent to ${data.sentTo || "applicant"}` }); invalidate(); },
    onError: (err: any) => toast({ title: err?.message || "Failed to resend confirmation", variant: "destructive" }),
  });

  if (isLoading) return null;
  if (!data || data.totalSubmissions === 0) {
    return (
      <section data-testid="section-program-leads-empty">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            Program Application Leads
          </h2>
        </div>
        <Card className="p-4 text-center text-sm text-muted-foreground" data-testid="card-no-program-leads">
          No program applications yet. Set up a Lead Capture Program in Admin → Programs.
        </Card>
      </section>
    );
  }

  const scoreBadge = (score: number | null) => {
    if (!score) return null;
    const cls = score >= 80 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : score >= 60 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    return <Badge className={`text-xs ${cls}`}>{score}/100</Badge>;
  };

  const pipeline = data.pipelineStages || { applied: 0, contacted: 0, booked: 0, attended: 0, converted: 0 };
  const sla = data.slaData || { green: 0, yellow: 0, red: 0, critical: 0 };
  const total = pipeline.applied || 1;

  const filteredLeads = (() => {
    if (!data.recentLeads) return [];
    if (activeTab === "hot") return data.recentLeads.filter((l) => l.isHot && !l.isContacted);
    if (activeTab === "followup") return data.recentLeads.filter((l) => l.needsAction);
    if (activeTab === "booked") return data.recentLeads.filter((l) => l.bookingStatus === "booked" || l.bookingStatus === "completed");
    return data.recentLeads;
  })();

  const tabs: { key: typeof activeTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: data.totalSubmissions },
    { key: "hot", label: "🔥 Hot", count: data.hotNotContacted },
    { key: "followup", label: "⏰ Follow-up", count: data.needsFollowUp },
    { key: "booked", label: "📅 Booked", count: pipeline.booked },
    { key: "abandoned", label: "↩ Abandoned", count: data.abandonedCount },
  ];

  return (
    <section data-testid="section-program-leads">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          Program Leads — Sales Intelligence
          {data.newToday > 0 && (
            <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 text-xs">
              {data.newToday} new today
            </Badge>
          )}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 w-7 p-0" data-testid="button-refresh-leads">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* SLA + Hot Lead Urgency Widget */}
      {data.hotNotContacted > 0 && (
        <Card className="p-3 mb-3 border-orange-500/30 bg-orange-500/5" data-testid="card-sla-widget">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
            <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Hot Lead SLA — Speed-to-Lead Response Required</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-base font-bold text-green-600 dark:text-green-400">{sla.green}</p>
              <p className="text-xs text-muted-foreground">&lt;5 min</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-yellow-600 dark:text-yellow-400">{sla.yellow}</p>
              <p className="text-xs text-muted-foreground">&lt;1 hr</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-orange-500">{sla.red}</p>
              <p className="text-xs text-muted-foreground">&gt;1 hr</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-red-600 dark:text-red-400">{sla.critical}</p>
              <p className="text-xs text-muted-foreground">&gt;24 hr ⚠</p>
            </div>
          </div>
        </Card>
      )}

      {/* Revenue Intelligence Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Card className="p-3 text-center" data-testid="card-revenue-projected">
          <p className="text-sm font-bold text-muted-foreground">${((data.projectedRevenue || 0) / 100).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Projected</p>
        </Card>
        <Card className="p-3 text-center border-blue-500/20" data-testid="card-revenue-booked">
          <p className="text-sm font-bold text-blue-600 dark:text-blue-400">${((data.bookedRevenue || 0) / 100).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Booked</p>
        </Card>
        <Card className="p-3 text-center border-green-500/20" data-testid="card-revenue-converted">
          <p className="text-sm font-bold text-green-600 dark:text-green-400">${((data.convertedRevenue || 0) / 100).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Converted</p>
        </Card>
        <Card className="p-3 text-center border-yellow-500/20" data-testid="card-leads-abandoned-today">
          <p className="text-sm font-bold text-yellow-600 dark:text-yellow-400">{data.abandonedToday}</p>
          <p className="text-xs text-muted-foreground">Abandoned Today</p>
        </Card>
      </div>

      {/* Conversion Pipeline Visualization */}
      <Card className="p-3 mb-3" data-testid="card-conversion-pipeline">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Conversion Pipeline</p>
        <div className="space-y-1.5">
          {([
            { label: "Applied", key: "applied" as const, color: "bg-slate-400 dark:bg-slate-500" },
            { label: "Contacted", key: "contacted" as const, color: "bg-blue-500" },
            { label: "Booked", key: "booked" as const, color: "bg-purple-500" },
            { label: "Attended", key: "attended" as const, color: "bg-orange-500" },
            { label: "Converted", key: "converted" as const, color: "bg-green-500" },
          ] as const).map(({ label, key, color }) => {
            const count = pipeline[key];
            const pct = Math.round((count / total) * 100);
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
                <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-medium w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
        {pipeline.applied > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Booking rate: <span className="text-foreground font-medium">{Math.round((pipeline.booked / pipeline.applied) * 100)}%</span>
            {" · "}Close rate: <span className="text-foreground font-medium">{Math.round((pipeline.converted / pipeline.applied) * 100)}%</span>
          </p>
        )}
      </Card>

      {/* Best source + campaign strip */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
        {data.bestSourceThisWeek && (
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
            <span>Top source: <span className="text-foreground font-medium">{data.bestSourceThisWeek.source}</span> ({data.bestSourceThisWeek.count})</span>
          </div>
        )}
        {data.bestCampaign && data.bestCampaign.campaign !== "none" && (
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-blue-500" />
            <span>Top campaign: <span className="text-foreground font-medium">{data.bestCampaign.campaign}</span> ({data.bestCampaign.count})</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === t.key
                ? "bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
            data-testid={`tab-leads-${t.key}`}
          >
            {t.label} {t.count > 0 && <span className="ml-1 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Abandoned tab */}
      {activeTab === "abandoned" && (
        <div className="space-y-2" data-testid="list-abandoned-leads">
          {data.abandonedLeads.length === 0 ? (
            <Card className="p-4 text-center text-sm text-muted-foreground">No abandoned applications</Card>
          ) : data.abandonedLeads.map((ab, i) => (
            <Card key={ab.id} className="p-3 border-blue-500/20" data-testid={`card-abandoned-${i}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{ab.athleteName}</p>
                  <p className="text-xs text-muted-foreground">{ab.email}</p>
                  {ab.utmSource && <p className="text-xs text-blue-500 mt-0.5">via {ab.utmSource}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ab.createdAt ? new Date(ab.createdAt).toLocaleDateString() : ""}
                    {ab.followupCount ? ` · ${ab.followupCount} recovery sent` : ""}
                  </p>
                </div>
                <div className="shrink-0 flex gap-1">
                  {ab.phone && (
                    <a href={`tel:${ab.phone}`}><Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Call"><span className="text-xs">📞</span></Button></a>
                  )}
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => recoverAbandoned.mutate(ab.id)}
                    disabled={recoverAbandoned.isPending}
                    data-testid={`button-recover-${i}`}
                  >
                    <Send className="h-3 w-3 mr-1" />Recover
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Submissions tabs (all / hot / followup / booked) */}
      {activeTab !== "abandoned" && (
        <div className="space-y-2" data-testid="list-program-leads">
          {filteredLeads.length === 0 ? (
            <Card className="p-4 text-center text-sm text-muted-foreground">No leads in this view</Card>
          ) : filteredLeads.map((lead, i) => {
            const isExpanded = expandedAnalysis === lead.id;
            const isDraftExpanded = expandedDraft === lead.id;
            const cardBorder = lead.bookingStatus === "converted" ? "border-green-500/30 bg-green-500/3"
              : lead.bookingStatus === "booked" ? "border-blue-500/20"
              : lead.isHot && !lead.isContacted ? "border-orange-500/30 bg-orange-500/3"
              : lead.needsAction ? "border-yellow-500/20"
              : "";

            return (
              <Card key={lead.id} className={`p-3 transition-colors ${cardBorder}`} data-testid={`card-program-lead-${i}`}>
                <div className="space-y-2">
                  {/* Top row */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{lead.athleteName}</p>
                        {scoreBadge(lead.aiQualificationScore)}
                        {lead.isHot && !lead.isContacted && <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">🔥 Hot</Badge>}
                        {lead.isContacted && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">✓ Contacted</Badge>}
                        {lead.needsAction && !lead.isContacted && <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 text-xs">⏰ Follow-up</Badge>}
                        {bookingStatusBadge(lead.bookingStatus)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[lead.sport, lead.school].filter(Boolean).join(" · ")}
                        {lead.utmSource && <span className="ml-2 text-blue-500">via {lead.utmSource}</span>}
                      </p>
                      {lead.commitmentLevel && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Commitment: <span className="text-foreground">{lead.commitmentLevel}</span>
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">
                        {lead.ageHours < 24 ? `${Math.round(lead.ageHours)}h ago` : `${Math.round(lead.ageHours / 24)}d ago`}
                      </p>
                      {slaTimerLabel(lead)}
                    </div>
                  </div>

                  {/* AI Next Action */}
                  {lead.aiNextAction && (
                    <div className="flex items-start gap-1.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                      <Sparkles className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">{lead.aiNextAction}</p>
                    </div>
                  )}

                  {/* AI Sales Analysis (expanded) */}
                  {lead.aiSalesAnalysis && isExpanded && (
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5 space-y-1.5" data-testid={`card-ai-analysis-${i}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                          <Brain className="h-3 w-3" />AI Sales Analysis
                        </p>
                        <button onClick={() => setExpandedAnalysis(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted-foreground">Book prob:</span>
                        <span className={`font-medium ${(lead.aiSalesAnalysis.probabilityToBook || 0) >= 70 ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>{lead.aiSalesAnalysis.probabilityToBook}%</span>
                        <span className="text-muted-foreground">Convert prob:</span>
                        <span className={`font-medium ${(lead.aiSalesAnalysis.probabilityToConvert || 0) >= 60 ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>{lead.aiSalesAnalysis.probabilityToConvert}%</span>
                        <span className="text-muted-foreground">Tone:</span>
                        <span className="font-medium capitalize">{lead.aiSalesAnalysis.recommendedTone}</span>
                        <span className="text-muted-foreground">Objection:</span>
                        <span className={`font-medium capitalize ${lead.aiSalesAnalysis.objectionLikelihood === "high" ? "text-red-500" : lead.aiSalesAnalysis.objectionLikelihood === "medium" ? "text-yellow-500" : "text-green-500"}`}>{lead.aiSalesAnalysis.objectionLikelihood}</span>
                      </div>
                      {lead.aiSalesAnalysis.topObjection && (
                        <p className="text-xs text-muted-foreground">Top objection: <span className="text-foreground">{lead.aiSalesAnalysis.topObjection}</span></p>
                      )}
                      <p className="text-xs font-medium text-purple-700 dark:text-purple-300">{lead.aiSalesAnalysis.recommendedAction}</p>
                      <button
                        onClick={() => setExpandedDraft(isDraftExpanded ? null : lead.id)}
                        className="text-xs text-blue-500 underline"
                        data-testid={`button-toggle-draft-${i}`}
                      >
                        {isDraftExpanded ? "Hide drafts" : "Show reply drafts →"}
                      </button>
                      {isDraftExpanded && (
                        <div className="space-y-2 pt-1">
                          {lead.aiSalesAnalysis.suggestedSms && (
                            <div className="rounded bg-muted/50 p-2">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5">📱 SMS Draft</p>
                              <p className="text-xs">{lead.aiSalesAnalysis.suggestedSms}</p>
                            </div>
                          )}
                          {lead.aiSalesAnalysis.suggestedEmail && (
                            <div className="rounded bg-muted/50 p-2">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5">✉️ Email Draft</p>
                              <p className="text-xs">{lead.aiSalesAnalysis.suggestedEmail}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Primary CTA + More tray */}
                  {(() => {
                    const isMoreOpen = expandedMoreActions === lead.id;
                    // Determine primary recommended action
                    let primaryCta: React.ReactNode;
                    if (lead.isHot && !lead.isContacted && lead.phone) {
                      primaryCta = (
                        <a href={`tel:${lead.phone}`} data-testid={`button-primary-lead-${i}`} className="flex-1">
                          <Button size="sm" className="h-8 w-full text-xs bg-primary hover:bg-primary/90 text-white">
                            📞 Call Now
                          </Button>
                        </a>
                      );
                    } else if (lead.isHot && !lead.isContacted) {
                      primaryCta = (
                        <a href={`mailto:${lead.email}`} data-testid={`button-primary-lead-${i}`} className="flex-1">
                          <Button size="sm" className="h-8 w-full text-xs bg-primary hover:bg-primary/90 text-white">
                            <Send className="h-3 w-3 mr-1" />Email Now
                          </Button>
                        </a>
                      );
                    } else if (lead.bookingStatus === "booked") {
                      primaryCta = (
                        <Button
                          size="sm"
                          className="h-8 flex-1 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                          onClick={() => updateBooking.mutate({ id: lead.id, status: "completed" })}
                          disabled={updateBooking.isPending}
                          data-testid={`button-primary-lead-${i}`}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />Mark Attended
                        </Button>
                      );
                    } else if (lead.bookingStatus === "completed") {
                      primaryCta = (
                        <Button
                          size="sm"
                          className="h-8 flex-1 text-xs bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => updateBooking.mutate({ id: lead.id, status: "converted" })}
                          disabled={updateBooking.isPending}
                          data-testid={`button-primary-lead-${i}`}
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />Convert
                        </Button>
                      );
                    } else if (lead.needsAction) {
                      primaryCta = (
                        <Button
                          size="sm"
                          className="h-8 flex-1 text-xs"
                          variant="outline"
                          onClick={() => sendFollowUp.mutate({ id: lead.id, step: "followup_24hr" })}
                          disabled={sendFollowUp.isPending}
                          data-testid={`button-primary-lead-${i}`}
                        >
                          <Zap className="h-3 w-3 mr-1" />Follow-up
                        </Button>
                      );
                    } else if (lead.aiSalesAnalysis) {
                      primaryCta = (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 flex-1 text-xs text-purple-600 border-purple-500/30"
                          onClick={() => setExpandedAnalysis(isExpanded ? null : lead.id)}
                          data-testid={`button-primary-lead-${i}`}
                        >
                          <Brain className="h-3 w-3 mr-1" />{isExpanded ? "Hide AI" : "AI Intel"}
                        </Button>
                      );
                    } else {
                      primaryCta = (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 flex-1 text-xs"
                          onClick={() => generateAiAnalysis.mutate(lead.id)}
                          disabled={generateAiAnalysis.isPending && generateAiAnalysis.variables === lead.id}
                          data-testid={`button-primary-lead-${i}`}
                        >
                          <Brain className="h-3 w-3 mr-1" />
                          {generateAiAnalysis.isPending && generateAiAnalysis.variables === lead.id ? "Analyzing…" : "AI Analyze"}
                        </Button>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <div className="flex gap-1.5 items-center">
                          {primaryCta}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs text-muted-foreground shrink-0"
                            onClick={() => setExpandedMoreActions(isMoreOpen ? null : lead.id)}
                            data-testid={`button-more-actions-lead-${i}`}
                          >
                            {isMoreOpen ? "Less ↑" : "More ↓"}
                          </Button>
                        </div>
                        {isMoreOpen && (
                          <div className="rounded-lg border border-border/60 bg-muted/30 p-2 space-y-1.5" data-testid={`tray-more-actions-${i}`}>
                            <div className="flex gap-1 flex-wrap">
                              {lead.phone && (
                                <a href={`tel:${lead.phone}`} data-testid={`button-call-lead-${i}`}>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs">📞 Call</Button>
                                </a>
                              )}
                              {lead.phone && (
                                <a href={`sms:${lead.phone}`} data-testid={`button-sms-lead-${i}`}>
                                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Text"><MessageSquare className="h-3 w-3" /></Button>
                                </a>
                              )}
                              <a href={`mailto:${lead.email}`} data-testid={`button-email-lead-${i}`}>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs"><Send className="h-3 w-3 mr-1" />Email</Button>
                              </a>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => sendFollowUp.mutate({ id: lead.id, step: "followup_24hr" })}
                                disabled={sendFollowUp.isPending}
                                data-testid={`button-followup-lead-${i}`}
                              >
                                <Zap className="h-3 w-3 mr-1" />Follow-up
                              </Button>
                              {(!lead.sequenceStatus || lead.sequenceStatus === "pending") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => startSequence.mutate(lead.id)}
                                  disabled={startSequence.isPending}
                                  data-testid={`button-sequence-lead-${i}`}
                                >
                                  <Play className="h-3 w-3 mr-1" />Sequence
                                </Button>
                              )}
                              {!lead.isContacted && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-green-600"
                                  onClick={() => markContacted.mutate(lead.id)}
                                  disabled={markContacted.isPending}
                                  data-testid={`button-contacted-lead-${i}`}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />Contacted
                                </Button>
                              )}
                              {(!lead.bookingStatus || lead.bookingStatus === "not_booked") && (
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                                  onClick={() => updateBooking.mutate({ id: lead.id, status: "booked" })}
                                  disabled={updateBooking.isPending}
                                  data-testid={`button-book-lead-${i}`}
                                >
                                  <CalendarCheck className="h-3 w-3 mr-1" />Mark Booked
                                </Button>
                              )}
                              {lead.bookingStatus === "booked" && (
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                                  onClick={() => updateBooking.mutate({ id: lead.id, status: "completed" })}
                                  disabled={updateBooking.isPending}
                                  data-testid={`button-attended-lead-${i}`}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />Attended
                                </Button>
                              )}
                              {(lead.bookingStatus === "completed" || lead.bookingStatus === "booked") && (
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => updateBooking.mutate({ id: lead.id, status: "converted" })}
                                  disabled={updateBooking.isPending}
                                  data-testid={`button-convert-lead-${i}`}
                                >
                                  <TrendingUp className="h-3 w-3 mr-1" />Convert
                                </Button>
                              )}
                              {lead.bookingStatus !== "lost" && lead.bookingStatus !== "converted" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                                  onClick={() => updateBooking.mutate({ id: lead.id, status: "lost" })}
                                  disabled={updateBooking.isPending}
                                  data-testid={`button-lost-lead-${i}`}
                                >
                                  ✗ Lost
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className={`h-7 px-2 text-xs ${lead.aiSalesAnalysis ? "text-purple-600 border-purple-500/30" : ""}`}
                                onClick={() => {
                                  if (lead.aiSalesAnalysis) {
                                    setExpandedAnalysis(isExpanded ? null : lead.id);
                                  } else {
                                    generateAiAnalysis.mutate(lead.id);
                                  }
                                }}
                                disabled={generateAiAnalysis.isPending && generateAiAnalysis.variables === lead.id}
                                data-testid={`button-ai-analysis-lead-${i}`}
                              >
                                <Brain className="h-3 w-3 mr-1" />
                                {lead.aiSalesAnalysis ? (isExpanded ? "Hide AI" : "AI Intel") : generateAiAnalysis.isPending && generateAiAnalysis.variables === lead.id ? "Analyzing…" : "AI Analyze"}
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs bg-orange-500 hover:bg-orange-600 text-white"
                                onClick={() => moveToDeal.mutate(lead.id)}
                                disabled={moveToDeal.isPending}
                                data-testid={`button-move-deal-${i}`}
                              >
                                <ArrowRight className="h-3 w-3 mr-1" />Deal
                              </Button>
                              {lead.adminEmailStatus !== "sent" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-orange-600 border-orange-500/30 hover:bg-orange-500/10"
                                  onClick={() => resendAdminEmail.mutate(lead.id)}
                                  disabled={resendAdminEmail.isPending && resendAdminEmail.variables === lead.id}
                                  data-testid={`button-resend-admin-email-${i}`}
                                  title={lead.adminEmailStatus === "failed" ? `Last attempt failed: ${lead.adminEmailError || "unknown error"}` : "Send admin notification email"}
                                >
                                  <Send className="h-3 w-3 mr-1" />
                                  {resendAdminEmail.isPending && resendAdminEmail.variables === lead.id ? "Sending…" : "Notify Admin"}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Applicant confirmation email status row */}
                  <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                    <span className="text-xs text-muted-foreground">Confirmation email:</span>
                    {lead.applicantEmailStatus === "sent" ? (
                      <Badge className="h-5 px-2 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
                        ✓ Sent
                      </Badge>
                    ) : lead.applicantEmailStatus === "failed" ? (
                      <Badge
                        className="h-5 px-2 text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 cursor-help"
                        title={lead.applicantEmailError || "Unknown error"}
                      >
                        ✗ Failed
                      </Badge>
                    ) : (
                      <Badge className="h-5 px-2 text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-0">
                        ⏳ Pending
                      </Badge>
                    )}
                    {lead.applicantEmailStatus !== "sent" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-2 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        onClick={() => resendApplicantEmail.mutate(lead.id)}
                        disabled={resendApplicantEmail.isPending && resendApplicantEmail.variables === lead.id}
                        data-testid={`button-resend-applicant-email-${i}`}
                      >
                        {resendApplicantEmail.isPending && resendApplicantEmail.variables === lead.id ? "Sending…" : "Resend →"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
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

// ─── Attention KPI Card ───────────────────────────────────────────────────────

function AttentionKpiCard() {
  const [, setLocation] = useLocation();
  const { data: items = [] } = useQuery<AttentionPreviewItem[]>({
    queryKey: ["/api/attention"],
    refetchInterval: 3 * 60 * 1000,
    staleTime: 90_000,
  });
  const active = items.filter(i => i.status === "active" || i.status === "escalated");
  const high = active.filter(i => i.level === "critical" || i.status === "escalated").length;
  const total = active.length;

  return (
    <Card
      className={`p-3 cursor-pointer hover:border-primary/40 transition-colors ${high > 0 ? "border-red-400/40" : ""}`}
      onClick={() => setLocation("/admin/attention")}
      data-testid="kpi-attention-items"
    >
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Attention Items</p>
      <p className={`text-lg font-bold mt-0.5 ${high > 0 ? "text-red-600 dark:text-red-400" : total > 0 ? "text-foreground" : "text-muted-foreground"}`}>
        {total}
      </p>
      {high > 0 && <p className="text-[10px] text-red-500 mt-0.5">{high} urgent</p>}
    </Card>
  );
}

// ─── Recommended Action Card ──────────────────────────────────────────────────

function RecommendedActionCard({ data, openAgentWith }: { data: CommandCenterData; openAgentWith: (msg: string) => void }) {
  const [showOpportunities, setShowOpportunities] = useState(false);

  const { data: brainData } = useQuery<CommandCenterSummary>({
    queryKey: ["/api/admin/business-brain/command-center-summary"],
    staleTime: 120_000,
  });

  const bestAction = data.bestAction;
  const topUnified = brainData?.topActions?.[0];

  const primaryAction = bestAction
    ? {
        headline: bestAction.headline,
        value: bestAction.estimatedValueCents,
        onAction: () => openAgentWith(`Help me take action on: ${bestAction.headline}`),
        onWhy: () => openAgentWith(`Why is "${bestAction.headline}" your top recommendation today?`),
      }
    : topUnified
    ? {
        headline: topUnified.title,
        value: topUnified.estimatedImpact * 100,
        onAction: () => openAgentWith(`Help me with: ${topUnified.title}`),
        onWhy: () => openAgentWith(`Why is "${topUnified.title}" a priority today?`),
      }
    : null;

  const otherOpportunities: string[] = [
    ...(brainData?.topActions?.slice(1, 3).map(a => a.title) ?? []),
    ...(data.teamPipeline.repliesNeedingFollowUp > 0
      ? [`Follow up with ${data.teamPipeline.repliesNeedingFollowUp} team training repl${data.teamPipeline.repliesNeedingFollowUp !== 1 ? "ies" : "y"}`]
      : []),
    ...(data.teamPipeline.draftsAwaitingApproval > 0
      ? [`Review ${data.teamPipeline.draftsAwaitingApproval} outreach draft${data.teamPipeline.draftsAwaitingApproval !== 1 ? "s" : ""}`]
      : []),
    ...(data.teamPipeline.highConfidenceLeads > 0
      ? [`Contact ${data.teamPipeline.highConfidenceLeads} high-confidence lead${data.teamPipeline.highConfidenceLeads !== 1 ? "s" : ""}`]
      : []),
  ];

  return (
    <section data-testid="section-recommended-action">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-primary" /> Recommended Action
      </h2>

      {!primaryAction ? (
        <Card className="p-3 border-dashed flex items-center gap-3" style={{ maxHeight: "140px" }} data-testid="card-no-recommended-action">
          <Brain className="h-5 w-5 text-muted-foreground/40 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">No recommendation yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Add prospects or run a Business Brain analysis.</p>
          </div>
        </Card>
      ) : (
        <>
          <DashPriorityCard>
            <Card className="p-3.5 border-primary/40 bg-primary/5 dark:bg-primary/10" data-testid="card-recommended-action">
              <div className="flex items-start gap-2.5 mb-3">
                <div className="mt-0.5 rounded-full bg-primary/20 p-1.5 shrink-0">
                  <Star className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground leading-tight" data-testid="text-recommended-headline">
                    {primaryAction.headline}
                  </p>
                  {primaryAction.value > 0 && (
                    <p className="text-xs font-semibold text-primary mt-0.5">{fmt$(primaryAction.value)} opportunity</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 h-8 text-xs" onClick={primaryAction.onAction} data-testid="button-take-action">
                  <Zap className="h-3.5 w-3.5 mr-1" /> Take Action
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={primaryAction.onWhy} data-testid="button-ask-why">
                  Why?
                </Button>
              </div>
            </Card>
          </DashPriorityCard>

          {otherOpportunities.length > 0 && (
            <div className="mt-2">
              <button
                className="flex items-center gap-1.5 w-full px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowOpportunities(s => !s)}
                data-testid="button-toggle-other-opportunities"
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-150 ${showOpportunities ? "rotate-90" : ""}`} />
                <span>Other Opportunities ({otherOpportunities.length})</span>
              </button>
              {showOpportunities && (
                <div className="mt-1 space-y-1" data-testid="list-other-opportunities">
                  {otherOpportunities.map((opp, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 text-xs" data-testid={`item-opportunity-${i}`}>
                      <div className="h-1 w-1 rounded-full bg-muted-foreground/60 shrink-0" />
                      <p className="flex-1 truncate">{opp}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Attention Summary Card ───────────────────────────────────────────────────

function AttentionSummaryCard() {
  const [, setLocation] = useLocation();
  const { data: items = [] } = useQuery<AttentionPreviewItem[]>({
    queryKey: ["/api/attention"],
    refetchInterval: 3 * 60 * 1000,
    staleTime: 90_000,
  });

  const active = items.filter(i => i.status === "active" || i.status === "escalated");
  const highCount = active.filter(i => i.level === "critical" || i.status === "escalated").length;
  const mediumCount = active.filter(i => i.level === "important" && i.status !== "escalated").length;
  const lowCount = active.filter(i => i.level === "suggested").length;
  const total = active.length;

  return (
    <section data-testid="section-attention-summary">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5" /> Attention
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => setLocation("/admin/attention")}
          data-testid="button-open-attention-inbox"
        >
          Open Inbox <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
      <Card className="p-3" data-testid="card-attention-summary">
        {total === 0 ? (
          <div className="flex items-center gap-2.5">
            <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-sm font-medium">No active attention items</p>
          </div>
        ) : (
          <div className="flex items-center gap-6 flex-wrap">
            {highCount > 0 && (
              <div className="flex items-center gap-1.5" data-testid="text-attention-high">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <span className="text-2xl font-black text-red-600 dark:text-red-400">{highCount}</span>
                <span className="text-xs text-muted-foreground">High</span>
              </div>
            )}
            {mediumCount > 0 && (
              <div className="flex items-center gap-1.5" data-testid="text-attention-medium">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{mediumCount}</span>
                <span className="text-xs text-muted-foreground">Medium</span>
              </div>
            )}
            {lowCount > 0 && (
              <div className="flex items-center gap-1.5" data-testid="text-attention-low">
                <Lightbulb className="h-4 w-4 text-violet-400 shrink-0" />
                <span className="text-2xl font-black text-violet-600 dark:text-violet-400">{lowCount}</span>
                <span className="text-xs text-muted-foreground">Low</span>
              </div>
            )}
            {total > 0 && highCount === 0 && mediumCount === 0 && lowCount === 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black">{total}</span>
                <span className="text-xs text-muted-foreground">Items</span>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

// ─── Compact Lead Pipeline Section ───────────────────────────────────────────

function CompactLeadPipelineSection({ data, openAgentWith }: { data: CommandCenterData; openAgentWith: (msg: string) => void }) {
  const [, setLocation] = useLocation();

  const { data: leads } = useQuery<ProgramLeadsSummary>({
    queryKey: ["/api/lead-capture/command-center-summary"],
    staleTime: 60_000,
  });

  const totalLeads = data.teamPipeline.totalProspects + (leads?.totalSubmissions ?? 0);
  const highConfidence = data.teamPipeline.highConfidenceLeads + (leads?.highIntent ?? 0);
  const awaitingApproval = data.teamPipeline.draftsAwaitingApproval;
  const pipelineValueCents = data.teamPipeline.estimatedPipelineValueCents + Math.round((leads?.estimatedPipelineValue ?? 0) * 100);

  const topLeads = data.teamPipeline.activeLeads.slice(0, 4);

  return (
    <section data-testid="section-lead-pipeline">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" /> Lead Pipeline
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => setLocation("/admin/team-training-leads")}
          data-testid="button-view-all-leads"
        >
          View All <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3" data-testid="grid-lead-kpis">
        <Card className="p-2 text-center" data-testid="kpi-total-leads">
          <p className="text-base font-bold">{totalLeads}</p>
          <p className="text-[9px] text-muted-foreground leading-tight">Total</p>
        </Card>
        <Card className="p-2 text-center" data-testid="kpi-high-confidence">
          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{highConfidence}</p>
          <p className="text-[9px] text-muted-foreground leading-tight">High Conf</p>
        </Card>
        <Card className={`p-2 text-center ${awaitingApproval > 0 ? "border-yellow-400/40" : ""}`} data-testid="kpi-awaiting-approval">
          <p className={`text-base font-bold ${awaitingApproval > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}>{awaitingApproval}</p>
          <p className="text-[9px] text-muted-foreground leading-tight">Awaiting</p>
        </Card>
        <Card className="p-2 text-center" data-testid="kpi-pipeline-value">
          <p className="text-base font-bold text-primary">{fmt$(pipelineValueCents)}</p>
          <p className="text-[9px] text-muted-foreground leading-tight">Pipeline</p>
        </Card>
      </div>

      {topLeads.length > 0 ? (
        <div className="space-y-1.5" data-testid="list-top-leads">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Top Leads Requiring Action</p>
          {topLeads.map((lead, i) => (
            <div key={lead.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/60 bg-card" data-testid={`row-top-lead-${i}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{lead.prospectName}</p>
                <p className="text-[10px] text-muted-foreground truncate">{[lead.sport, lead.city, lead.state].filter(Boolean).join(" · ")}</p>
              </div>
              <Badge className={`text-[10px] shrink-0 ${CONFIDENCE_BADGE[lead.confidenceScore >= 0.8 ? "high" : lead.confidenceScore >= 0.5 ? "medium" : "low"]}`}>
                {Math.round(lead.confidenceScore * 100)}%
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs shrink-0"
                onClick={() => openAgentWith(`Help me contact ${lead.prospectName} for team training outreach`)}
                data-testid={`button-act-lead-${i}`}
              >
                Act <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : totalLeads === 0 ? (
        <Card className="p-3 text-center border-dashed" style={{ maxHeight: "140px" }} data-testid="card-no-leads">
          <p className="text-sm text-muted-foreground">No leads yet.</p>
          <Button size="sm" variant="outline" className="mt-2 text-xs h-7" onClick={() => openAgentWith("Find me some team training leads")} data-testid="button-find-leads-cta">
            Find Leads
          </Button>
        </Card>
      ) : null}
    </section>
  );
}

// ─── Compact AI Workforce Section ─────────────────────────────────────────────

function CompactAiWorkforceSection({ onRunBrain, openAgentWith }: { onRunBrain: () => void; openAgentWith: (msg: string) => void }) {
  const [, setLocation] = useLocation();
  const [showFindings, setShowFindings] = useState(false);

  const { data: brainData, isLoading: brainLoading } = useQuery<CommandCenterSummary>({
    queryKey: ["/api/admin/business-brain/command-center-summary"],
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const { data: revenue } = useQuery<AiRevenueOutcomes>({
    queryKey: ["/api/email-agent/revenue-outcomes"],
    staleTime: 60_000,
  });

  const healthScore = brainData?.healthScore ?? null;
  const brief = brainData?.briefSummary;

  const findings: string[] = [
    ...(brief?.biggestOpportunity?.title ? [brief.biggestOpportunity.title] : []),
    ...(brief?.highestChurnRisk?.name ? [`Churn risk: ${brief.highestChurnRisk.name}`] : []),
    ...(brief?.mostValuableLead?.name ? [`Best lead: ${brief.mostValuableLead.name}`] : []),
    ...((revenue?.week.actions ?? 0) > 0 ? [`${revenue!.week.actions} AI actions tracked this week`] : []),
  ];

  const agentStatuses = [
    { label: "Revenue Agent", active: (revenue?.month.actions ?? 0) > 0 },
    { label: "Scheduling Agent", active: true },
    { label: "Retention Agent", active: (brainData?.topActions ?? []).some(a => a.agentType === "retention") },
    { label: "Support Agent", active: false },
  ];

  return (
    <section data-testid="section-ai-workforce">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" /> AI Workforce
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setLocation("/admin/business-brain")} data-testid="button-view-brain">
          Full View <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>

      <Card className="p-3" data-testid="card-ai-workforce">
        {brainLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-4 mb-3">
              <div className="shrink-0 text-center min-w-[52px]">
                <p className={`text-3xl font-black leading-none ${healthScoreColor(healthScore)}`} data-testid="text-workforce-health-score">
                  {healthScore ?? "—"}
                </p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Health</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Agent Status</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {agentStatuses.map((agent, i) => (
                    <div key={i} className="flex items-center gap-1.5" data-testid={`agent-status-${i}`}>
                      <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${agent.active ? "bg-emerald-500" : "bg-muted-foreground/25"}`} />
                      <span className={`text-[11px] truncate ${agent.active ? "text-foreground/80" : "text-muted-foreground/50"}`}>{agent.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-border/60 pt-2.5">
              <button
                className="flex items-center justify-between w-full"
                onClick={() => setShowFindings(s => !s)}
                data-testid="button-toggle-findings"
              >
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Top Findings</p>
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${showFindings ? "rotate-90" : ""}`} />
              </button>
              {showFindings && (
                <div className="mt-2" data-testid="list-top-findings">
                  {findings.length > 0 ? (
                    <div className="space-y-1.5">
                      {findings.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5" data-testid={`finding-${i}`}>
                          <div className="h-1 w-1 rounded-full bg-primary mt-1.5 shrink-0" />
                          <p className="text-xs leading-snug">{f}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Run an analysis to see findings.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-border/60">
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onRunBrain} data-testid="button-run-analysis">
                <RefreshCw className="h-3 w-3 mr-1" /> Run Analysis
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openAgentWith("What should I do today to grow my revenue and fill my schedule?")} data-testid="button-ask-agent">
                <Bot className="h-3 w-3 mr-1" /> Ask Agent
              </Button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

export default function BusinessCommandCenterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [showAllRecovery, setShowAllRecovery] = useState(false);

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
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const hasGoal = data.monthGoalCents != null;
  const goalProgress = hasGoal && data.monthGoalCents! > 0
    ? Math.min(100, Math.round((data.monthRevenueCents / data.monthGoalCents!) * 100))
    : null;

  const allOpenSlots = [...data.openSlotsToday, ...data.openSlotsTomorrow];

  type RecoveryRow = {
    id: string;
    icon: React.ReactNode;
    title: string;
    context: string;
    value: number;
    actionLabel: string;
    onAction: () => void;
  };

  const recoveryRows: RecoveryRow[] = [
    ...allOpenSlots.map((slot, idx) => ({
      id: `slot-${slot.startISO}-${idx}`,
      icon: <Clock className="h-3.5 w-3.5 text-orange-500" />,
      title: `${slot.startTime}${slot.endTimeStr ? ` – ${slot.endTimeStr}` : ""}`,
      context: slot.date,
      value: slot.estimatedValueCents,
      actionLabel: "Fill",
      onAction: () => openAgentWith(`Help me fill the ${slot.startTime} slot on ${slot.date}`),
    })),
    ...data.clientOpportunities.map((opp, idx) => ({
      id: `opp-${opp.clientId}-${opp.type}-${idx}`,
      icon: opp.type === "churn_risk"
        ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
        : <Users className="h-3.5 w-3.5 text-blue-500" />,
      title: opp.clientName,
      context: opp.detail,
      value: opp.estimatedValueCents,
      actionLabel: opp.type === "churn_risk" ? "Retain" : "Act",
      onAction: () => openAgentWith(opp.suggestedAction),
    })),
  ].sort((a, b) => b.value - a.value);

  const visibleRecovery = showAllRecovery ? recoveryRows : recoveryRows.slice(0, 4);

  return (
    <div className="space-y-4 pb-6">
      {/* ─── TODAY Header ─────────────────────────────────── */}
      <DashPageHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Today</p>
            <h1 className="text-xl font-bold tracking-tight leading-tight" data-testid="text-command-center-title">Command Center</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(), "EEEE, MMMM d")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="shrink-0 h-8 w-8 p-0"
            data-testid="button-refresh-command-center"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </DashPageHeader>

      {/* ─── 4 KPI Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="section-kpi-cards">
        <Card className="p-3" data-testid="kpi-revenue-mtd">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue MTD</p>
          <p className="text-lg font-bold mt-0.5">{fmt$(data.monthRevenueCents)}</p>
        </Card>
        <Card className={`p-3 ${allOpenSlots.length > 0 ? "border-orange-400/40" : ""}`} data-testid="kpi-open-slots">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open Slots</p>
          <p className={`text-lg font-bold mt-0.5 ${allOpenSlots.length > 0 ? "text-orange-600 dark:text-orange-400" : "text-foreground"}`}>
            {allOpenSlots.length}
          </p>
        </Card>
        <Card className={`p-3 ${data.teamPipeline.draftsAwaitingApproval > 0 ? "border-yellow-400/40" : ""}`} data-testid="kpi-pending-approvals">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending Approvals</p>
          <p className={`text-lg font-bold mt-0.5 ${data.teamPipeline.draftsAwaitingApproval > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}>
            {data.teamPipeline.draftsAwaitingApproval}
          </p>
        </Card>
        <AttentionKpiCard />
      </div>

      {/* Goal progress (compact) */}
      {hasGoal && goalProgress !== null && (
        <div className="px-0.5" data-testid="section-goal-progress">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Goal: {fmt$(data.monthGoalCents!)} · {goalProgress}% reached</span>
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setGoalDialogOpen(true)} data-testid="button-edit-goal">
              Edit
            </Button>
          </div>
          <Progress value={goalProgress} className="h-1" data-testid="progress-monthly-goal" />
        </div>
      )}
      {!hasGoal && (
        <button
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
          onClick={() => setGoalDialogOpen(true)}
          data-testid="button-set-goal"
        >
          <Target className="h-3.5 w-3.5" />
          Set a monthly revenue goal to track progress
        </button>
      )}

      {/* ─── Recommended Action ───────────────────────────── */}
      <RecommendedActionCard data={data} openAgentWith={openAgentWith} />

      {/* ─── Attention ────────────────────────────────────── */}
      <AttentionSummaryCard />

      {/* ─── Active Workflows ─────────────────────────────── */}
      <WorkflowStatusStrip />

      {/* ─── Revenue Recovery (compact) ───────────────────── */}
      {recoveryRows.length > 0 ? (
        <section data-testid="section-revenue-recovery">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Revenue Recovery
              <span className="font-normal normal-case tracking-normal text-[10px] ml-0.5">
                · {fmt$(recoveryRows.reduce((s, r) => s + r.value, 0))}
              </span>
            </h2>
          </div>
          <div className="space-y-1" data-testid="list-revenue-recovery">
            {visibleRecovery.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/60 bg-card hover:border-border transition-colors" data-testid={`row-recovery-${row.id}`}>
                <div className="shrink-0">{row.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{row.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{row.context}</p>
                </div>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">{fmt$(row.value)}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs shrink-0" onClick={row.onAction} data-testid={`button-recovery-act-${row.id}`}>
                  {row.actionLabel} <ArrowRight className="h-3 w-3 ml-0.5" />
                </Button>
              </div>
            ))}
          </div>
          {recoveryRows.length > 4 && (
            <button
              className="mt-1.5 w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
              onClick={() => setShowAllRecovery(s => !s)}
              data-testid="button-view-all-recovery"
            >
              {showAllRecovery ? "Show less ↑" : `+${recoveryRows.length - 4} more`}
            </button>
          )}
        </section>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5" data-testid="section-recovery-empty">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
          Schedule full · No churn risks
        </div>
      )}

      {/* ─── Lead Pipeline ────────────────────────────────── */}
      <CompactLeadPipelineSection data={data} openAgentWith={openAgentWith} />

      {/* ─── AI Workforce ─────────────────────────────────── */}
      <CompactAiWorkforceSection onRunBrain={handleRunBrain} openAgentWith={openAgentWith} />

      {/* ─── Set Goal Dialog ──────────────────────────────── */}
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
