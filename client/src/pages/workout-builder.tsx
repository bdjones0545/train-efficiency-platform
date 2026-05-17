import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dumbbell, Wifi, WifiOff, Plus, Loader2, ChevronRight, ChevronLeft,
  Check, Star, Users, User, Archive, Pencil, ArrowRight, Calendar,
  Target, Clock, Zap, AlertTriangle, CheckCircle2, BarChart3,
  MessageSquarePlus, X, ClipboardList,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Program = any;
type Session = any;

const GOALS = ["strength", "speed", "hypertrophy", "return_to_play", "general_performance", "custom"];
const GOAL_LABELS: Record<string, string> = {
  strength: "Strength", speed: "Speed & Power", hypertrophy: "Hypertrophy",
  return_to_play: "Return to Play", general_performance: "General Performance", custom: "Custom",
};
const DURATIONS = [4, 6, 8, 12];
const DAYS = [2, 3, 4, 5, 6];

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
    assigned: { label: "Assigned", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
    archived: { label: "Archived", className: "bg-orange-500/10 text-orange-400 border-orange-500/30" },
  };
  const c = cfg[status] ?? cfg.draft;
  return <Badge variant="outline" className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

function RatingStars({ rating, onRate }: { rating?: number; onRate?: (r: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onRate?.(n)}
          className={`h-5 w-5 transition-colors ${n <= (rating ?? 0) ? "text-amber-400" : "text-muted-foreground/30"} ${onRate ? "hover:text-amber-400 cursor-pointer" : "cursor-default"}`}
        >
          <Star className="h-4 w-4 fill-current" />
        </button>
      ))}
    </div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────
