import { useState, useMemo, useEffect, useRef } from "react";
import { useAiRevenueToasts } from "@/hooks/use-ai-revenue-toasts";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Mail, Search, CheckCircle, XCircle, RefreshCw, Filter, MinusCircle,
  Bot, Users, Send, Target, TrendingUp, Clock, Plus, Eye, Zap,
  PhoneOff, MessageSquare, Edit2, Trash2, ChevronDown, ChevronUp,
  Loader2, AlertCircle, DollarSign, Calendar, SkipForward, Settings2,
  RepeatIcon, Ban, Info, Brain, Flame, ShieldAlert, ArrowRight,
  Sparkles, Activity, Copy, Undo2, PlayCircle, ShieldCheck
} from "lucide-react";
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CommunicationLog, TeamTrainingProspect, TeamTrainingOutreachDraft, EmailFollowUp } from "@shared/schema";

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  booking_confirmation: "Booking Confirmation",
  cancellation: "Cancellation",
  reschedule: "Reschedule",
  recurring: "Recurring",
  reminder: "Reminder",
  outreach: "Outreach",
};
const TYPE_COLORS: Record<string, string> = {
  booking_confirmation: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancellation: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  reschedule: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  recurring: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  reminder: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  outreach: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};
const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "Needs Review": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  "Approved": "bg-green-500/15 text-green-700 dark:text-green-400",
  "Contacted": "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  "Replied": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "Not Interested": "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  "Do Not Contact": "bg-red-500/15 text-red-700 dark:text-red-400",
};
const SPORTS = [
  "Football", "Soccer", "Basketball", "Baseball", "Volleyball", "Lacrosse",
  "Wrestling", "Cheer", "Swimming", "Track & Field", "Softball", "Martial Arts",
  "Tennis", "Cross Country", "Gymnastics", "Rowing",
];
const SPORTS_MULTISELECT = SPORTS;

type DraftWithProspect = TeamTrainingOutreachDraft & { prospect?: TeamTrainingProspect };
type FollowUpWithProspect = EmailFollowUp & { prospect?: TeamTrainingProspect };

type ReplyClassification =
  | "interested" | "not_interested" | "ask_info" | "referral"
  | "wrong_contact" | "out_of_office" | "unknown";

