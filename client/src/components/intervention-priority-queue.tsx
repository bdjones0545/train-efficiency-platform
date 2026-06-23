import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Flame, AlertTriangle, CheckCircle2, X, BookOpen, ChevronDown, ChevronUp,
  Brain, Zap, ShieldAlert, TrendingDown, Users, Eye, Loader2, ArrowRight,
  Activity, Clock, Target, Wand2, MessageSquare, ClipboardList,
} from "lucide-react";

interface Signal {
  signal: string;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
  weight: number;
  description: string;
}

interface PrioritizedIntervention {
  id: string;
  sourceType: "adaptation_draft" | "intervention_recommendation";
  athleteUserId: string;
  athleteName: string;
  orgId: string;
  interventionType: string;
  adaptationType?: string;
  priorityScore: number;
  priorityLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  recommendedAction: string;
  confidenceScore: number;
  estimatedRisk: string;
  activeSignals: Signal[];
  signalOverlapBonus: number;
  trajectoryLabel: string;
  trajectoryRationale: string;
  triggerSignals?: any[];
  adaptationRationale?: string;
  status: string;
  createdAt: string | null;
  draftSessions?: any[];
  generationError?: string | null;
}

interface PriorityQueueData {
  prioritizedQueue: PrioritizedIntervention[];
  criticalAthletes: any[];
  summary: { critical: number; high: number; medium: number; low: number };
}

interface Props {
  orgId: string;
  headers?: Record<string, string>;
}

const LEVEL_CONFIG = {
  critical: {
    color: "bg-red-500/15 text-red-400 border-red-500/30",
    dot: "bg-red-400",
    icon: Flame,
    label: "CRITICAL",
  },
  high: {
    color: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    dot: "bg-orange-400",
    icon: AlertTriangle,
    label: "HIGH",
  },
  medium: {
    color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
    icon: Activity,
    label: "MEDIUM",
  },
  low: {
    color: "bg-muted/30 text-muted-foreground border-border",
    dot: "bg-muted-foreground",
    icon: Clock,
    label: "LOW",
  },
};

const TRAJECTORY_CONFIG: Record<string, { color: string; icon: any }> = {
  "possible overreaching pattern": { color: "text-red-400", icon: TrendingDown },
  "high risk of disengagement": { color: "text-red-400", icon: Users },
  "likely temporary fatigue": { color: "text-amber-400", icon: Activity },
  "high probability compliance decline": { color: "text-amber-400", icon: TrendingDown },
  "multi-factor risk escalation": { color: "text-red-400", icon: ShieldAlert },
  "early warning — monitor": { color: "text-blue-400", icon: Eye },
  "stable with watchpoints": { color: "text-emerald-400", icon: CheckCircle2 },
};

const ADAPTATION_LABELS: Record<string, string> = {
  deload: "Deload Week",
  injury_modification: "Injury Modification",
  recovery_emphasis: "Recovery Emphasis",
  program_simplification: "Program Simplification",
  comprehensive_review: "Comprehensive Review",
  load_reduction: "Load Reduction",
  coach_conversation: "Coach Conversation",
  education_hydration: "Hydration Education",
  education_sleep: "Sleep Education",
  motivational_outreach: "Motivational Outreach",
  schedule_adjustment: "Schedule Adjustment",
  recovery_session: "Recovery Session",
};

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{score}% confidence</span>
    </div>
  );
}

function ScoreBadge({ score, level }: { score: number; level: string }) {
  const cfg = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.low;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-semibold ${cfg.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {score}
    </div>
  );
}