function SessionCard({ session, completions, onComplete }: { session: Session; completions: any[]; onComplete: (id: string, notes: string, rating: number) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState(0);
  const done = completions.some((c) => c.workoutSessionId === session.id);
  const exercises: any[] = (session.sessionData as any)?.exercises ?? [];

  return (
    <>
      <Card
        className={`p-4 cursor-pointer hover:border-primary/30 transition-colors ${done ? "opacity-60" : ""}`}
        onClick={() => setOpen(true)}
        data-testid={`card-session-${session.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">Wk {session.weekNumber} · Day {session.dayNumber}</Badge>
              {done && <Badge className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30"><Check className="h-3 w-3 mr-1" />Done</Badge>}
            </div>
            <p className="font-semibold text-sm mt-1">{session.title}</p>
            {session.focus && <p className="text-xs text-muted-foreground">{session.focus}</p>}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
        </div>
        {exercises.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">{exercises.length} exercise{exercises.length !== 1 ? "s" : ""}</p>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5" />
              {session.title}
            </DialogTitle>
          </DialogHeader>
          {session.focus && <p className="text-sm text-muted-foreground">{session.focus}</p>}
          {exercises.length > 0 ? (
            <div className="space-y-2 mt-2">
              {exercises.map((ex: any, i: number) => (
                <Card key={i} className="p-3 space-y-0.5">
                  <p className="text-sm font-medium">{ex.name ?? ex.exercise ?? `Exercise ${i + 1}`}</p>
                  {(ex.sets || ex.reps || ex.load || ex.rest) && (
                    <p className="text-xs text-muted-foreground">
                      {[ex.sets && `${ex.sets} sets`, ex.reps && `${ex.reps} reps`, ex.load && `@ ${ex.load}`, ex.rest && `${ex.rest} rest`].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {ex.notes && <p className="text-xs text-muted-foreground italic">{ex.notes}</p>}
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No exercise details available.</p>
          )}
          {!done && (
            <div className="border-t pt-4 space-y-3 mt-2">
              <p className="text-sm font-medium">Mark as complete</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Difficulty Rating</Label>
                <RatingStars rating={rating} onRate={setRating} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea rows={2} placeholder="How did it feel?" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-completion-notes" />
              </div>
              <Button size="sm" className="w-full" onClick={() => { onComplete(session.id, notes, rating); setOpen(false); }} data-testid="button-complete-session">
                <Check className="h-4 w-4 mr-1.5" /> Mark Complete
              </Button>
            </div>
          )}
          {done && <p className="text-sm text-emerald-500 flex items-center gap-1 mt-2"><CheckCircle2 className="h-4 w-4" /> Completed</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Program Detail View ──────────────────────────────────────────────────────
function ProgramDetail({ programId, orgId, isCoach, onBack, orgSlug }: { programId: string; orgId: string | null; isCoach: boolean; onBack: () => void; orgSlug: string }) {
  const { toast } = useToast();
  const [showRefineDialog, setShowRefineDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [assignType, setAssignType] = useState<"athlete" | "team">("athlete");
  const [assignTargetId, setAssignTargetId] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/programs", programId],
    queryFn: () => fetch(`/api/org/workout-builder/programs/${programId}`).then((r) => r.json()),
    enabled: !!programId,
  });

  const { data: bootstrap } = useQuery<any>({ queryKey: ["/api/org/workout-builder/bootstrap"] });

  const refineMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/workout-builder/programs/${programId}/edit`, { instruction: refineInstruction }),
    onSuccess: () => { toast({ title: "Program refined" }); setShowRefineDialog(false); setRefineInstruction(""); refetch(); },
    onError: () => toast({ title: "Refinement failed", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/workout-builder/${programId}/assign`, {
      assignedToType: assignType,
      ...(assignType === "athlete" ? { athleteUserId: assignTargetId } : { teamId: assignTargetId }),
    }),
    onSuccess: () => { toast({ title: "Program assigned" }); setShowAssignDialog(false); queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/bootstrap"] }); refetch(); },
    onError: () => toast({ title: "Assignment failed", variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/org/workout-builder/programs/${programId}`, { status: "archived" }),
    onSuccess: () => { toast({ title: "Program archived" }); onBack(); queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/bootstrap"] }); },
    onError: () => toast({ title: "Archive failed", variant: "destructive" }),
  });

  const saveTitleMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/org/workout-builder/programs/${programId}`, { title: titleValue }),
    onSuccess: () => { setEditingTitle(false); refetch(); },
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data?.program) return <div className="text-center py-8 text-muted-foreground">Program not found.</div>;

  const { program, sessions, assignments } = data;
  const weekGroups: Record<number, Session[]> = {};
  for (const s of (sessions ?? [])) {
    if (!weekGroups[s.weekNumber]) weekGroups[s.weekNumber] = [];
    weekGroups[s.weekNumber].push(s);
  }

  return (
    <div className="space-y-6" data-testid="view-program-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-to-library">
        <ChevronLeft className="h-4 w-4" /> Back to Library
      </button>

      {/* Header */}
      <div className="space-y-1">
        {editingTitle ? (
          <div className="flex gap-2 items-center">
            <Input value={titleValue} onChange={(e) => setTitleValue(e.target.value)} className="text-lg font-bold h-9" data-testid="input-program-title" />
            <Button size="sm" onClick={() => saveTitleMutation.mutate()} disabled={saveTitleMutation.isPending} data-testid="button-save-title"><Check className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold" data-testid="text-program-title">{program.title}</h2>
            {isCoach && <button onClick={() => { setTitleValue(program.title); setEditingTitle(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <StatusBadge status={program.status} />
          <Badge variant="outline" className="text-xs">{GOAL_LABELS[program.goal] ?? program.goal}</Badge>
          {program.sport && <Badge variant="outline" className="text-xs">{program.sport}</Badge>}
          <Badge variant="outline" className="text-xs"><Calendar className="h-3 w-3 mr-1" />{program.durationWeeks}wk</Badge>
          <Badge variant="outline" className="text-xs"><Zap className="h-3 w-3 mr-1" />{program.daysPerWeek}x/wk</Badge>
        </div>
      </div>

      {program.generatedSummary && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <p className="text-sm leading-relaxed" data-testid="text-program-summary">{program.generatedSummary}</p>
        </Card>
      )}

      {/* Coach actions */}
      {isCoach && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setShowAssignDialog(true)} data-testid="button-assign-program"><Users className="h-4 w-4 mr-1.5" /> Assign Program</Button>
          <Button size="sm" variant="outline" onClick={() => setShowRefineDialog(true)} data-testid="button-refine-program"><MessageSquarePlus className="h-4 w-4 mr-1.5" /> Refine with TrainChat</Button>
          {program.status !== "archived" && (
            <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending} data-testid="button-archive-program">
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Archive className="h-4 w-4 mr-1.5" />} Archive
            </Button>
          )}
        </div>
      )}

      {/* Assignments */}
      {isCoach && assignments?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Assignments ({assignments.length})</p>
          <div className="grid gap-1.5">
            {assignments.map((a: any) => (
              <Card key={a.id} className="p-3 flex items-center gap-2">
                {a.assignedToType === "team" ? <Users className="h-3.5 w-3.5 text-blue-400" /> : <User className="h-3.5 w-3.5 text-primary" />}
                <span className="text-sm">{a.assignedToType === "team" ? `Team: ${a.teamId}` : `Athlete: ${a.athleteUserId}`}</span>
                <Badge variant="outline" className="ml-auto text-xs">{a.status}</Badge>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Sessions */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Program Sessions</p>
        {Object.keys(weekGroups).length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">
            No sessions were parsed from the TrainChat response. The raw response is stored and can be viewed in the program data.
          </Card>
        ) : (
          Object.entries(weekGroups).sort(([a], [b]) => Number(a) - Number(b)).map(([week, wSessions]) => (
            <div key={week} className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">Week {week}</p>
              <div className="grid gap-2">
                {wSessions.sort((a, b) => a.dayNumber - b.dayNumber).map((s: any) => (
                  <Card key={s.id} className="p-3" data-testid={`card-session-coach-${s.id}`}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Day {s.dayNumber}</Badge>
                      <span className="text-sm font-medium">{s.title}</span>
                      {s.focus && <span className="text-xs text-muted-foreground">· {s.focus}</span>}
                    </div>
                    {(s.sessionData as any)?.exercises?.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">{(s.sessionData as any).exercises.length} exercises</p>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Refine Dialog */}
      <Dialog open={showRefineDialog} onOpenChange={setShowRefineDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquarePlus className="h-5 w-5" />Refine with TrainChat</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Describe the adjustment you want TrainChat to make to this program.</p>
          <Textarea
            rows={4}
            placeholder="e.g. reduce lower body volume, increase speed emphasis, shorten sessions to 45 min..."
            value={refineInstruction}
            onChange={(e) => setRefineInstruction(e.target.value)}
            data-testid="input-refine-instruction"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowRefineDialog(false)}>Cancel</Button>
            <Button onClick={() => refineMutation.mutate()} disabled={refineMutation.isPending || !refineInstruction.trim()} data-testid="button-submit-refine">
              {refineMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Refining…</> : <>Send to TrainChat</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Assign Program</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Assign to</Label>
              <Select value={assignType} onValueChange={(v) => { setAssignType(v as any); setAssignTargetId(""); }}>
                <SelectTrigger data-testid="select-assign-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="athlete">Individual Athlete</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignType === "athlete" ? (
              <div className="space-y-1.5">
                <Label className="text-sm">Select Athlete</Label>
                <Select value={assignTargetId} onValueChange={setAssignTargetId}>
                  <SelectTrigger data-testid="select-assign-athlete"><SelectValue placeholder="Choose athlete…" /></SelectTrigger>
                  <SelectContent>
                    {(bootstrap?.athletes ?? []).map((a: any) => (
                      <SelectItem key={a.userId} value={a.userId}>{a.name ?? a.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-sm">Select Team</Label>
                <Select value={assignTargetId} onValueChange={setAssignTargetId}>
                  <SelectTrigger data-testid="select-assign-team"><SelectValue placeholder="Choose team…" /></SelectTrigger>
                  <SelectContent>
                    {(bootstrap?.teams ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending || !assignTargetId} data-testid="button-confirm-assign">
              {assignMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Assigning…</> : <>Assign</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Generate Wizard ──────────────────────────────────────────────────────────
function GenerateWizard({ programToolId, bootstrap, onGenerated, onClose }: { programToolId: string; bootstrap: any; onGenerated: (p: any) => void; onClose: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 9;

  const [targetType, setTargetType] = useState<"team" | "athlete">("team");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [goal, setGoal] = useState("");
  const [sport, setSport] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [equipment, setEquipment] = useState("");
  const [constraints, setConstraints] = useState("");
  const [coachNotes, setCoachNotes] = useState("");

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/org/workout-builder/generate", {
        programToolId,
        targetType,
        athleteUserIds: targetType === "athlete" ? selectedAthleteIds : [],
        teamId: targetType === "team" ? selectedTeamId : undefined,
        goal,
        sport: sport || undefined,
        durationWeeks,
        daysPerWeek,
        equipment: equipment || undefined,
        constraints: constraints || undefined,
        coachNotes: coachNotes || undefined,
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.generationError) {
        toast({ title: "Generation issue", description: data.generationError, variant: "destructive" });
      } else {
        toast({ title: "Program generated!", description: `${data.program?.title} is ready.` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/org/workout-builder/bootstrap"] });
      onGenerated(data.program);
    },
    onError: () => toast({ title: "Generation failed", description: "Check TrainChat connection.", variant: "destructive" }),
  });

  const athletes: any[] = bootstrap?.athletes ?? [];
  const teams: any[] = bootstrap?.teams ?? [];

  const canNext = () => {
    if (step === 1) return true;
    if (step === 2) return targetType === "team" ? !!selectedTeamId : selectedAthleteIds.length > 0;
    if (step === 3) return !!goal;
    return true;
  };

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const selectedTeam = teams.find((t: any) => t.id === selectedTeamId);
  const selectedAthletes = athletes.filter((a: any) => selectedAthleteIds.includes(a.userId));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            Generate Program
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground text-right">Step {step} of {TOTAL_STEPS}</p>

        {/* Step content */}
        <div className="min-h-[180px] space-y-4">

          {/* Step 1: Target type */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Who is this program for?</p>
              <div className="grid grid-cols-2 gap-3">
                {[{ value: "team", icon: <Users className="h-6 w-6" />, label: "Team", desc: "Assign to a whole team" }, { value: "athlete", icon: <User className="h-6 w-6" />, label: "Individual", desc: "One or more athletes" }].map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setTargetType(opt.value as any)} data-testid={`btn-target-${opt.value}`}
                    className={`flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all ${targetType === opt.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                    {opt.icon}
                    <span className="font-medium text-sm">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Select team or athletes */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{targetType === "team" ? "Select a team" : "Select athletes"}</p>
              {targetType === "team" ? (
                teams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No teams found. Create teams in the PR Tracker first.</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {teams.map((t: any) => (
                      <button key={t.id} type="button" onClick={() => setSelectedTeamId(t.id)} data-testid={`btn-team-${t.id}`}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${selectedTeamId === t.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                        <Users className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <div><p className="text-sm font-medium">{t.name}</p>{t.sport && <p className="text-xs text-muted-foreground">{t.sport}</p>}</div>
                        {selectedTeamId === t.id && <Check className="h-4 w-4 text-primary ml-auto flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )
              ) : (
                athletes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No athletes found in your organization.</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {athletes.map((a: any) => (
                      <button key={a.userId} type="button" onClick={() => toggleAthlete(a.userId)} data-testid={`btn-athlete-${a.userId}`}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${selectedAthleteIds.includes(a.userId) ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                        <User className="h-4 w-4 text-primary flex-shrink-0" />
                        <div><p className="text-sm font-medium">{a.name ?? a.email}</p>{a.email && a.name && <p className="text-xs text-muted-foreground">{a.email}</p>}</div>
                        {selectedAthleteIds.includes(a.userId) && <Check className="h-4 w-4 text-primary ml-auto flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* Step 3: Goal */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">What is the primary goal?</p>
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button key={g} type="button" onClick={() => setGoal(g)} data-testid={`btn-goal-${g}`}
                    className={`p-3 rounded-lg border-2 text-sm font-medium text-left transition-all ${goal === g ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                    {GOAL_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Sport */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Sport or context? <span className="text-muted-foreground font-normal">(optional)</span></p>
              <Input placeholder="e.g. Football, Basketball, Soccer, General…" value={sport} onChange={(e) => setSport(e.target.value)} data-testid="input-sport" />
              <p className="text-xs text-muted-foreground">This helps TrainChat tailor movement patterns and energy system emphasis.</p>
            </div>
          )}

          {/* Step 5: Duration */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Program duration</p>
              <div className="grid grid-cols-4 gap-2">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" onClick={() => setDurationWeeks(d)} data-testid={`btn-duration-${d}`}
                    className={`p-3 rounded-lg border-2 text-sm font-semibold text-center transition-all ${durationWeeks === d ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                    {d}wk
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 6: Days per week */}
          {step === 6 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Training days per week</p>
              <div className="grid grid-cols-5 gap-2">
                {DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => setDaysPerWeek(d)} data-testid={`btn-days-${d}`}
                    className={`p-3 rounded-lg border-2 text-sm font-semibold text-center transition-all ${daysPerWeek === d ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                    {d}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 7: Equipment */}
          {step === 7 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Available equipment <span className="text-muted-foreground font-normal">(optional)</span></p>
              <Textarea rows={3} placeholder="e.g. Full weight room, barbells, dumbbells, sleds, bands. Or: Bodyweight only." value={equipment} onChange={(e) => setEquipment(e.target.value)} data-testid="input-equipment" />
            </div>
          )}

          {/* Step 8: Constraints */}
          {step === 8 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Constraints, injuries, or coach notes <span className="text-muted-foreground font-normal">(optional)</span></p>
              <Textarea rows={3} placeholder="e.g. Athlete has a knee injury — avoid deep squats. Limit sessions to 60 min." value={constraints} onChange={(e) => setConstraints(e.target.value)} data-testid="input-constraints" />
              <Textarea rows={2} placeholder="Coach notes for TrainChat…" value={coachNotes} onChange={(e) => setCoachNotes(e.target.value)} data-testid="input-coach-notes" />
            </div>
          )}

          {/* Step 9: Context preview + Generate */}
          {step === 9 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Context preview</p>
              <Card className="p-3 space-y-2 bg-muted/30 text-xs leading-relaxed">
                <p className="flex items-center gap-2"><Target className="h-3.5 w-3.5 text-primary" /><span><strong>Target:</strong> {targetType === "team" ? `Team: ${selectedTeam?.name ?? selectedTeamId}` : `${selectedAthletes.length} athlete(s)`}</span></p>
                <p className="flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-primary" /><span><strong>Goal:</strong> {GOAL_LABELS[goal] ?? goal}</span></p>
                {sport && <p className="flex items-center gap-2"><Dumbbell className="h-3.5 w-3.5 text-primary" /><span><strong>Sport:</strong> {sport}</span></p>}
                <p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-primary" /><span><strong>Program:</strong> {durationWeeks} weeks · {daysPerWeek}x/week</span></p>
                {equipment && <p className="flex items-center gap-2"><ClipboardList className="h-3.5 w-3.5 text-primary" /><span><strong>Equipment:</strong> {equipment}</span></p>}
                {constraints && <p className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /><span><strong>Constraints:</strong> {constraints}</span></p>}
                {selectedAthletes.length > 0 && <p className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-primary" /><span><strong>Athletes:</strong> {selectedAthletes.map((a) => a.name ?? a.email).join(", ")}</span></p>}
              </Card>
              <p className="text-xs text-muted-foreground italic">This context will be sent to TrainChat for AI program generation.</p>
              {!bootstrap?.trainChatConnected && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-destructive text-xs">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  TrainChat is not connected. Go to Options → Advanced → Integrations to connect it.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => step > 1 ? setStep(step - 1) : onClose()} data-testid="button-wizard-back">
            <ChevronLeft className="h-4 w-4 mr-1" />{step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button size="sm" onClick={() => setStep(step + 1)} disabled={!canNext()} data-testid="button-wizard-next">
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !bootstrap?.trainChatConnected} data-testid="button-generate-program">
              {generateMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Generating…</> : <><Zap className="h-4 w-4 mr-1.5" />Generate Program</>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Coach Library View ───────────────────────────────────────────────────────
function CoachLibraryView({ programs, onSelect, onGenerate }: { programs: any[]; onSelect: (id: string) => void; onGenerate: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const filtered = statusFilter === "all" ? programs : programs.filter((p) => p.status === statusFilter);

  return (
    <div className="space-y-4" data-testid="view-coach-library">
      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", "draft", "assigned", "archived"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-${s}`}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 opacity-60">{s === "all" ? programs.length : programs.filter((p) => p.status === s).length}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center space-y-4">
          <Dumbbell className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="font-semibold">{programs.length === 0 ? "No programs yet" : "No programs match this filter"}</p>
            <p className="text-sm text-muted-foreground mt-1">{programs.length === 0 ? "Generate your first program using TrainChat." : "Try a different filter."}</p>
          </div>
          {programs.length === 0 && <Button onClick={onGenerate} data-testid="button-generate-first"><Zap className="h-4 w-4 mr-1.5" />Generate First Program</Button>}
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <Card key={p.id} className="p-4 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => onSelect(p.id)} data-testid={`card-program-${p.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <p className="font-semibold text-sm leading-tight">{p.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={p.status} />
                    <Badge variant="outline" className="text-xs">{GOAL_LABELS[p.goal] ?? p.goal}</Badge>
                    {p.sport && <Badge variant="outline" className="text-xs">{p.sport}</Badge>}
                    <Badge variant="outline" className="text-xs">{p.durationWeeks}wk · {p.daysPerWeek}x</Badge>
                  </div>
                  {p.generatedSummary && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{p.generatedSummary}</p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Athlete View ─────────────────────────────────────────────────────────────
function AthleteWorkoutsView({ orgSlug }: { orgSlug: string }) {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/my-workouts"],
    queryFn: () => fetch("/api/org/workout-builder/my-workouts").then((r) => r.json()),
  });

  const completeMutation = useMutation({
    mutationFn: ({ sessionId, notes, rating }: { sessionId: string; notes: string; rating: number }) =>
      apiRequest("POST", `/api/org/workout-builder/sessions/${sessionId}/complete`, { notes: notes || undefined, rating: rating > 0 ? rating : undefined }),
    onSuccess: () => { toast({ title: "Session marked complete!" }); refetch(); },
    onError: () => toast({ title: "Could not save", variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const { programs = [], sessions = [], completions = [] } = data ?? {};

  if (programs.length === 0) {
    return (
      <Card className="p-10 text-center space-y-3" data-testid="card-no-workouts">
        <Dumbbell className="h-10 w-10 text-muted-foreground mx-auto" />
        <p className="font-semibold">No workouts assigned yet</p>
        <p className="text-sm text-muted-foreground">Your coach will assign programs once they're generated.</p>
      </Card>
    );
  }

  const completedIds = new Set(completions.map((c: any) => c.workoutSessionId));
  const totalSessions = sessions.length;
  const completedCount = sessions.filter((s: any) => completedIds.has(s.id)).length;

  return (
    <div className="space-y-6" data-testid="view-athlete-workouts">
      {/* Progress overview */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Overall Progress</p>
          <span className="text-sm text-muted-foreground">{completedCount}/{totalSessions} sessions</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${totalSessions > 0 ? (completedCount / totalSessions) * 100 : 0}%` }} />
        </div>
      </Card>

      {programs.map((prog: any) => {
        const progSessions = sessions.filter((s: any) => s.workoutProgramId === prog.id);
        const weekGroups: Record<number, any[]> = {};
        for (const s of progSessions) {
          if (!weekGroups[s.weekNumber]) weekGroups[s.weekNumber] = [];
          weekGroups[s.weekNumber].push(s);
        }
        return (
          <div key={prog.id} className="space-y-4" data-testid={`section-program-${prog.id}`}>
            <div>
              <h3 className="font-bold text-base">{prog.title}</h3>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs">{GOAL_LABELS[prog.goal] ?? prog.goal}</Badge>
                {prog.sport && <Badge variant="outline" className="text-xs">{prog.sport}</Badge>}
                <Badge variant="outline" className="text-xs">{prog.durationWeeks}wk · {prog.daysPerWeek}x/wk</Badge>
              </div>
              {prog.generatedSummary && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{prog.generatedSummary}</p>}
            </div>
            {Object.entries(weekGroups).sort(([a], [b]) => Number(a) - Number(b)).map(([week, wSessions]) => (
              <div key={week} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Week {week}</p>
                <div className="space-y-2">
                  {wSessions.sort((a, b) => a.dayNumber - b.dayNumber).map((s: any) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      completions={completions}
                      onComplete={(id, notes, rating) => completeMutation.mutate({ sessionId: id, notes, rating })}
                    />
                  ))}
                </div>
              </div>
            ))}
            {progSessions.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No sessions available for this program yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main WorkoutBuilderPage ──────────────────────────────────────────────────
export default function WorkoutBuilderPage({ program, orgSlug }: { program: any; orgSlug: string }) {
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  const { data: bootstrap, isLoading } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/bootstrap"],
    queryFn: () => fetch("/api/org/workout-builder/bootstrap").then((r) => r.json()),
  });

  const isCoach = ["ADMIN", "COACH"].includes(bootstrap?.currentUser?.role ?? "");
  const programs: any[] = bootstrap?.programs ?? [];
  const trainChatConnected: boolean = bootstrap?.trainChatConnected ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Athlete view
  if (!isCoach) {
    return (
      <div className="space-y-6" data-testid="page-workout-builder-athlete">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Dumbbell className="h-5 w-5" /> My Workouts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{program?.name}</p>
          </div>
        </div>
        <AthleteWorkoutsView orgSlug={orgSlug} />
      </div>
    );
  }

  // Coach view
  return (
    <div className="space-y-6" data-testid="page-workout-builder-coach">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            Workout Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{program?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {trainChatConnected ? (
            <Badge className="text-xs gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/30" data-testid="badge-trainchat-status">
              <Wifi className="h-3 w-3" /> TrainChat Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-trainchat-status-off">
              <WifiOff className="h-3 w-3" /> TrainChat Not Connected
            </Badge>
          )}
          <Button
            size="sm"
            onClick={() => setShowWizard(true)}
            disabled={!trainChatConnected}
            data-testid="button-generate-program-header"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Generate Program
          </Button>
        </div>
      </div>

      {!trainChatConnected && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">TrainChat not connected</p>
            <p className="text-xs text-muted-foreground mt-0.5">Go to Options → Advanced → Integrations to connect your TrainChat API key.</p>
          </div>
        </Card>
      )}

      <Separator />

      {/* Program detail or library */}
      {selectedProgramId ? (
        <ProgramDetail
          programId={selectedProgramId}
          orgId={bootstrap?.org?.id ?? null}
          isCoach={isCoach}
          onBack={() => setSelectedProgramId(null)}
          orgSlug={orgSlug}
        />
      ) : (
        <CoachLibraryView
          programs={programs}
          onSelect={setSelectedProgramId}
          onGenerate={() => setShowWizard(true)}
        />
      )}

      {/* Generate wizard */}
      {showWizard && (
        <GenerateWizard
          programToolId={program?.id ?? ""}
          bootstrap={bootstrap}
          onGenerated={(p) => { setShowWizard(false); if (p?.id) setSelectedProgramId(p.id); }}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}
