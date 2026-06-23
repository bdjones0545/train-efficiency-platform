import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Wand2, AlertTriangle, CheckCircle2, X, BookOpen, ChevronDown, ChevronUp,
  Clock, Zap, ShieldAlert, Activity, Eye, Loader2, ClipboardList, ArrowRight,
} from "lucide-react";

interface AdaptationDraft {
  id: string;
  orgId: string;
  athleteUserId: string;
  workoutProgramId: string | null;
  adaptationType: string;
  triggerSignals: { signal: string; severity: string; description: string }[];
  adaptationRationale: string | null;
  draftSessions: any[];
  newContextSnapshot: {
    readinessTrend: string;
    complianceRate: number;
    riskLevel: string;
    aiSummary?: string;
  } | null;
  previousContextSnapshot: {
    readinessTrend: string;
    complianceRate: number;
    riskLevel: string;
  } | null;
  status: string;
  generationError: string | null;
  createdAt: string;
  athleteName?: string;
}

interface Props {
  orgId: string;
  athleteUserId?: string;
  headers?: Record<string, string>;
  compact?: boolean;
}

const ADAPTATION_LABELS: Record<string, string> = {
  deload: "Deload Week",
  injury_modification: "Injury Modification",
  recovery_emphasis: "Recovery Emphasis",
  program_simplification: "Program Simplification",
  comprehensive_review: "Comprehensive Review",
  load_reduction: "Load Reduction",
};

const ADAPTATION_COLORS: Record<string, string> = {
  deload: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  injury_modification: "bg-red-500/10 text-red-400 border-red-500/30",
  recovery_emphasis: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  program_simplification: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  comprehensive_review: "bg-red-500/10 text-red-400 border-red-500/30",
  load_reduction: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

const SIGNAL_LABELS: Record<string, string> = {
  readiness_dropped_to_low: "Readiness dropped",
  compliance_critical: "Compliance critical",
  compliance_declining: "Compliance declining",
  risk_escalated_to_red: "Risk escalated to high",
  new_pain_reported: "New pain reported",
  rpe_spiked_high: "RPE spiked high",
};

function SignalBadge({ signal }: { signal: { signal: string; severity: string } }) {
  const isHigh = signal.severity === "high";
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 h-4 ${isHigh ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}
    >
      {SIGNAL_LABELS[signal.signal] ?? signal.signal.replace(/_/g, " ")}
    </Badge>
  );
}

function ContextDiff({ prev, curr }: { prev: AdaptationDraft["previousContextSnapshot"]; curr: AdaptationDraft["newContextSnapshot"] }) {
  if (!prev || !curr) return null;
  const rows = [
    { label: "Readiness", before: prev.readinessTrend, after: curr.readinessTrend, changed: prev.readinessTrend !== curr.readinessTrend },
    { label: "Compliance", before: `${prev.complianceRate}%`, after: `${curr.complianceRate}%`, changed: prev.complianceRate !== curr.complianceRate },
    { label: "Risk", before: prev.riskLevel, after: curr.riskLevel, changed: prev.riskLevel !== curr.riskLevel },
  ].filter((r) => r.changed);

  if (rows.length === 0) return null;

  return (
    <div className="rounded bg-muted/30 border border-border/50 p-2 space-y-1">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Context change</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground w-16 flex-shrink-0">{r.label}</span>
          <span className="text-muted-foreground line-through">{r.before}</span>
          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
          <span className="text-foreground font-medium">{r.after}</span>
        </div>
      ))}
    </div>
  );
}

