import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, Calendar, Zap, ChevronRight, Trash2, Edit2,
  TrendingUp, Target, Briefcase, Loader2, MessageSquare,
  Phone, FileText, Sparkles, CheckCircle, XCircle, Plus,
  AlertTriangle, Flame, Clock, Copy, Brain, Info, ChevronDown, ChevronUp, AlertCircle,
  Mail, MapPin, User, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import type { TeamTrainingDeal, TeamTrainingProspect } from "@shared/schema";

type DealWithProspect = TeamTrainingDeal & { prospect?: TeamTrainingProspect };

const DEAL_STATUSES = [
  { key: "new", label: "New", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800" },
  { key: "interested", label: "Interested", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
  { key: "call_scheduled", label: "Call Scheduled", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-800" },
  { key: "proposal_sent", label: "Proposal Sent", color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400", border: "border-yellow-200 dark:border-yellow-800" },
  { key: "negotiating", label: "Follow-Up", color: "bg-orange-500/15 text-orange-700 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800" },
  { key: "won", label: "Won", color: "bg-green-500/15 text-green-700 dark:text-green-400", border: "border-green-200 dark:border-green-800" },
  { key: "lost", label: "Lost", color: "bg-red-500/15 text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
];

const KANBAN_COLUMNS = [
  { key: "new", label: "New" },
  { key: "interested", label: "Interested" },
  { key: "call_scheduled", label: "Call Scheduled" },
  { key: "proposal_sent", label: "Proposal Sent" },
  { key: "negotiating", label: "Follow-Up" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

function timeAgo(date: string | Date | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function staleDays(date: string | Date | null): number {
  if (!date) return 99;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

interface DealExplanation {
  decision_reason: string;
  supporting_signals: string[];
  risk_flags: string[];
  confidence_level: "low" | "medium" | "high";
  expected_outcome: string;
  alternative_action: string;
}

const DEAL_CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function DealWhyPanel({ explanation, dealId }: { explanation: DealExplanation; dealId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`why-deal-${dealId}`}>
      <button
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid={`why-deal-${dealId}-toggle`}
      >
        <Info className="h-3 w-3" />
        Why this recommendation?
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border bg-background p-3 space-y-2.5 text-xs" data-testid={`why-deal-${dealId}-panel`}>
          <div>
            <p className="font-semibold text-foreground mb-0.5">Why:</p>
            <p className="text-muted-foreground leading-relaxed">{explanation.decision_reason}</p>
          </div>
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
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div>
              <p className="font-semibold text-foreground mb-0.5">AI confidence:</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${DEAL_CONFIDENCE_STYLE[explanation.confidence_level] ?? DEAL_CONFIDENCE_STYLE.low}`}>
                {explanation.confidence_level.charAt(0).toUpperCase() + explanation.confidence_level.slice(1)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground mb-0.5">Expected outcome:</p>
              <p className="text-muted-foreground">{explanation.expected_outcome}</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-0.5">If not now — alternative:</p>
            <p className="text-muted-foreground italic">{explanation.alternative_action}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function getDealHealth(deal: DealWithProspect): { label: string; color: string; icon: React.ElementType; move: string; explanation: DealExplanation } {
  const days = staleDays(deal.lastActivityAt);
  const valueStr = (deal.estimatedValue ?? 0) > 0 ? `$${(deal.estimatedValue ?? 0).toLocaleString()}` : null;
  const name = deal.prospect?.prospectName ?? "This team";

  const baseSignals: string[] = [
    `Deal stage: ${deal.status}`,
    deal.lastActivityAt ? `Last activity: ${days} day${days !== 1 ? "s" : ""} ago` : "No activity recorded",
    valueStr ? `Deal value: ${valueStr}` : "",
    deal.probability > 0 ? `Close probability: ${deal.probability}%` : "",
    deal.nextAction ? `Recorded next action: ${deal.nextAction}` : "",
    deal.prospect?.sport && deal.prospect.sport !== "unknown" ? `Sport: ${deal.prospect.sport}` : "",
  ].filter(Boolean) as string[];

  if (deal.status === "won") {
    return {
      label: "Won — onboard team", color: "text-green-600 dark:text-green-400", icon: CheckCircle,
      move: "Schedule the kickoff session",
      explanation: {
        decision_reason: `${name} signed — congratulations! The next step is to deliver on what you promised and schedule the first training session.`,
        supporting_signals: baseSignals,
        risk_flags: [],
        confidence_level: "high",
        expected_outcome: "Successful kickoff and a happy client who may refer other teams.",
        alternative_action: "If scheduling is delayed, send a welcome message to maintain excitement and confirm the program details.",
      },
    };
  }

  if (deal.status === "lost") {
    return {
      label: "Lost — review", color: "text-muted-foreground", icon: XCircle,
      move: "Note reason and decide whether to re-engage later",
      explanation: {
        decision_reason: `This deal did not close. Reviewing what happened will help you improve your approach with future prospects.`,
        supporting_signals: baseSignals,
        risk_flags: ["Deal was marked as lost — avoid re-engaging without a clear change in circumstances"],
        confidence_level: "high",
        expected_outcome: "Capturing the loss reason improves future close rates and reveals patterns.",
        alternative_action: "If the reason was timing or budget, add a note to revisit in 3–6 months.",
      },
    };
  }

  if (days >= 14) {
    return {
      label: `Stale ${days}d — re-engage now`, color: "text-red-600 dark:text-red-400", icon: AlertTriangle,
      move: "Send a re-engagement message immediately",
      explanation: {
        decision_reason: `This deal has been completely inactive for ${days} days. At this point, it is at critical risk of being permanently lost without immediate action.`,
        supporting_signals: baseSignals,
        risk_flags: [
          `Critical: ${days} days with no activity`,
          "Prospect may have moved on or chosen a competitor",
          "Long gaps create awkward re-entry — acknowledge the gap in your message",
        ],
        confidence_level: "high",
        expected_outcome: "A well-crafted re-engagement message may revive the deal. Even a 'not interested' reply gives you closure.",
        alternative_action: "If the prospect doesn't respond to re-engagement, mark as Lost and note the reason for future reference.",
      },
    };
  }

  if (days >= 7) {
    return {
      label: `Stale ${days}d — follow up`, color: "text-amber-600 dark:text-amber-400", icon: Clock,
      move: "Follow up and re-confirm interest",
      explanation: {
        decision_reason: `The deal has been quiet for ${days} days. A timely follow-up keeps the momentum going before the prospect loses interest.`,
        supporting_signals: baseSignals,
        risk_flags: [`Deal inactive for ${days} days — risk of losing momentum`],
        confidence_level: "medium",
        expected_outcome: "A follow-up re-engages the prospect and moves the deal to the next stage.",
        alternative_action: "If a direct follow-up feels too soon, share a relevant article or update about your program as a soft touch.",
      },
    };
  }

  if (deal.status === "interested") {
    return {
      label: "High intent — create proposal or call", color: "text-emerald-600 dark:text-emerald-400", icon: Flame,
      move: "Send a training proposal or book a call this week",
      explanation: {
        decision_reason: `${name} has expressed interest. Strike while the iron is hot — send a proposal or book a call before their attention shifts elsewhere.`,
        supporting_signals: baseSignals,
        risk_flags: days >= 3 ? [`Interest was expressed ${days} days ago — act before momentum fades`] : [],
        confidence_level: "high",
        expected_outcome: "A proposal or call this week can move this deal to negotiation or close within days.",
        alternative_action: "If you need more time to prepare a full proposal, book a discovery call first to understand their specific needs.",
      },
    };
  }

  if (deal.status === "call_scheduled") {
    return {
      label: "Call scheduled — prepare pitch", color: "text-purple-600 dark:text-purple-400", icon: Zap,
      move: "Review org profile and prepare a custom program outline",
      explanation: {
        decision_reason: `A call is scheduled with ${name}. Preparation is the most impactful thing you can do right now — know their sport, team size, and goals.`,
        supporting_signals: baseSignals,
        risk_flags: [],
        confidence_level: "high",
        expected_outcome: "A well-prepared call builds confidence and often leads directly to a proposal request or verbal commitment.",
        alternative_action: "If the call needs to be rescheduled, confirm the new time immediately so the deal doesn't go cold.",
      },
    };
  }

  if (deal.status === "proposal_sent") {
    const waitRisk = days >= 3;
    return {
      label: `Proposal pending${days >= 3 ? ` (${days}d)` : ""}`, color: "text-yellow-600 dark:text-yellow-400", icon: FileText,
      move: `Follow up on the proposal${days >= 3 ? " — it has been " + days + " days" : ""}`,
      explanation: {
        decision_reason: `A proposal has been sent${days >= 3 ? ` ${days} days ago` : ""}. Following up shows professionalism and keeps you top of mind while they decide.`,
        supporting_signals: baseSignals,
        risk_flags: waitRisk ? [`Proposal has been pending for ${days} days — a follow-up is overdue`] : [],
        confidence_level: waitRisk ? "high" : "medium",
        expected_outcome: "A follow-up often prompts a decision — either moving forward or surfacing objections you can address.",
        alternative_action: "If you don't hear back after 2 follow-ups, try calling or reaching out via a different channel.",
      },
    };
  }

  if (deal.status === "negotiating") {
    return {
      label: "In negotiation — close it", color: "text-blue-600 dark:text-blue-400", icon: TrendingUp,
      move: "Address objections and ask for a commitment",
      explanation: {
        decision_reason: `${name} is in active negotiation. The goal now is to resolve any remaining objections and ask for a commitment.`,
        supporting_signals: baseSignals,
        risk_flags: days >= 5 ? [`Negotiation has been ongoing for ${days} days — prolonged negotiations can stall`] : [],
        confidence_level: "medium",
        expected_outcome: "Resolving objections and asking directly for a decision moves this deal to 'Won'.",
        alternative_action: "If the negotiation is stalling on price, consider offering a tiered package or a limited-time incentive to move things forward.",
      },
    };
  }

  return {
    label: "Active deal — advance stage", color: "text-foreground", icon: ChevronRight,
    move: "Reach out and push to the next stage",
    explanation: {
      decision_reason: `This deal is active but needs to be advanced to the next stage. A proactive outreach now keeps the pipeline moving.`,
      supporting_signals: baseSignals,
      risk_flags: days >= 5 ? [`No activity for ${days} days — take action soon`] : [],
      confidence_level: "low",
      expected_outcome: "Advancing the stage keeps revenue moving through your pipeline toward a close.",
      alternative_action: "If you are unsure of the next step, review the deal notes and identify the specific blocker holding it back.",
    },
  };
}

function statusInfo(key: string) {
  return DEAL_STATUSES.find(s => s.key === key) ?? DEAL_STATUSES[0];
}

function DealCard({
  deal,
  onEdit,
  onDelete,
  onAiAction,
  onView,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  deal: DealWithProspect;
  onEdit: (d: DealWithProspect) => void;
  onDelete: (id: string) => void;
  onAiAction: (deal: DealWithProspect, action: string) => void;
  onView: (d: DealWithProspect) => void;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const { toast } = useToast();
  const health = getDealHealth(deal);
  const HealthIcon = health.icon;

  function handleAskAgent() {
    const name = deal.prospect?.prospectName ?? "this team";
    const prompt = `Analyze my deal with ${name} (status: ${deal.status}, probability: ${deal.probability}%, last activity: ${timeAgo(deal.lastActivityAt)}). Suggested move: ${health.move}. What is the single best action to close this deal?`;
    navigator.clipboard.writeText(prompt).then(() => {
      toast({ title: "Prompt copied!", description: "Paste in your agent chat for deal analysis.", duration: 3000 });
    });
  }

  return (
    <Card
      draggable
      onDragStart={() => onDragStart(deal.id)}
      onDragEnd={onDragEnd}
      onClick={() => onView(deal)}
      className={`p-3 space-y-2 cursor-pointer select-none transition-opacity hover:shadow-md hover:border-primary/30 ${isDragging ? "opacity-40 cursor-grab" : ""}`}
      data-testid={`card-deal-${deal.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" data-testid={`text-deal-name-${deal.id}`}>
            {deal.prospect?.prospectName ?? "Unknown Team"}
          </p>
          <p className="text-xs text-muted-foreground">{deal.prospect?.sport ?? "—"} · {deal.prospect?.city ?? "—"}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onEdit(deal); }} data-testid={`button-edit-deal-${deal.id}`}>
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-600" onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }} data-testid={`button-delete-deal-${deal.id}`}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Deal health indicator */}
      <div className={`flex items-center gap-1.5 text-xs font-medium ${health.color}`} data-testid={`deal-health-${deal.id}`}>
        <HealthIcon className="h-3 w-3 shrink-0" />
        <span className="line-clamp-1">{health.label}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
          <DollarSign className="h-3 w-3" />
          {deal.estimatedValue > 0 ? `$${deal.estimatedValue.toLocaleString()}` : "No estimate"}
        </span>
        <span className="text-muted-foreground">{deal.probability}% probability</span>
      </div>

      {/* Suggested close move + why */}
      <div className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 space-y-1" data-testid={`deal-move-${deal.id}`}>
        <div className="flex items-start gap-1 text-xs">
          <Brain className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
          <span className="text-muted-foreground line-clamp-2">{health.move}</span>
        </div>
        <DealWhyPanel explanation={health.explanation} dealId={deal.id} />
      </div>

      {deal.nextAction && (
        <div className="flex items-start gap-1 text-xs bg-muted/60 rounded px-2 py-1">
          <ChevronRight className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
          <span className="text-muted-foreground line-clamp-2">{deal.nextAction}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {timeAgo(deal.lastActivityAt)}
        </span>
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); handleAskAgent(); }} title="Copy agent prompt" data-testid={`button-ask-agent-deal-${deal.id}`}>
          <Copy className="h-2.5 w-2.5" />
        </Button>
      </div>

      <div className="flex gap-1 flex-wrap pt-1">
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); onAiAction(deal, "generate_response"); }} data-testid={`button-ai-response-${deal.id}`}>
          <MessageSquare className="h-3 w-3 mr-1" /> Respond
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); onAiAction(deal, "suggest_next_step"); }} data-testid={`button-ai-next-${deal.id}`}>
          <Zap className="h-3 w-3 mr-1" /> Next Step
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); onAiAction(deal, "create_proposal"); }} data-testid={`button-ai-proposal-${deal.id}`}>
          <FileText className="h-3 w-3 mr-1" /> Proposal
        </Button>
      </div>
    </Card>
  );
}

