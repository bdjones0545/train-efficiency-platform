import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/authToken";
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
import { Slider } from "@/components/ui/slider";
import {
  Dumbbell, Wifi, WifiOff, Plus, Loader2, ChevronRight, ChevronLeft,
  Check, Star, Users, User, Archive, Pencil, ArrowRight, Calendar,
  Target, Clock, Zap, AlertTriangle, CheckCircle2, BarChart3,
  MessageSquarePlus, X, ClipboardList, Activity, Brain, TrendingUp,
  TrendingDown, ShieldAlert, Eye, ChevronDown, ChevronUp, RefreshCw,
  Flame, Gauge, BedDouble, Siren, Sparkles, Wand2, Lock,
} from "lucide-react";
import { AthleteIntelligenceSummary } from "@/components/athlete-intelligence-summary";

// ─── Auth header helper ────────────────────────────────────────────────────────
// Merges all three possible auth signals so every Workout Builder request
// works regardless of whether the user authenticated via:
//   1. Main-app OIDC session cookie (credentials: "include" handles this)
//   2. Main-app email/password Bearer token (Authorization header)
//   3. OrgAuthModal x-org-auth-token (per-org localStorage token)
function getWbHeaders(orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {};

  // Bearer token from email/password login (main app coaches/admins)
  const bearerHeaders = getAuthHeaders();
  Object.assign(headers, bearerHeaders);

  // Org-specific token from OrgAuthModal (athletes / org members)
  if (orgId) {
    const orgToken = localStorage.getItem(`orgToken_${orgId}`);
    if (orgToken) headers["x-org-auth-token"] = orgToken;
  }

  return headers;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Program = any;
type Session = any;

const PAIN_AREAS = ["Lower Back", "Knees", "Shoulders", "Hips", "Hamstrings", "Quads", "Calves", "Ankles", "Neck", "Wrists", "Elbows"];
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

// ─── Readiness Slider ─────────────────────────────────────────────────────────
function ReadinessSlider({ label, value, onChange, lowLabel, highLabel }: { label: string; value: number; onChange: (v: number) => void; lowLabel?: string; highLabel?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-sm font-medium">{label}</Label>
        <span className={`text-lg font-bold tabular-nums ${value <= 3 ? "text-red-400" : value <= 6 ? "text-amber-400" : "text-emerald-400"}`}>{value}</span>
      </div>
      <Slider min={1} max={10} step={1} value={[value]} onValueChange={([v]) => onChange(v)} className="w-full" data-testid={`slider-${label.toLowerCase().replace(/\s/g, "-")}`} />
      {(lowLabel || highLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{lowLabel ?? "Low"}</span>
          <span>{highLabel ?? "High"}</span>
        </div>
      )}
    </div>
  );
}

// ─── Session Card (links to premium execution page) ───────────────────────────
function SessionCard({ session, completions, orgSlug }: { session: Session; completions: any[]; orgSlug?: string }) {
  const done = completions.some((c: any) => c.workoutSessionId === session.id);
  const exercises: any[] = (session.sessionData as any)?.exercises ?? [];
  const [, navigate] = useLocation();

  function handleOpen() {
    if (orgSlug) {
      navigate(`/org/${orgSlug}/workout/${session.id}/execute`);
    }
  }

  return (
    <Card
      className={`p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/30 active:scale-[0.99] ${done ? "border-emerald-500/20 bg-emerald-500/3" : ""}`}
      onClick={handleOpen}
      data-testid={`card-session-${session.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">Wk {session.weekNumber} · Day {session.dayNumber}</Badge>
            {done && (
              <Badge className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400">
                <Check className="h-3 w-3 mr-1" />Done
              </Badge>
            )}
          </div>
          <p className="font-semibold text-sm mt-1">{session.title}</p>
          {session.focus && <p className="text-xs text-muted-foreground">{session.focus}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {exercises.length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Dumbbell className="h-3 w-3" /> {exercises.length} exercise{exercises.length !== 1 ? "s" : ""}
          </p>
        )}
        {done ? (
          <p className="text-xs text-emerald-500 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </p>
        ) : (
          <p className="text-xs text-primary font-medium flex items-center gap-1">
            <Zap className="h-3 w-3" /> Tap to start
          </p>
        )}
      </div>
    </Card>
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
    queryFn: () =>
      fetch(`/api/org/workout-builder/programs/${programId}`, {
        credentials: "include",
        headers: getWbHeaders(orgId ?? undefined),
      }).then((r) => r.json()),
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
          {bootstrap?.programTools?.[0]?.slug && (
            <Button size="sm" variant="outline" className="border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/30"
              onClick={() => window.location.href = `/org/${orgSlug}/programs/${bootstrap.programTools[0].slug}/builder`}
              data-testid="button-open-builder">
              <Wand2 className="h-4 w-4 mr-1.5" /> Open in Builder
            </Button>
          )}
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

              {/* Athlete Intelligence Preview — shown for single-athlete programs */}
              {targetType === "athlete" && selectedAthleteIds.length === 1 && bootstrap?.org?.id && (
                <AthleteIntelligenceSummary
                  athleteUserId={selectedAthleteIds[0]}
                  orgId={bootstrap.org.id}
                  athleteName={selectedAthletes[0]?.name ?? selectedAthletes[0]?.email}
                />
              )}

              <p className="text-xs text-muted-foreground italic">
                {targetType === "athlete" && selectedAthleteIds.length === 1
                  ? "Athlete intelligence (readiness, compliance, RPE) will be injected into the TrainChat request."
                  : "This context will be sent to TrainChat for AI program generation."}
              </p>
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

// ─── Athlete Workout Program List ────────────────────────────────────────────
function AthleteProgramList({ programs, sessions, completions, onFinish, orgSlug }: {
  programs: any[]; sessions: any[]; completions: any[]; onFinish: (sessionId: string, data: any) => void; orgSlug?: string;
}) {
  if (programs.length === 0) return null;

  const completedIds = new Set(completions.map((c: any) => c.workoutSessionId));
  const totalSessions = sessions.filter((s: any) => programs.some((p: any) => p.id === s.workoutProgramId)).length;
  const completedCount = sessions.filter((s: any) =>
    programs.some((p: any) => p.id === s.workoutProgramId) && completedIds.has(s.id)
  ).length;

  return (
    <div className="space-y-6">
      {totalSessions > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Overall Progress</p>
            <span className="text-sm text-muted-foreground">{completedCount}/{totalSessions} sessions</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${totalSessions > 0 ? (completedCount / totalSessions) * 100 : 0}%` }} />
          </div>
        </Card>
      )}
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
                  {(wSessions as any[]).sort((a, b) => a.dayNumber - b.dayNumber).map((s: any) => (
                    <SessionCard key={s.id} session={s} completions={completions} orgSlug={orgSlug} />
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

// ─── Athlete Create Wizard ────────────────────────────────────────────────────
const WIZARD_DURATIONS = [4, 6, 8, 12];
const WIZARD_DAYS = [2, 3, 4, 5, 6];

function AthleteCreateWizard({ open, onClose, programToolId, onCreated }: {
  open: boolean; onClose: () => void; programToolId: string; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [sport, setSport] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(6);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [equipment, setEquipment] = useState("");
  const [limitations, setLimitations] = useState("");

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/workout-builder/athlete/generate", {
      programToolId, goal, sport: sport || undefined, durationWeeks, daysPerWeek,
      equipment: equipment || undefined, limitations: limitations || undefined,
    }).then((r) => r.json()),
    onSuccess: (data: any) => {
      if (data.generationError) {
        toast({ title: "Program created with warnings", description: data.generationError });
      } else {
        toast({ title: "Workout program created!", description: "Your personal program is ready." });
      }
      onCreated();
      onClose();
      setStep(0); setGoal(""); setSport(""); setDurationWeeks(6); setDaysPerWeek(3); setEquipment(""); setLimitations("");
    },
    onError: (err: any) => toast({ title: "Could not generate workout", description: err?.message, variant: "destructive" }),
  });

  function handleClose() {
    if (!generateMutation.isPending) { onClose(); setStep(0); }
  }

  const canNext0 = !!goal;
  const steps = ["Your Goal", "Schedule", "Details"];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" data-testid="dialog-athlete-create-wizard">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Create My Workout
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-1 flex-1">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-4">{steps[step]}</p>

        {/* Step 0 — Goal & Sport */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Training Goal <span className="text-destructive">*</span></Label>
              <Select value={goal} onValueChange={setGoal}>
                <SelectTrigger data-testid="select-wizard-goal">
                  <SelectValue placeholder="Choose a goal…" />
                </SelectTrigger>
                <SelectContent>
                  {GOALS.map((g) => <SelectItem key={g} value={g}>{GOAL_LABELS[g] ?? g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sport / Activity <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                placeholder="e.g. Soccer, Track, General Fitness"
                data-testid="input-wizard-sport"
              />
            </div>
            <Button className="w-full" onClick={() => setStep(1)} disabled={!canNext0} data-testid="button-wizard-next-0">
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 1 — Schedule */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="space-y-3">
              <Label>Program Duration</Label>
              <div className="grid grid-cols-4 gap-2">
                {WIZARD_DURATIONS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setDurationWeeks(w)}
                    data-testid={`button-wizard-duration-${w}`}
                    className={`py-2 rounded-lg text-sm font-medium border transition-colors ${durationWeeks === w ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
                  >
                    {w}wk
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label>Days Per Week</Label>
              <div className="grid grid-cols-5 gap-2">
                {WIZARD_DAYS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDaysPerWeek(d)}
                    data-testid={`button-wizard-days-${d}`}
                    className={`py-2 rounded-lg text-sm font-medium border transition-colors ${daysPerWeek === d ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
                  >
                    {d}x
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1" data-testid="button-wizard-back-1">Back</Button>
              <Button onClick={() => setStep(2)} className="flex-1" data-testid="button-wizard-next-1">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Details & Generate */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Available Equipment <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder="e.g. Barbell, Dumbbells, Bodyweight only"
                data-testid="input-wizard-equipment"
              />
            </div>
            <div className="space-y-2">
              <Label>Limitations / Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                value={limitations}
                onChange={(e) => setLimitations(e.target.value)}
                placeholder="e.g. No jumping, shoulder injury, focus on lower body"
                rows={3}
                data-testid="input-wizard-limitations"
              />
            </div>

            {/* Summary */}
            <Card className="p-3 bg-muted/30 space-y-1 text-sm">
              <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Your Program</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Goal</span><span className="font-medium">{GOAL_LABELS[goal] ?? goal}</span></div>
              {sport && <div className="flex justify-between"><span className="text-muted-foreground">Sport</span><span className="font-medium">{sport}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span className="font-medium">{durationWeeks} weeks</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Frequency</span><span className="font-medium">{daysPerWeek}x / week</span></div>
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={generateMutation.isPending} className="flex-1" data-testid="button-wizard-back-2">Back</Button>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex-1 gap-1.5"
                data-testid="button-wizard-generate"
              >
                {generateMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate</>}
              </Button>
            </div>
            {generateMutation.isPending && (
              <p className="text-xs text-center text-muted-foreground">TrainChat is building your program — this takes about 20–30 seconds.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Athlete View ─────────────────────────────────────────────────────────────
function AthleteWorkoutsView({ orgSlug, orgId, programToolId, trainChatConnected }: {
  orgSlug: string; orgId?: string; programToolId: string; trainChatConnected: boolean;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"assigned" | "personal">("assigned");
  const [showWizard, setShowWizard] = useState(false);

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/my-workouts"],
    queryFn: () =>
      fetch("/api/org/workout-builder/my-workouts", {
        credentials: "include",
        headers: getWbHeaders(orgId),
      }).then((r) => r.json()),
  });

  const finishMutation = useMutation({
    mutationFn: ({ sessionId, finishData }: { sessionId: string; finishData: any }) =>
      apiRequest("POST", `/api/org/workout-execution/session/${sessionId}/finish`, finishData),
    onSuccess: () => { toast({ title: "Session saved! Great work." }); refetch(); },
    onError: () => toast({ title: "Could not save session", variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const { programs = [], personalPrograms = [], sessions = [], completions = [] } = data ?? {};

  const handleFinish = (sessionId: string, finishData: any) => finishMutation.mutate({ sessionId, finishData });

  return (
    <div className="space-y-4" data-testid="view-athlete-workouts">
      {/* Tab switcher */}
      <div className="flex rounded-lg border p-0.5 bg-muted/30 gap-0.5">
        <button
          onClick={() => setTab("assigned")}
          data-testid="tab-assigned-workouts"
          className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${tab === "assigned" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Assigned <span className="ml-1 text-xs opacity-70">({programs.length})</span>
        </button>
        <button
          onClick={() => setTab("personal")}
          data-testid="tab-my-workouts"
          className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${tab === "personal" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          My Workouts <span className="ml-1 text-xs opacity-70">({personalPrograms.length})</span>
        </button>
      </div>

      {/* Assigned tab */}
      {tab === "assigned" && (
        programs.length === 0 ? (
          <Card className="p-10 text-center space-y-3" data-testid="card-no-assigned-workouts">
            <Dumbbell className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="font-semibold">No workouts assigned yet</p>
            <p className="text-sm text-muted-foreground">Your coach will assign programs once they've been generated.</p>
          </Card>
        ) : (
          <AthleteProgramList programs={programs} sessions={sessions} completions={completions} onFinish={handleFinish} orgSlug={orgSlug} />
        )
      )}

      {/* My Workouts tab */}
      {tab === "personal" && (
        <div className="space-y-4">
          {trainChatConnected ? (
            <Button
              onClick={() => setShowWizard(true)}
              className="w-full gap-2"
              data-testid="button-create-my-workout"
            >
              <Sparkles className="h-4 w-4" /> Create My Workout
            </Button>
          ) : (
            <Card className="p-4 flex items-start gap-3 border-amber-500/20 bg-amber-500/5">
              <WifiOff className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">TrainChat Not Connected</p>
                <p className="text-xs text-muted-foreground mt-0.5">Personal workout creation requires TrainChat. Ask your coach to set it up.</p>
              </div>
            </Card>
          )}
          {personalPrograms.length === 0 ? (
            <Card className="p-10 text-center space-y-3" data-testid="card-no-personal-workouts">
              <Wand2 className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">No personal workouts yet</p>
              <p className="text-sm text-muted-foreground">Use "Create My Workout" to generate your own AI-powered program.</p>
            </Card>
          ) : (
            <AthleteProgramList programs={personalPrograms} sessions={sessions} completions={completions} onFinish={handleFinish} orgSlug={orgSlug} />
          )}
        </div>
      )}

      {/* Athlete create wizard */}
      {programToolId && (
        <AthleteCreateWizard
          open={showWizard}
          onClose={() => setShowWizard(false)}
          programToolId={programToolId}
          onCreated={() => { refetch(); setTab("personal"); }}
        />
      )}
    </div>
  );
}

// ─── Execution Monitor (Coach) ─────────────────────────────────────────────────
function ExecutionMonitorTab({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [trainChatRecId, setTrainChatRecId] = useState<string | null>(null);
  const [coachNotes, setCoachNotes] = useState("");
  const [trainChatResult, setTrainChatResult] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/workout-execution/coach-monitor"],
    queryFn: () => fetch("/api/org/workout-execution/coach-monitor").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const updateRecMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/workout-execution/recommendations/${id}`, { status }),
    onSuccess: () => { toast({ title: "Recommendation updated" }); refetch(); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const trainChatMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiRequest("POST", `/api/org/workout-execution/recommendations/${id}/trainchat-review`, { coachNotes: notes || undefined }),
    onSuccess: (data: any) => { setTrainChatResult(data); toast({ title: "TrainChat suggestion ready" }); },
    onError: () => toast({ title: "TrainChat review failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const { summary = {}, athleteStatuses = [], pendingRecs = [] } = data ?? {};

  const FLAG_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
    low_readiness: { label: "Low Readiness", color: "text-amber-400 border-amber-500/30 bg-amber-500/5", icon: Gauge },
    high_soreness: { label: "High Soreness", color: "text-orange-400 border-orange-500/30 bg-orange-500/5", icon: Flame },
    high_fatigue: { label: "High Fatigue", color: "text-red-400 border-red-500/30 bg-red-500/5", icon: BedDouble },
    high_rpe: { label: "High RPE", color: "text-red-400 border-red-500/30 bg-red-500/5", icon: TrendingUp },
    pain_reported: { label: "Pain Reported", color: "text-red-500 border-red-500/40 bg-red-500/10", icon: ShieldAlert },
    incomplete_today: { label: "Incomplete", color: "text-muted-foreground border-border bg-muted/20", icon: ClipboardList },
  };

  const SEV_CONFIG: Record<string, { color: string; label: string }> = {
    info: { color: "bg-blue-500/10 text-blue-400 border-blue-500/20", label: "Info" },
    moderate: { color: "bg-amber-500/10 text-amber-400 border-amber-500/20", label: "Moderate" },
    important: { color: "bg-red-500/10 text-red-400 border-red-500/30", label: "Important" },
  };

  const REC_LABELS: Record<string, string> = {
    modify_session: "Modify Session",
    reduce_volume: "Reduce Volume",
    increase_recovery: "Increase Recovery",
    progress_load: "Progress Load",
    coach_review: "Coach Review Required",
  };

  return (
    <div className="space-y-6" data-testid="view-execution-monitor">
      {/* Summary alert cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Needs Review", value: summary.needsReview ?? 0, color: "border-red-500/20 bg-red-500/5", text: "text-red-400", icon: ShieldAlert },
          { label: "Low Readiness", value: summary.lowReadiness ?? 0, color: "border-amber-500/20 bg-amber-500/5", text: "text-amber-400", icon: Gauge },
          { label: "High Fatigue", value: summary.highFatigue ?? 0, color: "border-orange-500/20 bg-orange-500/5", text: "text-orange-400", icon: BedDouble },
          { label: "Completed Today", value: summary.completedToday ?? 0, color: "border-emerald-500/20 bg-emerald-500/5", text: "text-emerald-400", icon: CheckCircle2 },
        ].map(({ label, value, color, text, icon: Icon }) => (
          <Card key={label} className={`p-4 ${color}`} data-testid={`card-monitor-${label.toLowerCase().replace(/\s/g, "-")}`}>
            <Icon className={`h-5 w-5 ${text} mb-2`} />
            <p className={`text-2xl font-bold ${text}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{summary.totalAthletes ?? 0} athletes assigned · refreshes every 30s</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-monitor">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Athlete status feed */}
      {athleteStatuses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Athlete Status</h3>
          <div className="space-y-2">
            {athleteStatuses.map((a: any) => (
              <Card key={a.athleteId} className="p-3" data-testid={`card-athlete-status-${a.athleteId}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium">{a.name || a.athleteId}</p>
                      {a.completedToday && (
                        <Badge className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Completed today</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {a.flags.map((flag: string) => {
                        const cfg = FLAG_CONFIG[flag];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        return (
                          <Badge key={flag} variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
                            <Icon className="h-3 w-3" /> {cfg.label}
                          </Badge>
                        );
                      })}
                      {a.latestCheckin && (
                        <span className="text-xs text-muted-foreground">
                          Readiness {a.latestCheckin.readinessScore}/10
                          {a.avgRpe !== null && ` · Avg RPE ${a.avgRpe.toFixed(1)}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {athleteStatuses.length === 0 && (
        <Card className="p-8 text-center space-y-2" data-testid="card-no-athletes">
          <Activity className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">No athlete data yet</p>
          <p className="text-xs text-muted-foreground">Data appears when athletes complete sessions with readiness check-ins.</p>
        </Card>
      )}

      {/* Recommendation queue */}
      {pendingRecs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Adaptation Recommendations <Badge variant="outline" className="ml-1 text-xs">{pendingRecs.length}</Badge></h3>
          <div className="space-y-3">
            {pendingRecs.map((rec: any) => {
              const sevCfg = SEV_CONFIG[rec.severity] ?? SEV_CONFIG.info;
              return (
                <Card key={rec.id} className="p-4 space-y-3" data-testid={`card-rec-${rec.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-xs ${sevCfg.color}`}>{sevCfg.label}</Badge>
                        <Badge variant="outline" className="text-xs">{REC_LABELS[rec.recommendationType] ?? rec.recommendationType}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm">{rec.reason}</p>
                      {rec.suggestedChange && Object.keys(rec.suggestedChange).length > 0 && (
                        <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded mt-1">
                          {Object.entries(rec.suggestedChange).filter(([k]) => k !== "flag").map(([k, v]) => (
                            <span key={k} className="mr-3">{k}: <strong>{String(v)}</strong></span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" className="text-xs h-7"
                      onClick={() => updateRecMutation.mutate({ id: rec.id, status: "accepted" })}
                      disabled={updateRecMutation.isPending}
                      data-testid={`button-accept-rec-${rec.id}`}
                    >
                      <Check className="h-3 w-3 mr-1" /> Accept
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7"
                      onClick={() => updateRecMutation.mutate({ id: rec.id, status: "dismissed" })}
                      disabled={updateRecMutation.isPending}
                      data-testid={`button-dismiss-rec-${rec.id}`}
                    >
                      <X className="h-3 w-3 mr-1" /> Dismiss
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1"
                      onClick={() => { setTrainChatRecId(rec.id); setTrainChatResult(null); setCoachNotes(""); }}
                      data-testid={`button-trainchat-rec-${rec.id}`}
                    >
                      <Brain className="h-3 w-3" /> Ask TrainChat
                    </Button>
                  </div>
                  {trainChatRecId === rec.id && (
                    <div className="border-t pt-3 space-y-2">
                      <Textarea
                        rows={2}
                        placeholder="Add coach notes for TrainChat context (optional)..."
                        value={coachNotes}
                        onChange={(e) => setCoachNotes(e.target.value)}
                        className="text-xs"
                        data-testid="input-trainchat-coach-notes"
                      />
                      <Button size="sm" className="w-full text-xs"
                        onClick={() => trainChatMutation.mutate({ id: rec.id, notes: coachNotes })}
                        disabled={trainChatMutation.isPending}
                        data-testid="button-trainchat-submit"
                      >
                        {trainChatMutation.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Asking TrainChat...</> : <><Brain className="h-3 w-3 mr-1" /> Get Modification Suggestions</>}
                      </Button>
                      {trainChatResult && (
                        <div className="bg-primary/5 border border-primary/10 rounded p-3 space-y-1.5">
                          <p className="text-xs font-semibold text-primary flex items-center gap-1"><Brain className="h-3 w-3" /> TrainChat Suggestion</p>
                          <p className="text-xs text-muted-foreground">Review carefully before applying. No changes are made automatically.</p>
                          <pre className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                            {typeof trainChatResult.suggestion === "string"
                              ? trainChatResult.suggestion
                              : JSON.stringify(trainChatResult.suggestion, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {pendingRecs.length === 0 && athleteStatuses.length > 0 && (
        <Card className="p-6 text-center border-emerald-500/20 bg-emerald-500/5">
          <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-emerald-400">No pending recommendations</p>
          <p className="text-xs text-muted-foreground mt-0.5">Athletes are on track. Recommendations appear after sessions are completed with readiness data.</p>
        </Card>
      )}
    </div>
  );
}

// ─── Main WorkoutBuilderPage ──────────────────────────────────────────────────
export default function WorkoutBuilderPage({ program, orgSlug }: { program: any; orgSlug: string }) {
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [coachTab, setCoachTab] = useState<"library" | "monitor">("library");

  const orgId: string | undefined = program?.organizationId;

  const { data: bootstrap, isLoading } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/bootstrap"],
    queryFn: () =>
      fetch("/api/org/workout-builder/bootstrap", {
        credentials: "include",
        headers: getWbHeaders(orgId),
      }).then((r) => r.json()),
  });

  // Execution monitor summary for badge count
  const { data: monitorData } = useQuery<any>({
    queryKey: ["/api/org/workout-execution/coach-monitor"],
    queryFn: () =>
      fetch("/api/org/workout-execution/coach-monitor", {
        credentials: "include",
        headers: getWbHeaders(orgId),
      }).then((r) => r.json()),
    enabled: !!(bootstrap?.canManagePrograms),
    refetchInterval: 60000,
  });

  // Use server-returned capability flags as the source of truth
  const canManagePrograms: boolean = bootstrap?.canManagePrograms ?? false;
  const canCreatePersonalWorkout: boolean = bootstrap?.canCreatePersonalWorkout ?? false;
  const isCoach = canManagePrograms;
  const isGuardian = bootstrap?.effectiveRole === "guardian";
  const isAthlete = canCreatePersonalWorkout || bootstrap?.effectiveRole === "athlete";
  const programs: any[] = bootstrap?.programs ?? [];
  const trainChatConnected: boolean = bootstrap?.trainChatConnected ?? false;
  const connectionMode: "org" | "platform" | "none" = bootstrap?.connectionMode ?? "none";
  const needsReviewCount: number = monitorData?.summary?.needsReview ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Bootstrap failed (e.g. 401 response with message field, no effectiveRole)
  if (!bootstrap || bootstrap.message) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center" data-testid="page-workout-builder-no-role">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">Access not configured</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          {bootstrap?.message ?? "Could not verify your access. Please try refreshing the page."}
        </p>
      </div>
    );
  }

  // Athlete view
  if (isAthlete) {
    return (
      <div className="space-y-4" data-testid="page-workout-builder-athlete">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Dumbbell className="h-5 w-5" /> My Workouts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{program?.name}</p>
          </div>
          {trainChatConnected ? (
            <Badge className="text-xs gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              <Wifi className="h-3 w-3" />
              {connectionMode === "platform" ? "TrainChat Active — Platform Key" : "TrainChat Active"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
              <WifiOff className="h-3 w-3" /> TrainChat Off
            </Badge>
          )}
        </div>
        <AthleteWorkoutsView
          orgSlug={orgSlug}
          orgId={orgId}
          programToolId={program?.id ?? ""}
          trainChatConnected={trainChatConnected}
        />
      </div>
    );
  }

  // Guardian view — read-only, no creation
  if (isGuardian) {
    return (
      <div className="space-y-4" data-testid="page-workout-builder-guardian">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Dumbbell className="h-5 w-5" /> Workouts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{program?.name}</p>
        </div>
        <Card className="p-4 flex items-start gap-3 border-muted">
          <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Read-only view</p>
            <p className="text-xs text-muted-foreground mt-0.5">As a guardian, you can view assigned workouts but cannot create or edit programs.</p>
          </div>
        </Card>
        <AthleteWorkoutsView
          orgSlug={orgSlug}
          orgId={orgId}
          programToolId=""
          trainChatConnected={false}
        />
      </div>
    );
  }

  // team_coach: limited team-scoped builder view (can view assigned workouts)
  if (!isCoach && (bootstrap?.canViewAssignedWorkouts)) {
    return (
      <div className="space-y-4" data-testid="page-workout-builder-team-coach">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Dumbbell className="h-5 w-5" /> Workout Builder</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{program?.name}</p>
        </div>
        <AthleteWorkoutsView
          orgSlug={orgSlug}
          orgId={orgId}
          programToolId={program?.id ?? ""}
          trainChatConnected={trainChatConnected}
        />
      </div>
    );
  }

  // Any other unrecognised role — show permission state
  if (!isCoach) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center" data-testid="page-workout-builder-no-access">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">Access restricted</p>
        <p className="text-sm text-muted-foreground max-w-xs">You don't have permission to access the Workout Builder. Contact your admin.</p>
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
              <Wifi className="h-3 w-3" />
              {connectionMode === "platform" ? "TrainChat Connected — Platform Key" : "TrainChat Connected"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-trainchat-status-off">
              <WifiOff className="h-3 w-3" /> TrainChat Not Connected
            </Badge>
          )}
          {coachTab === "library" && (
            <Button
              size="sm"
              onClick={() => setShowWizard(true)}
              disabled={!trainChatConnected}
              data-testid="button-generate-program-header"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Generate Program
            </Button>
          )}
        </div>
      </div>

      {!trainChatConnected && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">TrainChat not connected</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {bootstrap?.trainChatLastError
                ? bootstrap.trainChatLastError
                : "Go to Options → Advanced → Integrations to connect your TrainChat API key."}
            </p>
          </div>
        </Card>
      )}

      {/* ── Dev-only TrainChat debug card ─────────────────────────────────── */}
      {import.meta.env.DEV && (
        <Card className="p-3 border-dashed border-blue-500/40 bg-blue-500/5 text-xs space-y-1" data-testid="debug-trainchat-status">
          <p className="font-semibold text-blue-500 uppercase tracking-wide">TrainChat Debug (dev only)</p>
          <p><span className="text-muted-foreground">connected:</span> <span className={bootstrap?.trainChatConnected ? "text-emerald-500" : "text-destructive"}>{String(bootstrap?.trainChatConnected ?? false)}</span></p>
          <p><span className="text-muted-foreground">mode:</span> {bootstrap?.connectionMode ?? "—"}</p>
          <p><span className="text-muted-foreground">baseUrl:</span> {bootstrap?.trainChatBaseUrl ?? "(none)"}</p>
          <p><span className="text-muted-foreground">maskedKey:</span> {bootstrap?.maskedKeyPreview ?? "(none)"}</p>
          {bootstrap?.trainChatLastError && (
            <p><span className="text-muted-foreground">error:</span> <span className="text-destructive">{bootstrap.trainChatLastError}</span></p>
          )}
        </Card>
      )}
      {/* ──────────────────────────────────────────────────────────────────── */}

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit" data-testid="tabs-coach-workout-builder">
        <button
          type="button"
          onClick={() => { setCoachTab("library"); setSelectedProgramId(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${coachTab === "library" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-library"
        >
          <ClipboardList className="h-3.5 w-3.5" /> Library
        </button>
        <button
          type="button"
          onClick={() => setCoachTab("monitor")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${coachTab === "monitor" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-execution-monitor"
        >
          <Activity className="h-3.5 w-3.5" /> Execution Monitor
          {needsReviewCount > 0 && (
            <span className="ml-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{needsReviewCount}</span>
          )}
        </button>
      </div>

      <Separator />

      {/* Library tab */}
      {coachTab === "library" && (
        selectedProgramId ? (
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
        )
      )}

      {/* Execution Monitor tab */}
      {coachTab === "monitor" && (
        <ExecutionMonitorTab orgId={bootstrap?.org?.id ?? ""} />
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