function DraftCard({
  draft,
  onApprove,
  onDismiss,
  onAssignEducation,
  isApproving,
  isDismissing,
}: {
  draft: AdaptationDraft;
  onApprove: (id: string, notes: string) => void;
  onDismiss: (id: string, notes: string) => void;
  onAssignEducation: (id: string) => void;
  isApproving: boolean;
  isDismissing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [coachNotes, setCoachNotes] = useState("");

  const adaptationColor = ADAPTATION_COLORS[draft.adaptationType] ?? "bg-muted text-muted-foreground border-border";
  const sessionCount = Array.isArray(draft.draftSessions) ? draft.draftSessions.length : 0;

  return (
    <div
      className="rounded-lg border border-border bg-card"
      data-testid={`adaptation-draft-${draft.id}`}
    >
      {/* Header */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-xs ${adaptationColor}`}>
              <Wand2 className="h-2.5 w-2.5 mr-1" />
              {ADAPTATION_LABELS[draft.adaptationType] ?? draft.adaptationType}
            </Badge>
            {draft.athleteName && (
              <span className="text-xs text-muted-foreground font-medium">{draft.athleteName}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {new Date(draft.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* Trigger signals */}
        <div className="flex flex-wrap gap-1">
          {(draft.triggerSignals ?? []).map((s, i) => (
            <SignalBadge key={i} signal={s} />
          ))}
        </div>

        {/* Context diff */}
        <ContextDiff prev={draft.previousContextSnapshot} curr={draft.newContextSnapshot} />

        {/* Rationale */}
        {draft.adaptationRationale && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {draft.adaptationRationale}
          </p>
        )}

        {/* Draft info */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {draft.generationError ? (
            <span className="text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Draft generation failed — review manually
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ClipboardList className="h-3 w-3" />
              {sessionCount} session{sessionCount !== 1 ? "s" : ""} drafted
            </span>
          )}
          <button
            type="button"
            className="flex items-center gap-0.5 hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`btn-expand-draft-${draft.id}`}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide sessions" : "Preview sessions"}
          </button>
        </div>

        {/* Session preview */}
        {expanded && Array.isArray(draft.draftSessions) && draft.draftSessions.length > 0 && (
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {draft.draftSessions.slice(0, 6).map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30 border border-border/40 text-xs" data-testid={`draft-session-${draft.id}-${i}`}>
                <span className="text-muted-foreground w-16 flex-shrink-0">Wk {s.weekNumber} · D{s.dayNumber}</span>
                <span className="truncate">{s.title}</span>
                {s.focus && <Badge variant="outline" className="text-[10px] h-4 px-1 flex-shrink-0">{s.focus}</Badge>}
              </div>
            ))}
            {draft.draftSessions.length > 6 && (
              <p className="text-[10px] text-muted-foreground px-2">+{draft.draftSessions.length - 6} more sessions</p>
            )}
          </div>
        )}
      </div>

      {/* Action area */}
      <div className="border-t border-border/50 p-3 space-y-2">
        {showActions ? (
          <>
            <Textarea
              placeholder="Optional coach notes before deciding…"
              value={coachNotes}
              onChange={(e) => setCoachNotes(e.target.value)}
              rows={2}
              className="text-xs"
              data-testid={`input-coach-notes-${draft.id}`}
            />
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onApprove(draft.id, coachNotes)}
                disabled={isApproving}
                data-testid={`btn-approve-draft-${draft.id}`}
              >
                {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve & Assign
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onAssignEducation(draft.id)}
                data-testid={`btn-education-draft-${draft.id}`}
              >
                <BookOpen className="h-3 w-3" /> Assign Education Instead
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={() => onDismiss(draft.id, coachNotes)}
                disabled={isDismissing}
                data-testid={`btn-dismiss-draft-${draft.id}`}
              >
                {isDismissing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Dismiss
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setShowActions(false)}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 w-full"
            onClick={() => setShowActions(true)}
            data-testid={`btn-review-draft-${draft.id}`}
          >
            <Eye className="h-3 w-3" /> Review & Decide
          </Button>
        )}
      </div>
    </div>
  );
}

export function ProgramAdaptationDraftsPanel({ orgId, athleteUserId, headers, compact = false }: Props) {
  const { toast } = useToast();

  const endpoint = athleteUserId
    ? `/api/org/workout-builder/athletes/${athleteUserId}/adaptation-drafts`
    : `/api/org/workout-builder/adaptation-drafts`;

  const queryKey = athleteUserId
    ? ["/api/org/workout-builder/athletes", athleteUserId, "adaptation-drafts"]
    : ["/api/org/workout-builder/adaptation-drafts"];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      return authenticatedFetch(endpoint, { headers: headers }) as Promise<{ drafts: AdaptationDraft[] }>;
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      return authenticatedFetch(`/api/org/workout-builder/adaptation-drafts/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ coachNotes: notes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Draft approved", description: "The adaptation has been assigned to the athlete." });
    },
    onError: () => toast({ title: "Approval failed", variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      return authenticatedFetch(`/api/org/workout-builder/adaptation-drafts/${id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ coachNotes: notes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Draft dismissed", description: "The adaptation draft has been dismissed." });
    },
    onError: () => toast({ title: "Dismiss failed", variant: "destructive" }),
  });

  const educationMutation = useMutation({
    mutationFn: async (id: string) => {
      return authenticatedFetch(`/api/org/workout-builder/adaptation-drafts/${id}/assign-education`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Education assigned", description: "The athlete will receive relevant education content." });
    },
    onError: () => toast({ title: "Assignment failed", variant: "destructive" }),
  });

  const drafts = data?.drafts ?? [];
  const pendingDrafts = drafts.filter((d) => d.status === "pending_review");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
        <Activity className="h-4 w-4" /> Loading adaptation drafts…
      </div>
    );
  }

  if (compact && pendingDrafts.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="adaptation-drafts-panel">
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Program Adaptation Drafts</span>
            {pendingDrafts.length > 0 && (
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
                {pendingDrafts.length} pending
              </Badge>
            )}
          </div>
        </div>
      )}

      {pendingDrafts.length === 0 ? (
        !compact && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500/50" />
            No pending adaptation drafts. Athlete context is within normal thresholds.
          </div>
        )
      ) : (
        <div className="space-y-3">
          {pendingDrafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onApprove={(id, notes) => approveMutation.mutate({ id, notes })}
              onDismiss={(id, notes) => dismissMutation.mutate({ id, notes })}
              onAssignEducation={(id) => educationMutation.mutate(id)}
              isApproving={approveMutation.isPending && approveMutation.variables?.id === draft.id}
              isDismissing={dismissMutation.isPending && dismissMutation.variables?.id === draft.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