function InterventionCard({
  item,
  onApprove,
  onDismiss,
  isApproving,
  isDismissing,
}: {
  item: PrioritizedIntervention;
  onApprove: (id: string, notes: string) => void;
  onDismiss: (id: string, notes: string) => void;
  isApproving: boolean;
  isDismissing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [coachNotes, setCoachNotes] = useState("");

  const levelCfg = LEVEL_CONFIG[item.priorityLevel] ?? LEVEL_CONFIG.low;
  const LevelIcon = levelCfg.icon;
  const trajCfg = TRAJECTORY_CONFIG[item.trajectoryLabel] ?? { color: "text-muted-foreground", icon: Activity };
  const TrajIcon = trajCfg.icon;
  const typeLabel = ADAPTATION_LABELS[item.interventionType] ?? ADAPTATION_LABELS[item.adaptationType ?? ""] ?? item.interventionType;

  return (
    <div
      className={`rounded-lg border bg-card ${item.priorityLevel === "critical" ? "border-red-500/30" : item.priorityLevel === "high" ? "border-orange-500/25" : "border-border"}`}
      data-testid={`priority-item-${item.id}`}
    >
      <div className="p-3 space-y-2">
        {/* Row 1: Score + athlete + type */}
        <div className="flex items-start gap-2.5">
          <ScoreBadge score={item.priorityScore} level={item.priorityLevel} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold" data-testid={`text-athlete-${item.id}`}>{item.athleteName}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${levelCfg.color}`}>
                <LevelIcon className="h-2.5 w-2.5 mr-0.5" />{levelCfg.label}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {item.sourceType === "adaptation_draft" ? <Wand2 className="h-2.5 w-2.5 mr-0.5 inline" /> : <ClipboardList className="h-2.5 w-2.5 mr-0.5 inline" />}
                {typeLabel}
              </Badge>
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}
          </span>
        </div>

        {/* Row 2: "Why this matters now" */}
        <div className="rounded bg-amber-500/8 border border-amber-500/20 px-2.5 py-2">
          <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wide mb-0.5">Why this matters now</p>
          <p className="text-xs text-muted-foreground leading-snug">{item.urgencyReason}</p>
        </div>

        {/* Row 3: Trajectory + confidence */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <TrajIcon className={`h-3.5 w-3.5 flex-shrink-0 ${trajCfg.color}`} />
            <span className={`text-[10px] font-medium capitalize ${trajCfg.color} truncate`}>{item.trajectoryLabel}</span>
          </div>
          <ConfidenceBar score={item.confidenceScore} />
        </div>

        {/* Row 4: Recommended action */}
        <div className="flex items-start gap-1.5">
          <Target className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-primary/80">{item.recommendedAction}</p>
        </div>

        {/* Row 5: Active signals */}
        {item.activeSignals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.activeSignals.slice(0, 4).map((s, i) => (
              <Badge
                key={i}
                variant="outline"
                className={`text-[9px] px-1.5 py-0 h-3.5 ${s.severity === "critical" || s.severity === "high" ? "bg-red-500/8 text-red-400 border-red-500/25" : "bg-amber-500/8 text-amber-400 border-amber-500/25"}`}
              >
                {s.label}
              </Badge>
            ))}
            {item.activeSignals.length > 4 && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5">+{item.activeSignals.length - 4} more</Badge>
            )}
          </div>
        )}

        {/* Expandable: trajectory rationale + session preview */}
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`btn-expand-priority-${item.id}`}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Less detail" : "More detail"}
        </button>

        {expanded && (
          <div className="space-y-2 pt-1">
            <div className="rounded bg-muted/20 border border-border/50 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Trajectory analysis</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.trajectoryRationale}</p>
            </div>
            {item.adaptationRationale && (
              <div className="rounded bg-muted/20 border border-border/50 px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Adaptation rationale</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.adaptationRationale}</p>
              </div>
            )}
            {item.draftSessions && item.draftSessions.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{item.draftSessions.length} sessions drafted</p>
                {item.draftSessions.slice(0, 3).map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20 text-xs">
                    <span className="text-muted-foreground">Wk{s.weekNumber}·D{s.dayNumber}</span>
                    <span className="truncate">{s.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action zone — only for adaptation drafts */}
      {item.sourceType === "adaptation_draft" && (
        <div className="border-t border-border/50 p-3 space-y-2">
          {showActions ? (
            <>
              <Textarea
                placeholder="Optional coach notes…"
                value={coachNotes}
                onChange={(e) => setCoachNotes(e.target.value)}
                rows={2}
                className="text-xs"
                data-testid={`input-notes-priority-${item.id}`}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => onApprove(item.id, coachNotes)}
                  disabled={isApproving}
                  data-testid={`btn-approve-priority-${item.id}`}
                >
                  {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={() => onDismiss(item.id, coachNotes)}
                  disabled={isDismissing}
                  data-testid={`btn-dismiss-priority-${item.id}`}
                >
                  {isDismissing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  Dismiss
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setShowActions(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs gap-1"
              onClick={() => setShowActions(true)}
              data-testid={`btn-review-priority-${item.id}`}
            >
              <Eye className="h-3 w-3" /> Review & Decide
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CriticalAthleteStrip({ athlete }: { athlete: any }) {
  const levelCfg = LEVEL_CONFIG[athlete.priorityLevel as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.low;

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${athlete.priorityLevel === "critical" ? "bg-red-500/8 border-red-500/25" : "bg-orange-500/8 border-orange-500/25"}`}
      data-testid={`critical-athlete-${athlete.athleteUserId}`}
    >
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${levelCfg.dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{athlete.athleteName}</p>
        <p className="text-[10px] text-muted-foreground capitalize truncate">{athlete.trajectoryLabel}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-xs font-bold ${levelCfg.color.split(" ")[1]}`}>{athlete.priorityScore}</p>
        <p className="text-[10px] text-muted-foreground">{athlete.pendingDraftCount} pending</p>
      </div>
    </div>
  );
}

export function InterventionPriorityQueue({ orgId, headers }: Props) {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);

  const queryKey = ["/api/org/intelligence/priority-queue", orgId];

  const { data, isLoading } = useQuery<PriorityQueueData>({
    queryKey,
    queryFn: async () => {
      return authenticatedFetch("/api/org/intelligence/priority-queue", { headers: headers });
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const result = await authenticatedFetch(`/api/org/workout-builder/adaptation-drafts/${id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ coachNotes: notes }),
      });
      // Also create outcome tracking record
      const draft = data?.prioritizedQueue.find((d) => d.id === id);
      if (draft) {
        await authenticatedFetch("/api/org/intelligence/outcomes", {
          method: "POST", headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ adaptationDraftId: id, athleteUserId: draft.athleteUserId, interventionType: draft.interventionType }),
        }).catch(() => {});
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/adaptation-drafts"] });
      toast({ title: "Approved", description: "Adaptation draft approved and outcome tracking started." });
    },
    onError: () => toast({ title: "Approval failed", variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      return authenticatedFetch(`/api/org/workout-builder/adaptation-drafts/${id}/dismiss`, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ coachNotes: notes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/adaptation-drafts"] });
      toast({ title: "Dismissed" });
    },
    onError: () => toast({ title: "Dismiss failed", variant: "destructive" }),
  });

  const queue = data?.prioritizedQueue ?? [];
  const criticalAthletes = data?.criticalAthletes ?? [];
  const summary = data?.summary ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const visibleQueue = showAll ? queue : queue.slice(0, 5);
  const totalPending = queue.length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
        <Brain className="h-4 w-4" /> Building priority queue…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="intervention-priority-queue">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Intervention Priority Queue</span>
          {totalPending > 0 && (
            <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">{totalPending}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {summary.critical > 0 && <span className="text-red-400 font-semibold">{summary.critical} critical</span>}
          {summary.high > 0 && <span className="text-orange-400">{summary.high} high</span>}
          {summary.medium > 0 && <span className="text-amber-400">{summary.medium} med</span>}
        </div>
      </div>

      {/* Critical Athletes strip */}
      {criticalAthletes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Needs attention now</p>
          {criticalAthletes.slice(0, 4).map((a) => (
            <CriticalAthleteStrip key={a.athleteUserId} athlete={a} />
          ))}
        </div>
      )}

      {/* Priority queue */}
      {queue.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500/50" />
          No pending interventions. All athlete signals are within normal thresholds.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleQueue.map((item) => (
            <InterventionCard
              key={item.id}
              item={item}
              onApprove={(id, notes) => approveMutation.mutate({ id, notes })}
              onDismiss={(id, notes) => dismissMutation.mutate({ id, notes })}
              isApproving={approveMutation.isPending && approveMutation.variables?.id === item.id}
              isDismissing={dismissMutation.isPending && dismissMutation.variables?.id === item.id}
            />
          ))}
          {queue.length > 5 && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs gap-1" onClick={() => setShowAll((v) => !v)}>
              {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showAll ? "Show less" : `Show all ${queue.length} interventions`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
