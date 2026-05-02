import { useState } from "react";
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

  const { data, isLoading, refetch, isRefetching } = useQuery<CommandCenterData>({
    queryKey: ["/api/business-command-center"],
  });

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
    sessionStorage.setItem("agent_prefill_message", message);
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

      {/* ─── Revenue Snapshot ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Revenue Snapshot</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card className="p-4 space-y-1" data-testid="card-revenue-today">
            <p className="text-xs text-muted-foreground">Booked Today</p>
            <p className="text-xl font-bold text-foreground">{fmt$(data.todayRevenueCents)}</p>
          </Card>
          <Card className="p-4 space-y-1" data-testid="card-open-slot-value">
            <p className="text-xs text-muted-foreground">Open Slot Value Today</p>
            <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{fmt$(data.openSlotValueTodayCents)}</p>
          </Card>
          <Card className="p-4 space-y-1 col-span-2 sm:col-span-1" data-testid="card-month-revenue">
            <p className="text-xs text-muted-foreground">Month to Date</p>
            <p className="text-xl font-bold">{fmt$(data.monthRevenueCents)}</p>
          </Card>
        </div>

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
              <Card key={`${slot.startISO}-${i}`} className="p-3 flex items-center gap-3" data-testid={`card-slot-${i}`}>
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
              <Card key={`${opp.clientId}-${opp.type}-${i}`} className="p-3 flex items-start gap-3" data-testid={`card-opportunity-${i}`}>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <Card className="p-3 text-center" data-testid="card-pipeline-total">
            <p className="text-lg font-bold">{data.teamPipeline.totalProspects}</p>
            <p className="text-xs text-muted-foreground">Total Leads</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-pipeline-highconf">
            <p className="text-lg font-bold text-primary">{data.teamPipeline.highConfidenceLeads}</p>
            <p className="text-xs text-muted-foreground">High Confidence</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-pipeline-drafts">
            <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{data.teamPipeline.draftsAwaitingApproval}</p>
            <p className="text-xs text-muted-foreground">Drafts Pending</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-pipeline-replies">
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{data.teamPipeline.repliesNeedingFollowUp}</p>
            <p className="text-xs text-muted-foreground">Replies</p>
          </Card>
        </div>

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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: "What should I do today?", icon: Flame, msg: "What should I do today to grow my revenue and fill my schedule?" },
            { label: "Fill open slots", icon: Calendar, msg: "Help me fill my open schedule slots for today and tomorrow." },
            { label: "Draft team outreach", icon: Send, msg: "Draft team outreach for my highest-confidence leads." },
            { label: "Review team drafts", icon: MessageSquare, msg: "Show me team outreach drafts waiting for my approval." },
            { label: "Follow up with replies", icon: Users, msg: "Show me team training prospects who replied and need follow-up." },
            { label: "Show revenue gap", icon: TrendingUp, msg: "What is my current revenue gap and what's the fastest way to close it?" },
          ].map((action, i) => (
            <Button
              key={action.label}
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-1.5 text-center"
              onClick={() => openAgentWith(action.msg)}
              data-testid={`button-quick-action-${i}`}
            >
              <action.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs leading-tight">{action.label}</span>
            </Button>
          ))}
        </div>
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