function KanbanColumn({
  column,
  deals,
  onEdit,
  onDelete,
  onAiAction,
  onView,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  column: { key: string; label: string };
  deals: DealWithProspect[];
  onEdit: (d: DealWithProspect) => void;
  onDelete: (id: string) => void;
  onAiAction: (deal: DealWithProspect, action: string) => void;
  onView: (d: DealWithProspect) => void;
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (status: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const info = statusInfo(column.key);
  const colValue = deals.reduce((s, d) => s + d.estimatedValue, 0);

  return (
    <div
      className={`flex flex-col min-w-[220px] max-w-[260px] flex-1 rounded-lg border bg-muted/30 transition-colors ${isOver && draggingId ? "bg-primary/5 border-primary/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={() => { setIsOver(false); onDrop(column.key); }}
      data-testid={`column-${column.key}`}
    >
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center rounded-full w-5 h-5 text-xs font-bold ${info.color}`}>{deals.length}</span>
          <span className="font-medium text-sm">{column.label}</span>
        </div>
        {colValue > 0 && (
          <span className="text-xs text-muted-foreground">${colValue.toLocaleString()}</span>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-[100px] overflow-y-auto max-h-[600px]">
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            onEdit={onEdit}
            onDelete={onDelete}
            onAiAction={onAiAction}
            onView={onView}
            isDragging={draggingId === deal.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {deals.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-muted-foreground/60 italic select-none pointer-events-none">
            No deals in this stage yet
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminTeamTrainingDealsPage() {
  const { toast } = useToast();
  const [editDeal, setEditDeal] = useState<DealWithProspect | null>(null);
  const [editForm, setEditForm] = useState<Partial<DealWithProspect>>({});
  const [viewDeal, setViewDeal] = useState<DealWithProspect | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiActionLabel, setAiActionLabel] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const { data: deals = [], isLoading } = useQuery<DealWithProspect[]>({
    queryKey: ["/api/admin/team-training/deals"],
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TeamTrainingDeal> }) => {
      const res = await apiRequest("PATCH", `/api/admin/team-training/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/deals"] });
      setEditDeal(null);
      toast({ title: "Deal updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteDealMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/team-training/deals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/deals"] });
      toast({ title: "Deal deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const handleDrop = (status: string) => {
    if (!draggingId || !status) return;
    const deal = deals.find(d => d.id === draggingId);
    if (!deal || deal.status === status) return;
    updateDealMutation.mutate({ id: draggingId, data: { status: status as TeamTrainingDeal["status"] } });
    setDraggingId(null);
  };

  const handleAiAction = async (deal: DealWithProspect, action: string) => {
    const labels: Record<string, string> = {
      generate_response: "Generate Response",
      suggest_next_step: "Suggest Next Step",
      create_proposal: "Create Proposal",
    };
    setAiActionLabel(labels[action] ?? action);
    setAiResult("");
    setAiDialogOpen(true);
    setAiLoading(true);
    try {
      const res = await apiRequest("POST", `/api/admin/team-training/deals/${deal.id}/ai-action`, { action });
      const data = await res.json();
      setAiResult(data.result ?? "No result returned.");
    } catch (err: any) {
      setAiResult("Error: " + err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const openEdit = (d: DealWithProspect) => {
    setEditDeal(d);
    setEditForm({
      status: d.status,
      estimatedValue: d.estimatedValue,
      finalValue: d.finalValue ?? undefined,
      probability: d.probability,
      nextAction: d.nextAction,
      notes: d.notes ?? "",
    });
  };

  // Stats
  const activeDeals = deals.filter(d => !["won", "lost"].includes(d.status));
  const wonDeals = deals.filter(d => d.status === "won");
  const projectedRevenue = activeDeals.reduce((s, d) => s + Math.round((d.estimatedValue * d.probability) / 100), 0);
  const wonRevenue = wonDeals.reduce((s, d) => s + (d.finalValue ?? d.estimatedValue), 0);
  const interestedDeals = deals.filter(d => d.status === "interested").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-deals-title">Deal Pipeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track and close team training deals from first contact to won.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Card className="p-3 text-center">
              <Briefcase className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-active-deals">{activeDeals.length}</p>
              <p className="text-xs text-muted-foreground">Active Deals</p>
            </Card>
            <Card className="p-3 text-center">
              <Target className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-interested">{interestedDeals}</p>
              <p className="text-xs text-muted-foreground">Interested Leads</p>
            </Card>
            <Card className="p-3 text-center">
              <TrendingUp className="h-4 w-4 mx-auto text-purple-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-projected">${projectedRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Projected Revenue</p>
            </Card>
            <Card className="p-3 text-center">
              <CheckCircle className="h-4 w-4 mx-auto text-green-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-won">${wonRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Won Revenue</p>
            </Card>
          </>
        )}
      </div>

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(col => (
            <Skeleton key={col.key} className="min-w-[220px] h-64" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 border rounded-lg bg-muted/20">
          <Briefcase className="h-12 w-12 text-muted-foreground/40" />
          <div className="space-y-1">
            <p className="font-semibold text-base">No deals in your pipeline yet</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Start by moving an interested team training lead into the pipeline.
            </p>
          </div>
          <Link href="/admin/team-training-leads">
            <Button variant="outline" className="gap-2" data-testid="button-go-to-leads">
              <ArrowRight className="h-4 w-4" />
              Go to Team Training Leads
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(col => (
            <KanbanColumn
              key={col.key}
              column={col}
              deals={deals.filter(d => d.status === col.key)}
              onEdit={openEdit}
              onDelete={(id) => deleteDealMutation.mutate(id)}
              onAiAction={handleAiAction}
              onView={setViewDeal}
              draggingId={draggingId}
              onDragStart={setDraggingId}
              onDragEnd={() => setDraggingId(null)}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Edit Deal Dialog */}
      <Dialog open={!!editDeal} onOpenChange={(o) => !o && setEditDeal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Deal — {editDeal?.prospect?.prospectName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm(f => ({ ...f, status: v as TeamTrainingDeal["status"] }))}>
                <SelectTrigger data-testid="select-deal-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_STATUSES.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Estimated Value ($)</label>
                <Input
                  type="number"
                  value={editForm.estimatedValue ?? 0}
                  onChange={(e) => setEditForm(f => ({ ...f, estimatedValue: parseInt(e.target.value) || 0 }))}
                  data-testid="input-estimated-value"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Final Value ($)</label>
                <Input
                  type="number"
                  value={editForm.finalValue ?? ""}
                  placeholder="Optional"
                  onChange={(e) => setEditForm(f => ({ ...f, finalValue: e.target.value ? parseInt(e.target.value) : undefined }))}
                  data-testid="input-final-value"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Probability (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={editForm.probability ?? 40}
                onChange={(e) => setEditForm(f => ({ ...f, probability: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                data-testid="input-probability"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Next Action</label>
              <Input
                value={editForm.nextAction ?? ""}
                onChange={(e) => setEditForm(f => ({ ...f, nextAction: e.target.value }))}
                placeholder="What's the next step?"
                data-testid="input-next-action"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                className="min-h-[80px]"
                placeholder="Deal notes..."
                data-testid="textarea-notes"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditDeal(null)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={() => editDeal && updateDealMutation.mutate({ id: editDeal.id, data: editForm as Partial<TeamTrainingDeal> })}
                disabled={updateDealMutation.isPending}
                data-testid="button-save-deal"
              >
                {updateDealMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Close Assistant Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Close Assistant — {aiActionLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">
            {aiLoading ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Generating...</span>
              </div>
            ) : (
              <div className="space-y-4">
                <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 font-sans max-h-80 overflow-y-auto" data-testid="text-ai-result">
                  {aiResult}
                </pre>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (aiResult) {
                        navigator.clipboard.writeText(aiResult);
                        toast({ title: "Copied to clipboard" });
                      }
                    }}
                    data-testid="button-copy-ai-result"
                  >
                    Copy
                  </Button>
                  <Button onClick={() => setAiDialogOpen(false)} data-testid="button-close-ai-dialog">
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Deal Detail Drawer */}
      <Dialog open={!!viewDeal} onOpenChange={(o) => !o && setViewDeal(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{viewDeal?.prospect?.prospectName ?? "Deal Details"}</span>
            </DialogTitle>
          </DialogHeader>
          {viewDeal && (() => {
            const health = getDealHealth(viewDeal);
            const HealthIcon = health.icon;
            const sInfo = statusInfo(viewDeal.status);
            const displayEmail = viewDeal.prospect?.decisionMakerEmail || viewDeal.prospect?.contactEmail;
            const displayContact = viewDeal.prospect?.decisionMakerName || viewDeal.prospect?.contactName;
            return (
              <div className="space-y-4 pt-1">
                {/* Stage badge + health */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${sInfo.color}`}>
                    {sInfo.label}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-medium ${health.color}`}>
                    <HealthIcon className="h-3 w-3 shrink-0" />
                    {health.label}
                  </span>
                </div>

                {/* Key details */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Estimated Value</p>
                    <p className="font-semibold text-green-700 dark:text-green-400">
                      {viewDeal.estimatedValue > 0 ? `$${viewDeal.estimatedValue.toLocaleString()}` : "No estimate"}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Close Probability</p>
                    <p className="font-semibold">{viewDeal.probability}%</p>
                  </div>
                  {viewDeal.finalValue && viewDeal.finalValue > 0 && (
                    <div className="space-y-0.5 col-span-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Final Value (Won)</p>
                      <p className="font-semibold text-green-700 dark:text-green-400">${viewDeal.finalValue.toLocaleString()}</p>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Last Activity</p>
                    <p>{timeAgo(viewDeal.lastActivityAt)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Sport</p>
                    <p>{viewDeal.prospect?.sport ?? "—"}</p>
                  </div>
                </div>

                {/* Contact details */}
                {(displayContact || displayEmail || viewDeal.prospect?.contactPhone) && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</p>
                    {displayContact && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span>{displayContact}</span>
                        {viewDeal.prospect?.decisionMakerTitle && (
                          <span className="text-muted-foreground text-xs">· {viewDeal.prospect.decisionMakerTitle}</span>
                        )}
                      </div>
                    )}
                    {displayEmail && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs break-all">{displayEmail}</span>
                      </div>
                    )}
                    {viewDeal.prospect?.contactPhone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span>{viewDeal.prospect.contactPhone}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Location */}
                {(viewDeal.prospect?.city || viewDeal.prospect?.state) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{[viewDeal.prospect.city, viewDeal.prospect.state].filter(Boolean).join(", ")}</span>
                    {viewDeal.prospect?.websiteUrl && (
                      <>
                        <span>·</span>
                        <a
                          href={viewDeal.prospect.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Website
                        </a>
                      </>
                    )}
                  </div>
                )}

                {/* AI recommended move */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
                  <div className="flex items-start gap-1.5 text-sm">
                    <Brain className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                    <span className="text-muted-foreground">{health.move}</span>
                  </div>
                </div>

                {/* Next action */}
                {viewDeal.nextAction && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Next Action</p>
                    <p className="text-sm">{viewDeal.nextAction}</p>
                  </div>
                )}

                {/* Notes */}
                {viewDeal.notes && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Notes</p>
                    <p className="text-sm text-muted-foreground italic border-l-2 pl-2">{viewDeal.notes}</p>
                  </div>
                )}

                {/* Quick stage move */}
                <div className="space-y-2 pt-1 border-t">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Move to Stage</p>
                  <div className="flex flex-wrap gap-1.5">
                    {KANBAN_COLUMNS.filter(c => c.key !== viewDeal.status).map(col => (
                      <Button
                        key={col.key}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          updateDealMutation.mutate({ id: viewDeal.id, data: { status: col.key as TeamTrainingDeal["status"] } });
                          setViewDeal(null);
                        }}
                        data-testid={`button-move-to-${col.key}`}
                      >
                        → {col.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" size="sm" onClick={() => { setViewDeal(null); openEdit(viewDeal); }} data-testid="button-view-edit-deal">
                    <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button size="sm" onClick={() => setViewDeal(null)} data-testid="button-close-view-deal">
                    Close
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