const CLASSIFICATION_OPTIONS: { value: ReplyClassification; label: string; color: string }[] = [
  { value: "interested", label: "Interested", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  { value: "not_interested", label: "Not Interested", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { value: "ask_info", label: "Asking Info", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  { value: "referral", label: "Referral", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  { value: "wrong_contact", label: "Wrong Contact", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "out_of_office", label: "Out of Office", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "unknown", label: "Unknown", color: "bg-muted text-muted-foreground" },
];

function classificationColor(c: ReplyClassification | null | undefined): string {
  return CLASSIFICATION_OPTIONS.find(o => o.value === c)?.color ?? "bg-muted text-muted-foreground";
}
function classificationLabel(c: ReplyClassification | null | undefined): string {
  return CLASSIFICATION_OPTIONS.find(o => o.value === c)?.label ?? (c ?? "—");
}

const FOLLOW_UP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

interface EmailAgentOverview {
  sentToday: number;
  dailyLimit: number;
  totalProspects: number;
  prospectsWithEmail: number;
  replied: number;
  interested: number;
  estimatedPipeline: number;
}
interface EmailPerformanceStats {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  conversionRate: number;
  bestVariant: { id: string; name: string; performanceScore: number; timesUsed: number } | null;
}
interface EmailAgentSettings {
  enabled?: boolean;
  dailyLimit?: number;
  outreachRadius?: number;
  cooldownDays?: number;
  autoGenerateDrafts?: boolean;
  autoSend?: boolean;
  preferredSports?: string[];
  targetLevels?: string[];
  defaultEstimatedValue?: number;
  autoExecuteEnabled?: boolean;
  autoExecuteMaxPerDay?: number;
}

interface AutoExecution {
  id: string;
  actionType: string;
  title: string;
  prospectId: string;
  prospectName: string;
  estimatedValue: number;
  draftId?: string;
  followUpId?: string;
  executedAt: string;
  outcome: "success" | "failed";
  error?: string;
  undone: boolean;
}

interface AutoExecLogData {
  log: AutoExecution[];
  todayCount: number;
  maxPerDay: number;
  successRate: number;
  enabled: boolean;
}

// ─── AI Revenue types ─────────────────────────────────────────────────────────
interface AiRevenuePeriod {
  revenue: number;
  actions: number;
  wonActions: number;
  engagedActions: number;
  avgPerAction: number;
}

interface AiRevenueImpactItem {
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
}

interface AiRevenueOutcomes {
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{score}%</span>
    </div>
  );
}

// ─── Intelligence Types ────────────────────────────────────────────────────────
interface IntelligenceScores { warmth: number; urgency: number; fit: number; risk: number }
interface DecisionExplanation {
  decision_reason: string;
  supporting_signals: string[];
  risk_flags: string[];
  confidence_level: "low" | "medium" | "high";
  expected_outcome: string;
  alternative_action: string;
}
interface NextBestAction { actionType: string; priority: string; reason: string; estimatedValue: number; recommendedPrompt: string; requiresApproval: boolean; explanation?: DecisionExplanation }
interface IntelligenceCard { prospectId: string; prospectName: string; sport: string; city?: string; estimatedValue: number; scores: IntelligenceScores; nextBestAction: NextBestAction; engagement?: { totalSent: number; opened: boolean; clicked: boolean; replied: boolean; replyClassification: string | null } }
interface IntelligenceOverview { warmestProspect: IntelligenceCard | null; highestValueOpportunity: IntelligenceCard | null; mostUrgentFollowUp: IntelligenceCard | null; pipelineRisk: { prospectId: string; prospectName: string; sport: string; riskScore: number; reason: string; explanation?: DecisionExplanation } | null; nextBestActions: IntelligenceCard[] }
interface ProspectIntelligence { scores: IntelligenceScores; intelligence: { scores: IntelligenceScores; nextBestAction: NextBestAction }; safety: { isDNC: boolean; cooldownActive: boolean; nextEligibleDate: string | null } }

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  low: "bg-muted text-muted-foreground",
};

const ACTION_LABELS: Record<string, string> = {
  create_deal: "Create Deal",
  generate_response: "Respond",
  schedule_call: "Schedule Call",
  send_follow_up: "Follow Up",
  generate_draft: "Generate Draft",
  mark_do_not_contact: "Mark DNC",
  stop_sequence: "Stop",
  wait: "Wait",
  create_proposal: "Create Proposal",
};

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs text-muted-foreground w-10 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium w-6 text-right">{score}</span>
    </div>
  );
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function WhyPanel({ explanation, testId }: { explanation: DecisionExplanation; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mt-1"
        onClick={() => setOpen(o => !o)}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <Info className="h-3 w-3" />
        Why this recommendation?
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div
          className="mt-2 rounded-lg border bg-background p-3 space-y-2.5 text-xs"
          data-testid={testId ? `${testId}-panel` : undefined}
        >
          {/* Reason */}
          <div>
            <p className="font-semibold text-foreground mb-0.5">Why:</p>
            <p className="text-muted-foreground leading-relaxed">{explanation.decision_reason}</p>
          </div>

          {/* Signals */}
          {explanation.supporting_signals.length > 0 && (
            <div>
              <p className="font-semibold text-foreground mb-0.5">What we know (facts):</p>
              <ul className="space-y-0.5">
                {explanation.supporting_signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                    <CheckCircle className="h-3 w-3 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk flags */}
          {explanation.risk_flags.length > 0 && (
            <div>
              <p className="font-semibold text-foreground mb-0.5">Risks / cautions:</p>
              <ul className="space-y-0.5">
                {explanation.risk_flags.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Confidence + outcome */}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div>
              <p className="font-semibold text-foreground mb-0.5">AI confidence:</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLE[explanation.confidence_level] ?? CONFIDENCE_STYLE.low}`}>
                {explanation.confidence_level.charAt(0).toUpperCase() + explanation.confidence_level.slice(1)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground mb-0.5">Expected outcome:</p>
              <p className="text-muted-foreground">{explanation.expected_outcome}</p>
            </div>
          </div>

          {/* Alternative */}
          <div>
            <p className="font-semibold text-foreground mb-0.5">If not now — alternative:</p>
            <p className="text-muted-foreground italic">{explanation.alternative_action}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function IntelligenceCardWidget({
  title,
  icon: Icon,
  iconColor,
  card,
  onAction,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  card: IntelligenceCard | { prospectId: string; prospectName: string; sport: string; riskScore?: number; reason?: string } | null;
  onAction?: (prompt: string, name: string) => void;
}) {
  if (!card) {
    return (
      <Card className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground italic">No data yet</p>
      </Card>
    );
  }

  const isRiskCard = "riskScore" in card;
  const intel = !isRiskCard ? (card as IntelligenceCard) : null;
  const risk = isRiskCard ? (card as any) : null;

  return (
    <Card className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
      </div>
      <div>
        <p className="font-semibold text-sm truncate" data-testid={`intel-card-name-${title.toLowerCase().replace(/\s+/g, "-")}`}>{card.prospectName}</p>
        {card.sport && card.sport !== "unknown" && <p className="text-xs text-muted-foreground">{card.sport}</p>}
      </div>
      {intel && intel.estimatedValue > 0 && (
        <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
          <DollarSign className="h-3 w-3" />${intel.estimatedValue.toLocaleString()}
        </p>
      )}
      {risk && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">Risk score: {risk.riskScore}/100</p>
      )}
      <p className="text-xs text-muted-foreground line-clamp-2">
        {intel?.nextBestAction?.reason ?? risk?.reason ?? "—"}
      </p>
      {intel && onAction && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between gap-2">
            {intel.nextBestAction?.priority && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[intel.nextBestAction.priority] ?? PRIORITY_COLOR.low}`}>
                {intel.nextBestAction.priority}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2 ml-auto"
              onClick={() => onAction(intel.nextBestAction.recommendedPrompt, card.prospectName)}
              data-testid={`intel-action-${card.prospectId}`}
            >
              {ACTION_LABELS[intel.nextBestAction.actionType] ?? "Act"}
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
          {intel.nextBestAction?.explanation && (
            <WhyPanel
              explanation={intel.nextBestAction.explanation}
              testId={`why-intel-${card.prospectId}`}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function AgentIntelligenceSection() {
  const { toast } = useToast();

  const { data: intel, isLoading } = useQuery<IntelligenceOverview>({
    queryKey: ["/api/email-agent/intelligence/overview"],
  });

  function handleAction(prompt: string, name: string) {
    navigator.clipboard.writeText(prompt).then(() => {
      toast({
        title: "Prompt copied",
        description: `Open your agent and paste to analyze ${name}.`,
        duration: 4000,
      });
    });
  }

  if (isLoading) {
    return (
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Agent Intelligence
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36" />)}
        </div>
      </div>
    );
  }

  const hasAnyData = intel && (intel.warmestProspect || intel.highestValueOpportunity || intel.mostUrgentFollowUp || intel.pipelineRisk);

  if (!hasAnyData) {
    return (
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2" data-testid="heading-agent-intelligence">
          <Brain className="h-4 w-4 text-primary" />
          Agent Intelligence
        </h2>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="font-medium text-sm">No intelligence data yet</p>
            <p className="text-xs mt-1">Add prospects and send outreach to see AI-driven signals here.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2" data-testid="heading-agent-intelligence">
          <Brain className="h-4 w-4 text-primary" />
          Agent Intelligence
        </h2>
        <span className="text-xs text-muted-foreground">Tip: click action buttons to copy agent prompts</span>
      </div>

      {/* 4 signal cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" data-testid="intelligence-cards">
        <IntelligenceCardWidget
          title="Warmest Prospect"
          icon={Flame}
          iconColor="text-orange-500"
          card={intel?.warmestProspect ?? null}
          onAction={handleAction}
        />
        <IntelligenceCardWidget
          title="Highest Value"
          icon={DollarSign}
          iconColor="text-green-500"
          card={intel?.highestValueOpportunity ?? null}
          onAction={handleAction}
        />
        <IntelligenceCardWidget
          title="Most Urgent"
          icon={Zap}
          iconColor="text-yellow-500"
          card={intel?.mostUrgentFollowUp ?? null}
          onAction={handleAction}
        />
        <IntelligenceCardWidget
          title="Pipeline Risk"
          icon={ShieldAlert}
          iconColor="text-red-500"
          card={intel?.pipelineRisk ?? null}
        />
      </div>

      {/* Next best actions list */}
      {intel?.nextBestActions && intel.nextBestActions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" />
            Recommended Actions
          </h3>
          <div className="space-y-2">
            {intel.nextBestActions.map((item) => (
              <Card key={item.prospectId} className="p-3" data-testid={`nba-card-${item.prospectId}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{item.prospectName}</span>
                      {item.sport && item.sport !== "unknown" && <Badge variant="outline" className="text-xs">{item.sport}</Badge>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[item.nextBestAction.priority] ?? PRIORITY_COLOR.low}`}>
                        {item.nextBestAction.priority}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{item.nextBestAction.reason}</p>
                    {item.nextBestAction.explanation && (
                      <WhyPanel
                        explanation={item.nextBestAction.explanation}
                        testId={`why-nba-${item.prospectId}`}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.estimatedValue > 0 && (
                      <span className="text-xs font-medium text-green-700 dark:text-green-400">${item.estimatedValue.toLocaleString()}</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleAction(item.nextBestAction.recommendedPrompt, item.prospectName)}
                      data-testid={`nba-action-${item.prospectId}`}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      {ACTION_LABELS[item.nextBestAction.actionType] ?? "Act"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
interface GlobalAction {
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
}

interface GlobalPriorityQueue {
  topAction: GlobalAction | null;
  topThree: GlobalAction[];
  fullQueue: GlobalAction[];
  generatedAt: string;
}

const GP_CONFIDENCE: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

// ─── Auto-Execution Monitor Hook ─────────────────────────────────────────────
function useAutoExecution() {
  const { toast } = useToast();
  const triggeredRef = useRef(false);

  const { data: settings } = useQuery<EmailAgentSettings>({
    queryKey: ["/api/email-agent/settings"],
    staleTime: 30_000,
  });

  const undoMutation = useMutation({
    mutationFn: (executionId: string) =>
      apiRequest("POST", `/api/email-agent/auto-execute/undo/${executionId}`).then((r) => r.json()),
    onSuccess: (_, executionId) => {
      toast({ title: "Auto-execution undone", description: "The action has been reversed." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/auto-execute/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
    },
    onError: (e: any) => toast({ title: "Undo failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-agent/auto-execute/run").then((r) => r.json()),
    onSuccess: (data: { executed: boolean; execution: AutoExecution | null; reason?: string }) => {
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
              className="shrink-0 text-xs font-semibold underline text-primary hover:text-primary/80 flex items-center gap-1"
              onClick={() => undoMutation.mutate(exec.id)}
              data-testid="button-undo-auto-exec"
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
    // Short delay to avoid triggering before page fully loads
    const timer = setTimeout(() => {
      runMutation.mutate();
    }, 2000);
    return () => clearTimeout(timer);
  }, [settings?.autoExecuteEnabled]);
}

// ─── Performance Insights Section ────────────────────────────────────────────
function fmtDollars(dollars: number) {
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toLocaleString()}`;
}

function revActionLabel(actionType: string): string {
  const map: Record<string, string> = {
    send_follow_up: "Follow-up",
    generate_draft: "Draft outreach",
    send_initial_email: "Initial email",
    create_deal: "Deal created",
    generate_response: "Response",
    schedule_call: "Call scheduled",
    create_proposal: "Proposal sent",
  };
  return map[actionType] ?? actionType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function PerformanceInsightsSection() {
  const { data, isLoading } = useQuery<AiRevenueOutcomes>({
    queryKey: ["/api/email-agent/revenue-outcomes"],
    staleTime: 60_000,
  });

  const hasRevenue = !isLoading && data && data.month.revenue > 0;
  const topActions = data?.byActionType.slice(0, 4) ?? [];
  const recentWins = data?.impactFeed.filter(i => i.outcomeStatus === "won").slice(0, 4) ?? [];

  return (
    <div data-testid="section-performance-insights">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        Revenue Outcome Intelligence
      </h2>

      {/* Period stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card>
          <CardContent className="py-3 text-center">
            {isLoading
              ? <Skeleton className="h-7 w-16 mx-auto" />
              : <p className="text-xl font-bold text-primary" data-testid="text-ai-rev-today">{fmtDollars(data?.today.revenue ?? 0)}</p>
            }
            <p className="text-xs text-muted-foreground">Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            {isLoading
              ? <Skeleton className="h-7 w-16 mx-auto" />
              : <p className="text-xl font-bold" data-testid="text-ai-rev-week">{fmtDollars(data?.week.revenue ?? 0)}</p>
            }
            <p className="text-xs text-muted-foreground">This Week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            {isLoading
              ? <Skeleton className="h-7 w-16 mx-auto" />
              : <p className="text-xl font-bold" data-testid="text-ai-rev-month">{fmtDollars(data?.month.revenue ?? 0)}</p>
            }
            <p className="text-xs text-muted-foreground">This Month</p>
          </CardContent>
        </Card>
      </div>

      {!hasRevenue && !isLoading && (
        <Card className="border-dashed mb-4" data-testid="card-perf-insights-empty">
          <CardContent className="py-6 text-center">
            <Activity className="h-7 w-7 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">Attribution tracking active</p>
            <p className="text-xs text-muted-foreground mt-1">
              When deals are won or replies come in after AI actions, outcomes will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* By action type breakdown */}
      {topActions.length > 0 && (
        <Card className="mb-4" data-testid="card-action-type-breakdown">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Revenue by Action Type</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4 space-y-2">
            {topActions.map((at) => {
              const barPct = topActions[0].revenue > 0
                ? Math.round((at.revenue / topActions[0].revenue) * 100)
                : 0;
              return (
                <div key={at.actionType} className="space-y-1" data-testid={`row-action-type-${at.actionType}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{revActionLabel(at.actionType)}</span>
                    <span className="text-muted-foreground">{at.count} actions · {fmtDollars(at.revenue)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Auto vs Manual efficiency */}
      {data && data.autoVsManual.autoCount > 0 && data.autoVsManual.manualCount > 0 && (
        <Card className="mb-4" data-testid="card-auto-vs-manual">
          <CardContent className="py-4 px-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Auto vs Manual</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 rounded-lg bg-primary/5 border border-primary/15">
                <p className="text-lg font-bold text-primary">{fmtDollars(data.autoVsManual.autoRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Auto-executed</p>
                <p className="text-xs text-muted-foreground">{data.autoVsManual.autoCount} actions</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/40 border">
                <p className="text-lg font-bold">{fmtDollars(data.autoVsManual.manualRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Manual</p>
                <p className="text-xs text-muted-foreground">{data.autoVsManual.manualCount} actions</p>
              </div>
            </div>
            {data.autoVsManual.autoMultiplier > 1 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 rounded-md px-3 py-2">
                <Zap className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span>
                  Auto-executed actions generate{" "}
                  <span className="font-semibold text-foreground">{data.autoVsManual.autoMultiplier}×</span>
                  {" "}more revenue per action
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent wins feed */}
      {recentWins.length > 0 && (
        <Card data-testid="card-recent-wins">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-green-600" />
              Recent AI-Attributed Wins
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {recentWins.map((item) => (
              <div key={item.id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`row-win-${item.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {revActionLabel(item.actionType)}
                    {item.prospectName ? ` → ${item.prospectName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.sport ?? ""}
                    {item.timeToOutcomeHours != null
                      ? ` · closed in ${item.timeToOutcomeHours < 24 ? `${item.timeToOutcomeHours}h` : `${Math.round(item.timeToOutcomeHours / 24)}d`}`
                      : ""}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-green-600 dark:text-green-400">
                    {fmtDollars(item.outcomeValue)}
                  </p>
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
    </div>
  );
}

// ─── Auto-Execution Log Section ───────────────────────────────────────────────
function AutoExecLogSection() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AutoExecLogData>({
    queryKey: ["/api/email-agent/auto-execute/log"],
    staleTime: 30_000,
  });

  const undoMutation = useMutation({
    mutationFn: (executionId: string) =>
      apiRequest("POST", `/api/email-agent/auto-execute/undo/${executionId}`).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Undone successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/auto-execute/log"] });
    },
    onError: (e: any) => toast({ title: "Undo failed", description: e.message, variant: "destructive" }),
  });

  if (!data?.enabled && !isLoading) {
    return (
      <Card className="border-dashed" data-testid="card-auto-exec-disabled">
        <CardContent className="py-6 text-center text-muted-foreground">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Auto-execution is off</p>
          <p className="text-xs mt-1">Enable it in Settings to let the AI execute top-priority actions automatically.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="section-auto-exec-log">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-xl font-bold text-primary" data-testid="text-autoexec-today">{isLoading ? "—" : data?.todayCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Today / {data?.maxPerDay ?? 3} max</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-autoexec-success-rate">
              {isLoading ? "—" : `${data?.successRate ?? 0}%`}
            </p>
            <p className="text-xs text-muted-foreground">Success rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-xl font-bold" data-testid="text-autoexec-total">{isLoading ? "—" : data?.log.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">All-time</p>
          </CardContent>
        </Card>
      </div>

      {/* Execution log */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : !data?.log.length ? (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            No auto-executions yet. The AI will act on the next high-confidence opportunity.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.log.map((exec) => (
            <Card
              key={exec.id}
              className={`p-3 ${exec.undone ? "opacity-50" : ""} ${exec.outcome === "failed" ? "border-destructive/40" : ""}`}
              data-testid={`card-auto-exec-${exec.id}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-full p-1.5 shrink-0 ${exec.outcome === "success" ? "bg-green-500/15" : "bg-destructive/15"}`}>
                  {exec.outcome === "success"
                    ? <PlayCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    : <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium leading-tight">{exec.title}</p>
                    {exec.undone && <Badge variant="outline" className="text-xs text-muted-foreground">Undone</Badge>}
                    {exec.outcome === "failed" && <Badge variant="destructive" className="text-xs">Failed</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">{exec.actionType.replace(/_/g, " ")}</Badge>
                    {exec.estimatedValue > 0 && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        ${exec.estimatedValue.toLocaleString()}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(exec.executedAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  {exec.error && <p className="text-xs text-destructive mt-0.5">{exec.error}</p>}
                </div>
                {!exec.undone && exec.outcome === "success" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    onClick={() => undoMutation.mutate(exec.id)}
                    disabled={undoMutation.isPending}
                    data-testid={`button-undo-${exec.id}`}
                  >
                    <Undo2 className="h-3 w-3 mr-1" />
                    Undo
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobalPriorityPanel() {
  useAutoExecution();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<GlobalPriorityQueue>({
    queryKey: ["/api/email-agent/intelligence/global-priority"],
    staleTime: 60_000,
  });

  function execute(action: GlobalAction) {
    const msg = `Execute this top priority action: ${action.title}. Reason: ${action.reason}. Estimated value: $${action.estimatedValue.toLocaleString()}.`;
    navigator.clipboard?.writeText(msg).catch(() => {});
    toast({
      title: "Action copied to clipboard",
      description: "Paste this into the Agent or Email composer to execute.",
    });
  }

  if (isLoading) {
    return (
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2" data-testid="heading-global-priority-loading">
          <Flame className="h-4 w-4 text-orange-500" />
          Top Priority
        </h2>
        <Skeleton className="h-40 w-full rounded-xl mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data?.topAction) {
    return (
      <Card data-testid="card-global-priority-empty">
        <CardContent className="py-8 text-center text-muted-foreground">
          <Flame className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No priority actions yet</p>
          <p className="text-xs mt-1">Add prospects or advance deals to unlock global priority recommendations.</p>
        </CardContent>
      </Card>
    );
  }

  const { topAction, topThree } = data;
  const nextTwo = topThree.slice(1);

  return (
    <div data-testid="section-global-priority">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2" data-testid="heading-global-priority">
        <Flame className="h-4 w-4 text-orange-500" />
        Top Priority
      </h2>

      <Card
        className="border-orange-400/50 bg-gradient-to-br from-orange-500/10 to-red-500/5 dark:from-orange-500/15 dark:to-red-500/10 mb-3"
        data-testid="card-top-priority"
      >
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-orange-500/20 p-2 shrink-0">
              <Flame className="h-5 w-5 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <Badge className="bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30 text-xs">
                  Score {topAction.priorityScore}/100
                </Badge>
                <Badge className={`text-xs ${GP_CONFIDENCE[topAction.confidence]}`}>
                  {topAction.confidence.charAt(0).toUpperCase() + topAction.confidence.slice(1)} confidence
                </Badge>
                {topAction.sport && (
                  <Badge variant="outline" className="text-xs capitalize">{topAction.sport}</Badge>
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
        </CardContent>
      </Card>

      {nextTwo.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Next Best Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="list-next-best-actions">
            {nextTwo.map((action, i) => (
              <Card
                key={action.id}
                className="cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => execute(action)}
                data-testid={`card-next-action-${i}`}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-2">
                    <ArrowRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{action.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{action.reason}</p>
                      {action.estimatedValue > 0 && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                          ${action.estimatedValue.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs shrink-0">
                      {action.priorityScore}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab() {
  const { toast } = useToast();

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<EmailAgentOverview>({
    queryKey: ["/api/email-agent/overview"],
  });
  const { data: queue, isLoading: queueLoading, refetch: refetchQueue } = useQuery<TeamTrainingProspect[]>({
    queryKey: ["/api/email-agent/queue"],
  });
  const { data: perf, isLoading: perfLoading } = useQuery<EmailPerformanceStats>({
    queryKey: ["/api/email-agent/performance"],
  });

  const buildQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-agent/queue/build").then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Queue built", description: `${data.count} prospects queued for today.` });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateDraftMutation = useMutation({
    mutationFn: (prospectId: string) =>
      apiRequest("POST", `/api/admin/team-training/prospects/${prospectId}/generate-email`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Draft generated", description: "Check the Drafts tab to review." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/prospects/${id}/do-not-contact`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Marked Do Not Contact" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/queue"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sentToday = overview?.sentToday ?? 0;
  const dailyLimit = overview?.dailyLimit ?? 10;
  const limitReached = sentToday >= dailyLimit;

  return (
    <div className="space-y-6">
      {/* Global Priority Engine + Auto-Execute */}
      <GlobalPriorityPanel />

      {/* Auto-Execution Log */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2" data-testid="heading-auto-exec-log">
          <PlayCircle className="h-4 w-4 text-primary" />
          Auto-Execution
        </h2>
        <AutoExecLogSection />
      </div>

      {/* Revenue Outcome Intelligence */}
      <PerformanceInsightsSection />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card data-testid="card-emails-sent-today">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Send className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Sent Today</span>
            </div>
            {overviewLoading ? <Skeleton className="h-7 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-sent-today">
                {sentToday} / {dailyLimit}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Daily limit</p>
          </CardContent>
        </Card>
        <Card data-testid="card-prospect-list">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Prospects</span>
            </div>
            {overviewLoading ? <Skeleton className="h-7 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-total-prospects">{overview?.totalProspects ?? 0}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">{overview?.prospectsWithEmail ?? 0} with email</p>
          </CardContent>
        </Card>
        <Card data-testid="card-replies">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Replied</span>
            </div>
            {overviewLoading ? <Skeleton className="h-7 w-16" /> : (
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-replied">{overview?.replied ?? 0}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Interested prospects</p>
          </CardContent>
        </Card>
        <Card data-testid="card-pipeline">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Est. Pipeline</span>
            </div>
            {overviewLoading ? <Skeleton className="h-7 w-16" /> : (
              <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-pipeline">
                ${((overview?.estimatedPipeline ?? 0)).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Active prospects</p>
          </CardContent>
        </Card>
        <Card data-testid="card-queue-size">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Today's Queue</span>
            </div>
            {queueLoading ? <Skeleton className="h-7 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-queue-size">{queue?.length ?? 0}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Selected for today</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Limit Warning */}
      {limitReached && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300 font-medium" data-testid="text-daily-limit-reached">
              Daily outreach limit reached. {sentToday} / {dailyLimit} emails sent today.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Email Performance Section */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2" data-testid="heading-email-performance">
          <TrendingUp className="h-4 w-4 text-primary" />
          Email Performance
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Card data-testid="card-open-rate">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Eye className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Open Rate</span>
              </div>
              {perfLoading ? <Skeleton className="h-7 w-16" /> : (
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-open-rate">
                  {perf?.openRate ?? 0}%
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{perf?.opened ?? 0} of {perf?.sent ?? 0} sent</p>
            </CardContent>
          </Card>
          <Card data-testid="card-reply-rate">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="h-4 w-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">Reply Rate</span>
              </div>
              {perfLoading ? <Skeleton className="h-7 w-16" /> : (
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-reply-rate">
                  {perf?.replyRate ?? 0}%
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{perf?.replied ?? 0} replies</p>
            </CardContent>
          </Card>
          <Card data-testid="card-conversion-rate">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Conversion Rate</span>
              </div>
              {perfLoading ? <Skeleton className="h-7 w-16" /> : (
                <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-conversion-rate">
                  {perf?.conversionRate ?? 0}%
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">Replied or booked</p>
            </CardContent>
          </Card>
          <Card data-testid="card-best-variant">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Best Message</span>
              </div>
              {perfLoading ? <Skeleton className="h-7 w-28" /> : (
                <p className="text-sm font-bold truncate" data-testid="text-best-variant">
                  {perf?.bestVariant?.name ?? "—"}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {perf?.bestVariant ? `Score: ${perf.bestVariant.performanceScore}` : "No variants yet"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Insight line */}
        {perf && perf.sent > 0 && (
          <Card className="border-primary/20 bg-primary/5 dark:bg-primary/10" data-testid="card-perf-insight">
            <CardContent className="pt-3 pb-3 flex items-start gap-3">
              <Bot className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-foreground" data-testid="text-perf-insight">
                {perf.conversionRate > 0
                  ? `Your outreach is converting at ${perf.conversionRate}%. ${
                      perf.bestVariant
                        ? `Best results are coming from "${perf.bestVariant.name}" messages.`
                        : ""
                    } ${
                      perf.openRate > 30 && perf.replyRate < 5
                        ? "Opens are strong but replies are low — consider shorter, more direct messages."
                        : ""
                    }`
                  : `${perf.sent} email${perf.sent !== 1 ? "s" : ""} sent so far. Replies and opens will appear here as responses come in.`
                }
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Agent Intelligence */}
      <AgentIntelligenceSection />

      {/* Today's Outreach Queue */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-base font-semibold" data-testid="heading-outreach-queue">Today's Outreach Queue</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchOverview(); refetchQueue(); }}
              data-testid="button-refresh-queue"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => buildQueueMutation.mutate()}
              disabled={buildQueueMutation.isPending || limitReached}
              data-testid="button-build-queue"
            >
              {buildQueueMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
              Build Queue
            </Button>
          </div>
        </div>

        {queueLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : !queue || queue.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-empty-queue">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No prospects in today's queue</p>
              <p className="text-sm mt-1">Click "Build Queue" to auto-select up to {dailyLimit} prospects</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {queue.map((prospect) => (
              <QueueProspectCard
                key={prospect.id}
                prospect={prospect}
                onGenerateDraft={() => generateDraftMutation.mutate(prospect.id)}
                onSkip={() => dncMutation.mutate(prospect.id)}
                generatingDraft={generateDraftMutation.isPending}
                limitReached={limitReached}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueProspectCard({
  prospect,
  onGenerateDraft,
  onSkip,
  generatingDraft,
  limitReached,
}: {
  prospect: TeamTrainingProspect;
  onGenerateDraft: () => void;
  onSkip: () => void;
  generatingDraft: boolean;
  limitReached: boolean;
}) {
  const { toast } = useToast();
  const [showDraftDialog, setShowDraftDialog] = useState(false);

  const { data: drafts } = useQuery<TeamTrainingOutreachDraft[]>({
    queryKey: ["/api/admin/team-training/prospects", prospect.id, "drafts"],
    queryFn: () => fetch(`/api/admin/team-training/prospects/${prospect.id}/drafts`).then(r => r.json()),
  });
  const latestDraft = drafts?.[0];

  const sendMutation = useMutation({
    mutationFn: (draftId: string) => apiRequest("POST", `/api/admin/team-training/drafts/${draftId}/send`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Email sent!", description: `Outreach sent to ${prospect.contactEmail}` });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects", prospect.id, "drafts"] });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (draftId: string) => apiRequest("POST", `/api/admin/team-training/drafts/${draftId}/approve`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Draft approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects", prospect.id, "drafts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="p-4" data-testid={`card-queue-prospect-${prospect.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" data-testid={`text-queue-name-${prospect.id}`}>{prospect.prospectName}</span>
            <Badge className={`text-xs ${STATUS_COLORS[prospect.outreachStatus || "New"]}`}>{prospect.outreachStatus}</Badge>
            {prospect.sport && prospect.sport !== "unknown" && (
              <Badge variant="outline" className="text-xs">{prospect.sport}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
            {prospect.contactName && prospect.contactName !== "unknown" && (
              <span>{prospect.contactName}{prospect.contactRole && prospect.contactRole !== "unknown" ? ` · ${prospect.contactRole}` : ""}</span>
            )}
            {prospect.contactEmail && (
              <span className="font-mono" data-testid={`text-queue-email-${prospect.id}`}>{prospect.contactEmail}</span>
            )}
            {prospect.city && prospect.city !== "unknown" && (
              <span>{prospect.city}{prospect.state && prospect.state !== "unknown" ? `, ${prospect.state}` : ""}</span>
            )}
          </div>
          {typeof prospect.confidenceScore === "number" && (
            <div className="mt-2 max-w-xs">
              <ConfidenceBar score={prospect.confidenceScore} />
            </div>
          )}
          {prospect.estimatedValue && (
            <p className="text-xs text-muted-foreground mt-1">Est. value: <span className="font-medium text-foreground">${prospect.estimatedValue.toLocaleString()}</span></p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {latestDraft && (
            <Button size="sm" variant="outline" onClick={() => setShowDraftDialog(true)} data-testid={`button-view-draft-${prospect.id}`}>
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Draft
            </Button>
          )}
          {!latestDraft && (
            <Button size="sm" variant="outline" onClick={onGenerateDraft} disabled={generatingDraft} data-testid={`button-gen-draft-${prospect.id}`}>
              {generatingDraft ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Bot className="h-3.5 w-3.5 mr-1.5" />}
              Generate Draft
            </Button>
          )}
          {latestDraft && !latestDraft.sentAt && (
            <>
              {!latestDraft.approved && (
                <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(latestDraft.id)} disabled={approveMutation.isPending} data-testid={`button-approve-${prospect.id}`}>
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  Approve
                </Button>
              )}
              {latestDraft.approved && (
                <Button size="sm" onClick={() => sendMutation.mutate(latestDraft.id)} disabled={sendMutation.isPending || limitReached} data-testid={`button-send-now-${prospect.id}`}>
                  {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                  Send Now
                </Button>
              )}
            </>
          )}
          {latestDraft?.sentAt && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Sent</Badge>
          )}
          <Button size="sm" variant="ghost" onClick={onSkip} className="text-muted-foreground hover:text-red-600" data-testid={`button-dnc-${prospect.id}`}>
            <PhoneOff className="h-3.5 w-3.5 mr-1.5" />
            DNC
          </Button>
        </div>
      </div>

      {/* Draft Preview Dialog */}
      {latestDraft && (
        <Dialog open={showDraftDialog} onOpenChange={setShowDraftDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Email Draft — {prospect.prospectName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
                <p className="font-medium" data-testid="text-draft-subject">{latestDraft.subject}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
                <div className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto" data-testid="text-draft-body">
                  {latestDraft.body}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDraftDialog(false)} data-testid="button-close-draft">Close</Button>
              {!latestDraft.approved && (
                <Button onClick={() => { approveMutation.mutate(latestDraft.id); setShowDraftDialog(false); }} disabled={approveMutation.isPending} data-testid="button-approve-from-dialog">
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  Approve Draft
                </Button>
              )}
              {latestDraft.approved && !latestDraft.sentAt && (
                <Button onClick={() => { sendMutation.mutate(latestDraft.id); setShowDraftDialog(false); }} disabled={sendMutation.isPending} data-testid="button-send-from-dialog">
                  <Send className="h-4 w-4 mr-1.5" />
                  Send Now
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ─── Prospects Tab ────────────────────────────────────────────────────────────
function ProspectsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editProspect, setEditProspect] = useState<TeamTrainingProspect | null>(null);
  const [researchSport, setResearchSport] = useState("any");

  const { data: prospects, isLoading, refetch } = useQuery<TeamTrainingProspect[]>({
    queryKey: ["/api/admin/team-training/prospects"],
  });

  const filtered = useMemo(() => {
    if (!prospects) return [];
    return prospects.filter(p => {
      if (statusFilter !== "all" && p.outreachStatus !== statusFilter) return false;
      if (sportFilter !== "all" && p.sport?.toLowerCase() !== sportFilter.toLowerCase()) return false;
      if (emailFilter === "has_email" && !p.contactEmail) return false;
      if (emailFilter === "no_email" && p.contactEmail) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.prospectName.toLowerCase().includes(q) ||
          (p.contactEmail || "").toLowerCase().includes(q) ||
          (p.city || "").toLowerCase().includes(q) ||
          (p.sport || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [prospects, statusFilter, sportFilter, emailFilter, search]);

  const researchMutation = useMutation({
    mutationFn: (sport?: string) => apiRequest("POST", "/api/admin/team-training/research", { sport: sport || undefined, limit: 10 }).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Research complete", description: `Found ${data.count} prospects.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateDraftMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/prospects/${id}/generate-email`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Draft generated", description: "Review it in the Drafts tab." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/prospects/${id}/do-not-contact`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Marked Do Not Contact" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/team-training/prospects/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => researchMutation.mutate(researchSport === "any" ? undefined : researchSport)}
            disabled={researchMutation.isPending}
            data-testid="button-find-prospects"
          >
            {researchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
            Find Team Prospects
          </Button>
          <Select value={researchSport} onValueChange={setResearchSport}>
            <SelectTrigger className="w-36 h-9" data-testid="select-research-sport">
              <SelectValue placeholder="Any sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any sport</SelectItem>
              {SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-prospects">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)} data-testid="button-add-prospect">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Prospect
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search prospects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-prospect-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9" data-testid="select-prospect-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sportFilter} onValueChange={setSportFilter}>
          <SelectTrigger className="w-32 h-9" data-testid="select-prospect-sport">
            <SelectValue placeholder="All sports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sports</SelectItem>
            {SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={emailFilter} onValueChange={setEmailFilter}>
          <SelectTrigger className="w-32 h-9" data-testid="select-email-filter">
            <SelectValue placeholder="Email" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="has_email">Has Email</SelectItem>
            <SelectItem value="no_email">No Email</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Progress banner from research */}
      {researchMutation.isPending && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm">Researching local athletic teams. This may take 30–60 seconds...</span>
          </CardContent>
        </Card>
      )}

      {/* Prospect List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-prospects">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="font-medium">{prospects?.length === 0 ? "No prospects yet" : "No prospects match your filters"}</p>
            {prospects?.length === 0 && (
              <p className="text-sm mt-1">Click "Find Team Prospects" to auto-discover local athletic teams</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{filtered.length} of {prospects?.length} prospects</p>
          {filtered.map(p => (
            <ProspectCard
              key={p.id}
              prospect={p}
              onGenerateDraft={() => generateDraftMutation.mutate(p.id)}
              onEdit={() => setEditProspect(p)}
              onDnc={() => dncMutation.mutate(p.id)}
              onDelete={() => deleteMutation.mutate(p.id)}
            />
          ))}
        </div>
      )}

      <AddProspectDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      {editProspect && (
        <AddProspectDialog
          open={!!editProspect}
          onClose={() => setEditProspect(null)}
          prospect={editProspect}
        />
      )}
    </div>
  );
}

function ProspectCard({
  prospect,
  onGenerateDraft,
  onEdit,
  onDnc,
  onDelete,
}: {
  prospect: TeamTrainingProspect;
  onGenerateDraft: () => void;
  onEdit: () => void;
  onDnc: () => void;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: intel, isLoading: intelLoading } = useQuery<ProspectIntelligence>({
    queryKey: ["/api/email-agent/prospects", prospect.id, "intelligence"],
    queryFn: () => fetch(`/api/email-agent/prospects/${prospect.id}/intelligence`).then(r => r.json()),
    enabled: expanded,
    staleTime: 60_000,
  });

  function handleAskAgent() {
    const prompt = intel?.intelligence?.nextBestAction?.recommendedPrompt
      ?? `Analyze this prospect and tell me the best next action: ${prospect.prospectName} (${prospect.sport ?? "sport unknown"}, ${prospect.city ?? "location unknown"}).`;
    navigator.clipboard.writeText(prompt).then(() => {
      toast({ title: "Prompt copied!", description: "Paste it in your agent chat to get a full analysis.", duration: 4000 });
    });
  }

  const scores = intel?.intelligence?.scores;
  const nba = intel?.intelligence?.nextBestAction;

  return (
    <Card className="p-4" data-testid={`card-prospect-${prospect.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" data-testid={`text-prospect-name-${prospect.id}`}>{prospect.prospectName}</span>
            <Badge className={`text-xs ${STATUS_COLORS[prospect.outreachStatus || "New"]}`} data-testid={`badge-prospect-status-${prospect.id}`}>{prospect.outreachStatus}</Badge>
            {prospect.sport && prospect.sport !== "unknown" && (
              <Badge variant="outline" className="text-xs">{prospect.sport}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
            <span>{prospect.organizationType}</span>
            {prospect.city && prospect.city !== "unknown" && <span>{prospect.city}{prospect.state && prospect.state !== "unknown" ? `, ${prospect.state}` : ""}</span>}
            {prospect.contactEmail ? (
              <span className="font-mono text-foreground" data-testid={`text-prospect-email-${prospect.id}`}>{prospect.contactEmail}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">No email</span>
            )}
          </div>
          {typeof prospect.confidenceScore === "number" && (
            <div className="mt-2 max-w-xs"><ConfidenceBar score={prospect.confidenceScore} /></div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {prospect.contactEmail && prospect.outreachStatus !== "Do Not Contact" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onGenerateDraft} data-testid={`button-gen-draft-prospect-${prospect.id}`}>
              <Bot className="h-3 w-3 mr-1" />Draft
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit} data-testid={`button-edit-prospect-${prospect.id}`}>
            <Edit2 className="h-3 w-3 mr-1" />Edit
          </Button>
          {prospect.outreachStatus !== "Do Not Contact" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-red-600" onClick={onDnc} data-testid={`button-dnc-prospect-${prospect.id}`}>
              <PhoneOff className="h-3 w-3 mr-1" />DNC
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={onDelete} data-testid={`button-delete-prospect-${prospect.id}`}>
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setExpanded(e => !e)} data-testid={`button-expand-prospect-${prospect.id}`}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* Basic details */}
          <div className="text-sm space-y-1">
            {prospect.contactName && prospect.contactName !== "unknown" && <p><span className="text-muted-foreground">Contact:</span> {prospect.contactName}{prospect.contactRole && prospect.contactRole !== "unknown" ? ` (${prospect.contactRole})` : ""}</p>}
            {prospect.contactPhone && <p><span className="text-muted-foreground">Phone:</span> {prospect.contactPhone}</p>}
            {prospect.websiteUrl && <p><span className="text-muted-foreground">Website:</span> <a href={prospect.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{prospect.websiteUrl}</a></p>}
            {prospect.notes && prospect.notes !== "" && <p><span className="text-muted-foreground">Notes:</span> {prospect.notes}</p>}
            {prospect.lastContactedAt && <p><span className="text-muted-foreground">Last contacted:</span> {format(new Date(prospect.lastContactedAt), "MMM d, yyyy")}</p>}
          </div>

          {/* Intelligence panel */}
          <div className="rounded-lg border bg-muted/30 p-3" data-testid={`intelligence-panel-${prospect.id}`}>
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold">Intelligence</span>
            </div>
            {intelLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
              </div>
            ) : scores ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <ScoreBar label="Warmth" score={scores.warmth} color={scores.warmth >= 60 ? "bg-orange-500" : scores.warmth >= 30 ? "bg-yellow-500" : "bg-muted-foreground/40"} />
                  <ScoreBar label="Urgency" score={scores.urgency} color={scores.urgency >= 60 ? "bg-red-500" : scores.urgency >= 30 ? "bg-amber-500" : "bg-muted-foreground/40"} />
                  <ScoreBar label="Fit" score={scores.fit} color={scores.fit >= 60 ? "bg-green-500" : scores.fit >= 30 ? "bg-blue-500" : "bg-muted-foreground/40"} />
                  <ScoreBar label="Risk" score={scores.risk} color={scores.risk >= 60 ? "bg-red-500" : scores.risk >= 30 ? "bg-amber-500" : "bg-muted-foreground/40"} />
                </div>
                {nba && (
                  <div className="mt-2 rounded-md bg-background border p-2 space-y-1">
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium">{ACTION_LABELS[nba.actionType] ?? nba.actionType}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${PRIORITY_COLOR[nba.priority] ?? PRIORITY_COLOR.low}`}>{nba.priority}</span>
                          {nba.requiresApproval && <span className="text-xs text-amber-600 dark:text-amber-400">requires approval</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{nba.reason}</p>
                      </div>
                    </div>
                    {nba.explanation && (
                      <WhyPanel
                        explanation={nba.explanation}
                        testId={`why-prospect-${prospect.id}`}
                      />
                    )}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs mt-1"
                  onClick={handleAskAgent}
                  data-testid={`button-ask-agent-${prospect.id}`}
                >
                  <Brain className="h-3 w-3 mr-1.5" />
                  Ask Agent About This Prospect
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Could not load intelligence data.</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function AddProspectDialog({ open, onClose, prospect }: { open: boolean; onClose: () => void; prospect?: TeamTrainingProspect }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    prospectName: prospect?.prospectName ?? "",
    sport: prospect?.sport ?? "",
    organizationType: prospect?.organizationType ?? "",
    contactName: prospect?.contactName ?? "",
    contactEmail: prospect?.contactEmail ?? "",
    contactPhone: prospect?.contactPhone ?? "",
    city: prospect?.city ?? "",
    state: prospect?.state ?? "",
    websiteUrl: prospect?.websiteUrl ?? "",
    notes: prospect?.notes ?? "",
    estimatedValue: prospect?.estimatedValue?.toString() ?? "",
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        estimatedValue: form.estimatedValue ? parseInt(form.estimatedValue) : null,
        confidenceScore: 75,
      };
      if (prospect) {
        return apiRequest("PATCH", `/api/admin/team-training/prospects/${prospect.id}`, body).then(r => r.json());
      }
      return apiRequest("POST", "/api/admin/team-training/prospects", body).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: prospect ? "Prospect updated" : "Prospect added" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prospect ? "Edit Prospect" : "Add Prospect"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="prospectName">Team / School / Org Name *</Label>
            <Input id="prospectName" value={form.prospectName} onChange={e => set("prospectName", e.target.value)} placeholder="e.g. Westside FC Youth" className="mt-1" data-testid="input-prospect-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sport">Sport</Label>
              <Select value={form.sport} onValueChange={v => set("sport", v)}>
                <SelectTrigger className="mt-1" data-testid="select-prospect-sport-add">
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent>
                  {SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="orgType">Org Type</Label>
              <Input id="orgType" value={form.organizationType} onChange={e => set("organizationType", e.target.value)} placeholder="e.g. Club Team" className="mt-1" data-testid="input-prospect-orgtype" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contactName">Contact Name</Label>
              <Input id="contactName" value={form.contactName} onChange={e => set("contactName", e.target.value)} placeholder="Coach Smith" className="mt-1" data-testid="input-prospect-contact-name" />
            </div>
            <div>
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input id="contactEmail" type="email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} placeholder="coach@team.com" className="mt-1" data-testid="input-prospect-contact-email" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={form.city} onChange={e => set("city", e.target.value)} placeholder="Springfield" className="mt-1" data-testid="input-prospect-city" />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" value={form.state} onChange={e => set("state", e.target.value)} placeholder="OH" className="mt-1" data-testid="input-prospect-state" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="website">Website</Label>
              <Input id="website" value={form.websiteUrl} onChange={e => set("websiteUrl", e.target.value)} placeholder="https://..." className="mt-1" data-testid="input-prospect-website" />
            </div>
            <div>
              <Label htmlFor="estimatedValue">Est. Value ($)</Label>
              <Input id="estimatedValue" type="number" value={form.estimatedValue} onChange={e => set("estimatedValue", e.target.value)} placeholder="2500" className="mt-1" data-testid="input-prospect-value" />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Any relevant context..." rows={2} className="mt-1" data-testid="input-prospect-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-prospect">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.prospectName} data-testid="button-save-prospect">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {prospect ? "Save Changes" : "Add Prospect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drafts Tab ───────────────────────────────────────────────────────────────
function DraftsTab() {
  const { toast } = useToast();
  const [editDraft, setEditDraft] = useState<DraftWithProspect | null>(null);

  const { data: drafts, isLoading, refetch } = useQuery<DraftWithProspect[]>({
    queryKey: ["/api/admin/team-training/drafts"],
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/drafts/${id}/approve`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Draft approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/drafts/${id}/send`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Email sent!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const updateDraftMutation = useMutation({
    mutationFn: ({ id, subject, body }: { id: string; subject: string; body: string }) =>
      apiRequest("PATCH", `/api/admin/team-training/drafts/${id}`, { subject, body }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Draft saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      setEditDraft(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pending = drafts?.filter(d => !d.sentAt) ?? [];
  const sent = drafts?.filter(d => !!d.sentAt) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">AI-Generated Drafts</h2>
          <p className="text-xs text-muted-foreground">{pending.length} pending approval · {sent.length} sent</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-drafts">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : pending.length === 0 && sent.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-drafts">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No drafts yet</p>
            <p className="text-sm mt-1">Generate drafts from the Prospects tab or the Overview queue</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map(draft => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onApprove={() => approveMutation.mutate(draft.id)}
              onSend={() => sendMutation.mutate(draft.id)}
              onEdit={() => setEditDraft(draft)}
              approving={approveMutation.isPending}
              sending={sendMutation.isPending}
            />
          ))}
          {sent.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground pt-2">Sent</p>
              {sent.map(draft => (
                <DraftCard key={draft.id} draft={draft} sent />
              ))}
            </>
          )}
        </div>
      )}

      {editDraft && (
        <EditDraftDialog
          draft={editDraft}
          onClose={() => setEditDraft(null)}
          onSave={(subject, body) => updateDraftMutation.mutate({ id: editDraft.id, subject, body })}
          saving={updateDraftMutation.isPending}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft,
  onApprove,
  onSend,
  onEdit,
  approving,
  sending,
  sent,
}: {
  draft: DraftWithProspect;
  onApprove?: () => void;
  onSend?: () => void;
  onEdit?: () => void;
  approving?: boolean;
  sending?: boolean;
  sent?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`p-4 ${sent ? "opacity-70" : ""}`} data-testid={`card-draft-${draft.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate" data-testid={`text-draft-prospect-${draft.id}`}>
              {draft.prospect?.prospectName || "Unknown Prospect"}
            </span>
            {draft.sentAt ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">Sent</Badge>
            ) : draft.approved ? (
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">Approved</Badge>
            ) : (
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-xs">Pending Review</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-draft-subject-${draft.id}`}>Subject: {draft.subject}</p>
          {draft.sentAt && (
            <p className="text-xs text-muted-foreground mt-0.5">Sent {format(new Date(draft.sentAt), "MMM d, yyyy h:mm a")}</p>
          )}
        </div>
        {!sent && (
          <div className="flex gap-1.5 shrink-0 flex-wrap">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpanded(e => !e)} data-testid={`button-expand-draft-${draft.id}`}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
              {!expanded && "Preview"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit} data-testid={`button-edit-draft-${draft.id}`}>
              <Edit2 className="h-3 w-3 mr-1" />Edit
            </Button>
            {!draft.approved && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onApprove} disabled={approving} data-testid={`button-approve-draft-${draft.id}`}>
                <CheckCircle className="h-3 w-3 mr-1" />Approve
              </Button>
            )}
            {draft.approved && !draft.sentAt && (
              <Button size="sm" className="h-7 text-xs" onClick={onSend} disabled={sending} data-testid={`button-send-draft-${draft.id}`}>
                {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}Send
              </Button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t">
          <div className="bg-muted/50 rounded p-3 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto" data-testid={`text-draft-body-${draft.id}`}>
            {draft.body}
          </div>
        </div>
      )}
    </Card>
  );
}

function EditDraftDialog({
  draft,
  onClose,
  onSave,
  saving,
}: {
  draft: DraftWithProspect;
  onClose: () => void;
  onSave: (subject: string, body: string) => void;
  saving: boolean;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Draft — {draft.prospect?.prospectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" data-testid="input-edit-subject" />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={12} className="mt-1 font-mono text-sm" data-testid="input-edit-body" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">Cancel</Button>
          <Button onClick={() => onSave(subject, body)} disabled={saving} data-testid="button-save-draft-edit">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reply Classification Dialog ──────────────────────────────────────────────
function ReplyDialog({
  prospectId,
  prospectName,
  onClose,
}: { prospectId: string; prospectName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [manualClassification, setManualClassification] = useState<ReplyClassification | "">("");

  const markRepliedMutation = useMutation({
    mutationFn: (body: { replyText?: string; replyClassification?: string }) =>
      apiRequest("POST", `/api/admin/team-training/prospects/${prospectId}/mark-replied`, body).then(r => r.json()),
    onSuccess: (data) => {
      const cls = data.classification ? classificationLabel(data.classification) : null;
      toast({
        title: "Marked as replied",
        description: cls ? `Classified as: ${cls}` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-ups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-up-stats"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    const body: { replyText?: string; replyClassification?: string } = {};
    if (replyText.trim()) body.replyText = replyText.trim();
    if (manualClassification) body.replyClassification = manualClassification;
    markRepliedMutation.mutate(body);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Reply — {prospectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label className="text-sm font-medium">Paste their reply <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder="Paste the reply text here for AI classification…"
              rows={4}
              className="mt-1.5 text-sm"
              data-testid="input-reply-text"
            />
            {replyText.trim() && !manualClassification && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Bot className="h-3 w-3" /> AI will auto-classify this reply
              </p>
            )}
          </div>
          <div>
            <Label className="text-sm font-medium">Classification <span className="text-muted-foreground">(optional override)</span></Label>
            <Select value={manualClassification} onValueChange={v => setManualClassification(v as ReplyClassification)}>
              <SelectTrigger className="mt-1.5" data-testid="select-reply-classification">
                <SelectValue placeholder="Auto-classify from text…" />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>Marking as replied will automatically cancel pending follow-up emails for this prospect.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-reply-dialog">Cancel</Button>
          <Button onClick={handleSubmit} disabled={markRepliedMutation.isPending} data-testid="button-submit-replied">
            {markRepliedMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Mark Replied
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Follow-Ups Tab ────────────────────────────────────────────────────────────
function FollowUpsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);

  const { data: followUps, isLoading, refetch } = useQuery<FollowUpWithProspect[]>({
    queryKey: ["/api/email-agent/follow-ups"],
  });
  const { data: stats } = useQuery<{ activeSequences: number; pendingReplies: number; interestedLeads: number }>({
    queryKey: ["/api/email-agent/follow-up-stats"],
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/email-agent/follow-ups/${id}/cancel`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Follow-up cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-ups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-up-stats"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelSequenceMutation = useMutation({
    mutationFn: (draftId: string) => apiRequest("POST", `/api/email-agent/follow-ups/cancel-sequence/${draftId}`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Sequence cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-ups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/follow-up-stats"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Group by outreachDraftId for sequence view
  const grouped = useMemo(() => {
    if (!followUps) return [];
    const map = new Map<string, FollowUpWithProspect[]>();
    for (const f of followUps) {
      const arr = map.get(f.outreachDraftId) ?? [];
      arr.push(f);
      map.set(f.outreachDraftId, arr);
    }
    return Array.from(map.entries()).map(([draftId, steps]) => ({
      draftId,
      prospect: steps[0]?.prospect,
      steps: steps.sort((a, b) => a.stepNumber - b.stepNumber),
      hasPending: steps.some(s => s.status === "pending"),
    }));
  }, [followUps]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return grouped;
    if (statusFilter === "active") return grouped.filter(g => g.hasPending);
    if (statusFilter === "done") return grouped.filter(g => !g.hasPending);
    return grouped;
  }, [grouped, statusFilter]);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card data-testid="card-active-sequences">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <RepeatIcon className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Active Sequences</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-active-sequences">
              {stats?.activeSequences ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-interested-leads">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Interested Leads</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-interested-leads">
              {stats?.interestedLeads ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-pending-replies">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Pending Replies</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-pending-replies">
              {stats?.pendingReplies ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + refresh */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9" data-testid="select-followup-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sequences</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="done">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-followups">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Sequences */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-followups">
            <RepeatIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No follow-up sequences</p>
            <p className="text-sm mt-1">Follow-up sequences are created automatically when an outreach email is sent.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ draftId, prospect, steps, hasPending }) => (
            <Card key={draftId} data-testid={`card-followup-sequence-${draftId}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{prospect?.prospectName ?? "Unknown"}</span>
                      {prospect?.sport && prospect.sport !== "unknown" && (
                        <Badge variant="outline" className="text-xs">{prospect.sport}</Badge>
                      )}
                      <Badge className={`text-xs ${hasPending ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                        {hasPending ? "Active" : "Done"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {prospect?.contactEmail ?? "—"}
                    </p>
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setExpandedDraft(expandedDraft === draftId ? null : draftId)}
                      data-testid={`button-expand-sequence-${draftId}`}
                    >
                      {expandedDraft === draftId ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {steps.length} step{steps.length !== 1 ? "s" : ""}
                    </Button>
                    {hasPending && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground hover:text-red-600"
                        onClick={() => cancelSequenceMutation.mutate(draftId)}
                        disabled={cancelSequenceMutation.isPending}
                        data-testid={`button-cancel-sequence-${draftId}`}
                      >
                        <Ban className="h-3 w-3 mr-1" />Cancel All
                      </Button>
                    )}
                  </div>
                </div>

                {expandedDraft === draftId && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    {steps.map(step => (
                      <div key={step.id} className="flex items-center gap-3 text-xs" data-testid={`row-followup-step-${step.id}`}>
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground shrink-0">
                          {step.stepNumber}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">
                            Follow-up #{step.stepNumber}
                            {step.subject && <span className="font-normal text-muted-foreground"> — {step.subject}</span>}
                          </p>
                          <p className="text-muted-foreground">
                            {step.status === "sent" && step.sentAt
                              ? `Sent ${format(new Date(step.sentAt), "MMM d, yyyy")}`
                              : step.status === "pending"
                              ? `Scheduled for ${format(new Date(step.scheduledFor), "MMM d, yyyy")}`
                              : `${(step.status ?? "unknown").charAt(0).toUpperCase() + (step.status ?? "unknown").slice(1)}`
                            }
                          </p>
                        </div>
                        <Badge className={`text-xs ${FOLLOW_UP_STATUS_COLORS[step.status ?? "pending"] ?? ""}`}>
                          {step.status}
                        </Badge>
                        {step.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                            onClick={() => cancelMutation.mutate(step.id)}
                            disabled={cancelMutation.isPending}
                            data-testid={`button-cancel-step-${step.id}`}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sent Tab ─────────────────────────────────────────────────────────────────
function SentTab() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { toast } = useToast();

  const { data: logs, isLoading, refetch, isFetching } = useQuery<CommunicationLog[]>({
    queryKey: ["/api/communication-logs"],
  });

  const { data: sentDrafts, isLoading: draftsLoading } = useQuery<DraftWithProspect[]>({
    queryKey: ["/api/admin/team-training/drafts"],
  });

  const markRepliedMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/prospects/${id}/mark-replied`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Marked as replied" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/team-training/prospects/${id}/do-not-contact`, {}).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Marked Do Not Contact" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter((log) => {
      if (typeFilter !== "all" && log.type !== typeFilter) return false;
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!(log.recipientEmail || "").toLowerCase().includes(q) && !(log.subject || "").toLowerCase().includes(q)) return false;
      }
      if (dateFrom) {
        const from = startOfDay(parseISO(dateFrom));
        const sentAt = log.sentAt ? parseISO(log.sentAt as unknown as string) : null;
        if (!sentAt || isBefore(sentAt, from)) return false;
      }
      if (dateTo) {
        const to = endOfDay(parseISO(dateTo));
        const sentAt = log.sentAt ? parseISO(log.sentAt as unknown as string) : null;
        if (!sentAt || isAfter(sentAt, to)) return false;
      }
      return true;
    });
  }, [logs, typeFilter, statusFilter, search, dateFrom, dateTo]);

  const [replyDialogDraft, setReplyDialogDraft] = useState<DraftWithProspect | null>(null);
  const outreachDraftsSent = sentDrafts?.filter(d => !!d.sentAt) ?? [];

  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setDateFrom(""); setDateTo(""); };
  const hasFilters = search || typeFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-5">
      {replyDialogDraft && replyDialogDraft.prospect && (
        <ReplyDialog
          prospectId={replyDialogDraft.prospect.id}
          prospectName={replyDialogDraft.prospect.prospectName}
          onClose={() => setReplyDialogDraft(null)}
        />
      )}
      {/* Outreach Sent */}
      {outreachDraftsSent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Team Outreach Emails Sent</h3>
          <div className="space-y-3">
            {outreachDraftsSent.map(draft => (
              <Card key={draft.id} className="p-4" data-testid={`card-sent-outreach-${draft.id}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{draft.prospect?.prospectName || "Unknown"}</span>
                      {draft.prospect?.sport && draft.prospect.sport !== "unknown" && (
                        <Badge variant="outline" className="text-xs">{draft.prospect.sport}</Badge>
                      )}
                      {draft.repliedAt ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs">
                          <MessageSquare className="h-3 w-3 mr-1" />Replied
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />Sent
                        </Badge>
                      )}
                      {draft.replyClassification && (
                        <Badge className={`text-xs ${classificationColor(draft.replyClassification as ReplyClassification)}`}>
                          {classificationLabel(draft.replyClassification as ReplyClassification)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{draft.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      To: <span className="font-mono">{draft.prospect?.contactEmail || "—"}</span>
                      {draft.sentAt && ` · ${format(new Date(draft.sentAt), "MMM d, yyyy h:mm a")}`}
                    </p>
                    {draft.replyText && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic truncate max-w-md">"{draft.replyText.slice(0, 120)}{draft.replyText.length > 120 ? "…" : ""}"</p>
                    )}
                    {draft.prospect?.estimatedValue && (
                      <p className="text-xs text-muted-foreground mt-0.5">Est. value: ${draft.prospect.estimatedValue.toLocaleString()}</p>
                    )}
                  </div>
                  {draft.prospect && !draft.repliedAt && (
                    <div className="flex gap-1.5 flex-wrap shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReplyDialogDraft(draft)} data-testid={`button-mark-replied-${draft.id}`}>
                        <MessageSquare className="h-3 w-3 mr-1" />Replied
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-red-600" onClick={() => dncMutation.mutate(draft.prospect!.id)} data-testid={`button-sent-dnc-${draft.id}`}>
                        <PhoneOff className="h-3 w-3 mr-1" />DNC
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* System Email Logs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">All System Emails</h3>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-logs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search email or subject..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" data-testid="input-sent-search" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9" data-testid="select-sent-type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9" data-testid="select-sent-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-sent-from" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-sent-to" />
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-sent-clear">Clear</Button>}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-4 space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : filteredLogs.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground" data-testid="text-no-logs">
                  <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No emails found</p>
                  <p className="text-sm mt-1">{hasFilters ? "Try adjusting your filters" : "Emails will appear here once sent"}</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Sent At</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Recipient</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Subject</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((log, idx) => (
                      <tr key={log.id} className={`border-b last:border-0 hover:bg-muted/30 ${idx % 2 === 0 ? "" : "bg-muted/10"}`} data-testid={`row-log-${log.id}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                          {log.sentAt ? format(parseISO(log.sentAt as unknown as string), "MMM d, yyyy h:mm a") : "—"}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[log.type] ?? "bg-muted text-muted-foreground"}`}>{TYPE_LABELS[log.type] ?? log.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">{log.recipientEmail}</td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate text-xs" title={log.subject || ""}>{log.subject || "—"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {log.status === "sent" ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs border-0"><CheckCircle className="h-2.5 w-2.5 mr-1" />Sent</Badge>
                          ) : log.status === "skipped" ? (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs border-0"><MinusCircle className="h-2.5 w-2.5 mr-1" />Skipped</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-xs border-0"><XCircle className="h-2.5 w-2.5 mr-1" />Failed</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {!isLoading && filteredLogs.length > 0 && (
              <div className="px-4 py-2 border-t text-xs text-muted-foreground">
                {filteredLogs.length} of {logs?.length ?? 0} logs
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
interface DailyJobResult {
  orgId: string;
  draftsGenerated: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsBlocked: number;
  emailsFailed: number;
  errors: string[];
}

function SettingsTab() {
  const { toast } = useToast();
  const { data: raw, isLoading } = useQuery<EmailAgentSettings>({ queryKey: ["/api/email-agent/settings"] });

  const [settings, setSettings] = useState<EmailAgentSettings>({
    enabled: false,
    dailyLimit: 10,
    outreachRadius: 25,
    cooldownDays: 30,
    autoGenerateDrafts: true,
    autoSend: false,
    preferredSports: [],
    targetLevels: ["high_school", "club", "travel"],
    defaultEstimatedValue: 2500,
  });
  const [initialized, setInitialized] = useState(false);
  const [jobResult, setJobResult] = useState<DailyJobResult | null>(null);

  if (raw && !initialized) {
    setSettings({ ...settings, ...raw });
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-agent/settings", settings).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runJobMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-agent/run-daily-job").then(r => r.json()),
    onSuccess: (data: DailyJobResult) => {
      setJobResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-agent/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      toast({ title: "Agent run complete", description: `Sent ${data.emailsSent} · Drafts ${data.draftsGenerated} · Skipped ${data.emailsSkipped}` });
    },
    onError: (e: any) => toast({ title: "Agent run failed", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof EmailAgentSettings, v: any) => setSettings(s => ({ ...s, [k]: v }));

  const toggleSport = (sport: string) => {
    const current = settings.preferredSports || [];
    set("preferredSports", current.includes(sport) ? current.filter(s => s !== sport) : [...current, sport]);
  };

  const toggleLevel = (level: string) => {
    const current = settings.targetLevels || [];
    set("targetLevels", current.includes(level) ? current.filter(l => l !== level) : [...current, level]);
  };

  if (isLoading) return <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;

  const levels = [
    { key: "high_school", label: "High School" },
    { key: "club", label: "Club" },
    { key: "travel", label: "Travel" },
    { key: "college", label: "College" },
    { key: "adult", label: "Adult" },
    { key: "middle_school", label: "Middle School" },
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      {/* On/Off toggles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4" />Agent Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Enable Team Outreach Agent</Label>
              <p className="text-xs text-muted-foreground">Allow the agent to find and manage prospects</p>
            </div>
            <Switch checked={settings.enabled ?? false} onCheckedChange={v => set("enabled", v)} data-testid="switch-agent-enabled" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Auto-Generate Drafts</Label>
              <p className="text-xs text-muted-foreground">Automatically create email drafts for queued prospects</p>
            </div>
            <Switch checked={settings.autoGenerateDrafts ?? true} onCheckedChange={v => set("autoGenerateDrafts", v)} data-testid="switch-auto-generate" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Auto-Send Daily Queue</Label>
              <p className="text-xs text-muted-foreground text-amber-600 dark:text-amber-400">⚠ Emails will send automatically without manual approval</p>
            </div>
            <Switch checked={settings.autoSend ?? false} onCheckedChange={v => set("autoSend", v)} data-testid="switch-auto-send" />
          </div>
          <div className="flex items-center justify-between pt-1 border-t">
            <div>
              <Label className="font-medium flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Auto-Execute High-Confidence Actions
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                AI will automatically execute top-priority follow-ups and drafts when confidence is high and risk is low.
                Max {settings.autoExecuteMaxPerDay ?? 3}/day. Never executes deals, pricing, or DNC actions.
              </p>
            </div>
            <Switch
              checked={settings.autoExecuteEnabled ?? false}
              onCheckedChange={v => set("autoExecuteEnabled", v)}
              data-testid="switch-auto-execute"
            />
          </div>
        </CardContent>
      </Card>

      {/* Limits & Timing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Limits & Timing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Daily Email Limit <span className="text-muted-foreground">(max 10)</span></Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.dailyLimit ?? 10}
                onChange={e => set("dailyLimit", Math.min(10, Math.max(1, parseInt(e.target.value) || 10)))}
                className="mt-1"
                data-testid="input-daily-limit"
              />
            </div>
            <div>
              <Label>Outreach Radius (miles)</Label>
              <Input
                type="number"
                min={5}
                max={200}
                value={settings.outreachRadius ?? 25}
                onChange={e => set("outreachRadius", parseInt(e.target.value) || 25)}
                className="mt-1"
                data-testid="input-outreach-radius"
              />
            </div>
            <div>
              <Label>Cooldown Period (days)</Label>
              <Input
                type="number"
                min={7}
                max={365}
                value={settings.cooldownDays ?? 30}
                onChange={e => set("cooldownDays", parseInt(e.target.value) || 30)}
                className="mt-1"
                data-testid="input-cooldown-days"
              />
            </div>
          </div>
          <div>
            <Label>Default Estimated Team Value ($)</Label>
            <Input
              type="number"
              min={0}
              value={settings.defaultEstimatedValue ?? 2500}
              onChange={e => set("defaultEstimatedValue", parseInt(e.target.value) || 2500)}
              className="mt-1 max-w-xs"
              data-testid="input-default-value"
            />
            <p className="text-xs text-muted-foreground mt-1">Used for pipeline estimate when no specific value is set on a prospect</p>
          </div>
        </CardContent>
      </Card>

      {/* Preferred Sports */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" />Preferred Sports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Select sports to prioritize during prospect research. Leave empty to target all sports.</p>
          <div className="flex flex-wrap gap-2" data-testid="sports-selector">
            {SPORTS_MULTISELECT.map(sport => {
              const selected = (settings.preferredSports || []).includes(sport);
              return (
                <button
                  key={sport}
                  onClick={() => toggleSport(sport)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-foreground"}`}
                  data-testid={`sport-toggle-${sport.toLowerCase().replace(/\s/g, "-")}`}
                >
                  {sport}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Target Levels */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Target Levels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" data-testid="levels-selector">
            {levels.map(({ key, label }) => {
              const selected = (settings.targetLevels || []).includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleLevel(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-foreground"}`}
                  data-testid={`level-toggle-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Save Settings
      </Button>

      {/* Manual Run */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Run Agent Now
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Trigger today's full outreach cycle immediately — builds queue, generates drafts
            {settings.autoSend ? ", and sends emails" : ", and leaves drafts awaiting approval"}.
          </p>
          <Button
            onClick={() => { setJobResult(null); runJobMutation.mutate(); }}
            disabled={runJobMutation.isPending}
            className="gap-2"
            data-testid="button-run-agent-now"
          >
            {runJobMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" />Running Agent…</>
              : <><Zap className="h-4 w-4" />Run Today's Agent Now</>
            }
          </Button>

          {jobResult && (
            <div className="mt-3 rounded-lg border bg-background p-4 space-y-3" data-testid="agent-run-result">
              <p className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Agent Run Complete
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-md bg-green-500/10 p-3 text-center" data-testid="result-drafts-generated">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{jobResult.draftsGenerated}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Drafts Generated</p>
                </div>
                <div className="rounded-md bg-blue-500/10 p-3 text-center" data-testid="result-emails-sent">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{jobResult.emailsSent}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Emails Sent</p>
                </div>
                <div className="rounded-md bg-yellow-500/10 p-3 text-center" data-testid="result-emails-skipped">
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{jobResult.emailsSkipped}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Skipped</p>
                </div>
                <div className="rounded-md bg-red-500/10 p-3 text-center" data-testid="result-emails-blocked">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{jobResult.emailsBlocked + jobResult.emailsFailed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Blocked / Failed</p>
                </div>
              </div>
              {jobResult.errors.length > 0 && (
                <div className="rounded-md bg-destructive/10 p-3 space-y-1">
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {jobResult.errors.length} error{jobResult.errors.length > 1 ? "s" : ""}
                  </p>
                  {jobResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CommunicationHistoryPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();

  useAiRevenueToasts((opts) =>
    toast({ title: opts.title, description: opts.description, duration: opts.duration })
  );

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-outreach-center">Outreach Center</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-outreach-center-subtitle">
            Manage outreach, prospects, sent emails, and AI-generated follow-ups.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="flex w-max gap-1 min-w-full md:w-auto" data-testid="tabs-email-agent">
            <TabsTrigger value="overview" className="whitespace-nowrap" data-testid="tab-overview">
              <TrendingUp className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="prospects" className="whitespace-nowrap" data-testid="tab-prospects">
              <Users className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Prospects
            </TabsTrigger>
            <TabsTrigger value="drafts" className="whitespace-nowrap" data-testid="tab-drafts">
              <Bot className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Drafts
            </TabsTrigger>
            <TabsTrigger value="sent" className="whitespace-nowrap" data-testid="tab-sent">
              <Mail className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Sent
            </TabsTrigger>
            <TabsTrigger value="followups" className="whitespace-nowrap" data-testid="tab-followups">
              <RepeatIcon className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Follow-Ups
            </TabsTrigger>
            <TabsTrigger value="settings" className="whitespace-nowrap" data-testid="tab-settings">
              <Settings2 className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="prospects" className="mt-4">
          <ProspectsTab />
        </TabsContent>
        <TabsContent value="drafts" className="mt-4">
          <DraftsTab />
        </TabsContent>
        <TabsContent value="sent" className="mt-4">
          <SentTab />
        </TabsContent>
        <TabsContent value="followups" className="mt-4">
          <FollowUpsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
      </Tabs>

      {/* Mobile sticky bottom button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 bg-background/95 border-t backdrop-blur-md md:hidden z-40" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }} data-testid="mobile-agent-bar">
        <Button className="w-full" size="sm" onClick={() => setActiveTab("overview")} data-testid="button-ask-outreach-center">
          <Bot className="h-4 w-4 mr-2" />
          Open Outreach Center
        </Button>
      </div>
    </div>
  );
}
