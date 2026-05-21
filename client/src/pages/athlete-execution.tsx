import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, X, ChevronDown, ChevronUp,
  Play, Pause, RotateCcw, Dumbbell, Brain, Target, AlertTriangle,
  TrendingUp, TrendingDown, Clock, Flame, Star, Loader2, Zap,
  Youtube, Volume2, ChevronLeft, ChevronRight, Sparkles, Trophy,
  Heart, BarChart3, Info, RefreshCw, MessageSquare,
} from "lucide-react";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getExecHeaders(orgId?: string): Record<string, string> {
  const h: Record<string, string> = {};
  const bearerToken = localStorage.getItem("authToken");
  if (bearerToken) h["Authorization"] = `Bearer ${bearerToken}`;
  if (orgId) {
    const orgToken = localStorage.getItem(`orgToken_${orgId}`);
    if (orgToken) h["x-org-auth-token"] = orgToken;
  }
  return h;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Exercise {
  name: string;
  sets: string;
  reps: string;
  load: string;
  rpe: string;
  rest: string;
  notes: string;
  category?: string;
  movementPattern?: string;
  coachingCues?: string[];
  commonMistakes?: string[];
  progressions?: string[];
  regressions?: string[];
  youtubeUrl?: string | null;
  videoUrl?: string | null;
  gifUrl?: string | null;
  thumbnailUrl?: string | null;
  demoType?: string;
  _exId?: string | null;
  _groupId?: string | null;
  _groupType?: string | null;
}

interface SetLog {
  setNumber: number;
  actualReps: string;
  actualLoad: string;
  rpe: number;
  completed: boolean;
  notes: string;
}

interface ExerciseLog {
  exerciseName: string;
  sets: SetLog[];
  notes: string;
}

// ─── Extract YouTube embed ID ─────────────────────────────────────────────────
function getYoutubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}?rel=0&modestbranding=1` : null;
}

// ─── Rest Timer Component ─────────────────────────────────────────────────────
function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(true);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = window.setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            setRunning(false);
            clearInterval(intervalRef.current!);
            onDone();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current!);
  }, [running]);

  const pct = ((seconds - remaining) / seconds) * 100;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={() => { setRunning(false); onDone(); }}>
      <div className="text-center space-y-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-neutral-400 text-sm uppercase tracking-widest">Rest Period</p>

        {/* Circular progress */}
        <div className="relative w-40 h-40 mx-auto">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#262626" strokeWidth="6" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="#10b981" strokeWidth="6"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - pct / 100)}`}
              strokeLinecap="round" className="transition-all" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <span className="text-4xl font-bold text-white tabular-nums">
                {mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : secs}
              </span>
              {mins === 0 && <p className="text-xs text-neutral-500 mt-0.5">seconds</p>}
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-center">
          <Button variant="outline" className="border-neutral-700 text-neutral-300 bg-neutral-900"
            onClick={() => setRunning((v) => !v)}>
            {running ? <Pause className="h-4 w-4 mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
            {running ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" className="border-neutral-700 text-neutral-300 bg-neutral-900"
            onClick={() => { setRemaining(seconds); setRunning(true); }}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
          <Button className="bg-emerald-700 hover:bg-emerald-600 text-white" onClick={() => { setRunning(false); onDone(); }}>
            Skip Rest
          </Button>
        </div>

        <p className="text-xs text-neutral-600">Tap outside to skip</p>
      </div>
    </div>
  );
}

// ─── Completion Celebration ───────────────────────────────────────────────────
function SessionCelebration({ streak, totalSessions, onContinue }: { streak: number; totalSessions: number; onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-6">
      <div className="text-center space-y-6 max-w-sm w-full">
        <div className="relative">
          <Trophy className="h-20 w-20 mx-auto text-amber-400" />
          <div className="absolute -top-1 -right-1 flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <Sparkles key={i} className={`h-6 w-6 text-yellow-400 ${i === 1 ? "mt-2" : ""}`} />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">Session Complete!</h2>
          <p className="text-neutral-400 text-sm">Outstanding work. Your body is getting stronger.</p>
        </div>
        {streak > 0 && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 space-y-1">
            <div className="flex items-center justify-center gap-2">
              <Flame className="h-5 w-5 text-amber-400" />
              <span className="text-amber-300 font-bold text-lg">{streak}-Day Streak!</span>
            </div>
            <p className="text-xs text-neutral-400">{totalSessions} sessions completed in total</p>
          </div>
        )}
        <div className="flex gap-3">
          <Button className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white py-3"
            onClick={onContinue} data-testid="btn-celebration-done">
            <Check className="h-5 w-5 mr-2" /> Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Exercise Media Component ─────────────────────────────────────────────────
function ExerciseMedia({ ex }: { ex: Exercise }) {
  const [loaded, setLoaded] = useState(false);
  const youtubeUrl = ex.youtubeUrl ? getYoutubeEmbedUrl(ex.youtubeUrl) : null;

  if (!youtubeUrl && !ex.videoUrl && !ex.gifUrl) return null;

  return (
    <div className="rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 mb-4">
      {youtubeUrl ? (
        <div className="relative" style={{ paddingTop: "56.25%" }}>
          <iframe src={youtubeUrl} className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen loading="lazy" onLoad={() => setLoaded(true)} />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
              <div className="text-center space-y-2">
                <Youtube className="h-10 w-10 text-neutral-600 mx-auto" />
                <p className="text-xs text-neutral-500">Loading demo…</p>
              </div>
            </div>
          )}
        </div>
      ) : ex.gifUrl ? (
        <img src={ex.gifUrl} alt={`${ex.name} demo`} className="w-full max-h-48 object-contain bg-neutral-900" />
      ) : ex.videoUrl ? (
        <video src={ex.videoUrl} controls className="w-full max-h-48 bg-black" playsInline />
      ) : null}
    </div>
  );
}

// ─── Exercise Intelligence Panel ─────────────────────────────────────────────
function IntelPanel({ ex, headers, onRegress, onProgress }: {
  ex: Exercise; headers: Record<string, string>;
  onRegress?: (name: string) => void;
  onProgress?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function handleAsk() {
    if (!aiQuestion || !ex._exId) return;
    setAiLoading(true);
    try {
      const r = await fetch(`/api/org/exercises/${ex._exId}/ask-trainchat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ question: aiQuestion, exerciseName: ex.name }),
      });
      const data = await r.json();
      setAiAnswer(data.answer ?? "No response");
    } catch {
      setAiAnswer("Could not reach AI. Please try again.");
    } finally { setAiLoading(false); }
  }

  const hasCues = (ex.coachingCues?.length ?? 0) > 0;
  const hasMistakes = (ex.commonMistakes?.length ?? 0) > 0;
  const hasProgressions = (ex.progressions?.length ?? 0) > 0;
  const hasRegressions = (ex.regressions?.length ?? 0) > 0;
  const hasMuscles = ex.category || ex.movementPattern;

  if (!hasCues && !hasMistakes && !hasProgressions && !hasRegressions && !hasMuscles && !ex._exId) return null;

  return (
    <div className="border border-neutral-800 rounded-xl overflow-hidden">
      <button className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900 hover:bg-neutral-800 transition-colors"
        onClick={() => setOpen((v) => !v)} data-testid="btn-intel-toggle">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-neutral-200">Exercise Intelligence</span>
          {hasCues && <Badge className="text-xs bg-purple-900/50 text-purple-300 border-purple-700">{ex.coachingCues!.length} cues</Badge>}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
      </button>

      {open && (
        <div className="bg-neutral-950 p-4 space-y-4">
          {/* Muscles / Category */}
          {hasMuscles && (
            <div className="flex flex-wrap gap-2">
              {ex.category && <span className="text-xs px-2 py-1 rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/50">{ex.category}</span>}
              {ex.movementPattern && <span className="text-xs px-2 py-1 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">{ex.movementPattern}</span>}
            </div>
          )}

          {/* Coaching cues */}
          {hasCues && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Check className="h-3 w-3" /> Coaching Cues
              </p>
              <ul className="space-y-1.5">
                {ex.coachingCues!.map((cue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                    <span className="h-5 w-5 rounded-full bg-emerald-900/50 flex items-center justify-center text-[10px] text-emerald-400 font-bold shrink-0 mt-0.5">{i + 1}</span>
                    {cue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Common mistakes */}
          {hasMistakes && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" /> Common Mistakes
              </p>
              <ul className="space-y-1.5">
                {ex.commonMistakes!.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                    <X className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Progressions / Regressions */}
          {(hasProgressions || hasRegressions) && (
            <div className="grid grid-cols-2 gap-3">
              {hasRegressions && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-sky-400 uppercase tracking-wider flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" /> Easier
                  </p>
                  {ex.regressions!.map((r, i) => (
                    <button key={i} onClick={() => onRegress?.(r)}
                      className="w-full text-left text-xs py-1.5 px-2.5 rounded-lg bg-sky-900/20 border border-sky-800/40 text-sky-300 hover:bg-sky-900/40 transition-colors">
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {hasProgressions && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Harder
                  </p>
                  {ex.progressions!.map((p, i) => (
                    <button key={i} onClick={() => onProgress?.(p)}
                      className="w-full text-left text-xs py-1.5 px-2.5 rounded-lg bg-orange-900/20 border border-orange-800/40 text-orange-300 hover:bg-orange-900/40 transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ask TrainChat */}
          {ex._exId && (
            <div className="space-y-2 border-t border-neutral-800 pt-3">
              <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3" /> Ask TrainChat
              </p>
              <div className="flex gap-2">
                <Input value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)}
                  placeholder={`Ask about ${ex.name}…`}
                  className="flex-1 h-8 bg-neutral-900 border-neutral-700 text-white text-xs"
                  onKeyDown={(e) => { if (e.key === "Enter" && aiQuestion) handleAsk(); }} />
                <Button size="sm" className="bg-purple-700 hover:bg-purple-600 text-xs h-8 shrink-0"
                  disabled={!aiQuestion || aiLoading} onClick={handleAsk} data-testid="btn-ask-ai">
                  {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Ask"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["What muscles does this target?", "How do I breathe?", "What's the purpose?"].map((q) => (
                  <button key={q} onClick={() => setAiQuestion(q)}
                    className="text-xs px-2 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-400 hover:border-purple-600 hover:text-purple-300 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
              {aiAnswer && (
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-lg p-3">
                  <p className="text-xs text-neutral-300 leading-relaxed">{aiAnswer}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Set Row Component ────────────────────────────────────────────────────────
function SetRow({
  set, setNum, prescribed, onUpdate, onComplete,
}: {
  set: SetLog; setNum: number; prescribed: { reps: string; load: string; rpe?: string };
  onUpdate: (field: keyof SetLog, val: any) => void;
  onComplete: () => void;
}) {
  return (
    <div className={`rounded-xl border p-3 transition-all ${set.completed ? "border-emerald-600/50 bg-emerald-950/30" : "border-neutral-800 bg-neutral-900"}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={onComplete}
          className={`h-9 w-9 rounded-full border-2 flex items-center justify-center shrink-0 transition-all active:scale-90 ${set.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-600 text-neutral-600 hover:border-emerald-500 hover:text-emerald-400"}`}
          data-testid={`btn-set-complete-${setNum}`}>
          {set.completed ? <Check className="h-4 w-4" /> : <span className="text-sm font-bold">{setNum}</span>}
        </button>

        <div className="grid grid-cols-2 gap-2 flex-1">
          <div>
            <p className="text-[10px] text-neutral-600 mb-0.5">Reps <span className="text-neutral-500">({prescribed.reps || "—"})</span></p>
            <Input value={set.actualReps} onChange={(e) => onUpdate("actualReps", e.target.value)}
              placeholder={prescribed.reps || "reps"}
              className="h-8 bg-neutral-800 border-neutral-700 text-white text-sm px-2"
              data-testid={`input-set-reps-${setNum}`} />
          </div>
          <div>
            <p className="text-[10px] text-neutral-600 mb-0.5">Load <span className="text-neutral-500">({prescribed.load || "—"})</span></p>
            <Input value={set.actualLoad} onChange={(e) => onUpdate("actualLoad", e.target.value)}
              placeholder={prescribed.load || "kg / lbs"}
              className="h-8 bg-neutral-800 border-neutral-700 text-white text-sm px-2"
              data-testid={`input-set-load-${setNum}`} />
          </div>
        </div>

        <div className="shrink-0 w-12 text-center">
          <p className="text-[10px] text-neutral-600 mb-1">RPE</p>
          <span className={`text-sm font-bold ${set.rpe <= 0 ? "text-neutral-600" : set.rpe <= 5 ? "text-emerald-400" : set.rpe <= 7 ? "text-amber-400" : "text-red-400"}`}>
            {set.rpe > 0 ? set.rpe : "—"}
          </span>
        </div>
      </div>

      {/* RPE slider — only show when active */}
      {!set.completed && (
        <div className="mt-2 pt-2 border-t border-neutral-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-neutral-500">RPE {prescribed.rpe ? `(target: ${prescribed.rpe})` : ""}</span>
            <span className={`text-xs font-bold ${set.rpe <= 0 ? "text-neutral-600" : set.rpe <= 5 ? "text-emerald-400" : set.rpe <= 7 ? "text-amber-400" : "text-red-400"}`}>
              {set.rpe > 0 ? `${set.rpe}/10` : "Not set"}
            </span>
          </div>
          <Slider min={0} max={10} step={1} value={[set.rpe]}
            onValueChange={([v]) => onUpdate("rpe", v)} className="w-full" />
        </div>
      )}
    </div>
  );
}

// ─── Exercise Execution Card ───────────────────────────────────────────────────
function ExerciseExecCard({
  ex, exIndex, log, groupLabel, isActive, onUpdateSet, onCompleteSet,
  onDone, onPrev, onNext, headers, restSeconds, isLast, isFirst,
}: {
  ex: Exercise; exIndex: number; log: ExerciseLog; groupLabel?: string;
  isActive: boolean; onUpdateSet: (setIdx: number, field: keyof SetLog, val: any) => void;
  onCompleteSet: (setIdx: number) => void; onDone: (notes: string) => void;
  onPrev: () => void; onNext: () => void; headers: Record<string, string>;
  restSeconds: number; isLast: boolean; isFirst: boolean;
}) {
  const [notes, setNotes] = useState(log.notes ?? "");
  const completedSets = log.sets.filter((s) => s.completed).length;
  const totalSets = log.sets.length;
  const allDone = completedSets === totalSets && totalSets > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Group badge */}
      {groupLabel && (
        <div className="mb-3 flex justify-center">
          <Badge className="text-xs bg-orange-900/40 text-orange-300 border-orange-700/60">{groupLabel}</Badge>
        </div>
      )}

      {/* Exercise name + meta */}
      <div className="mb-3">
        <h2 className="text-xl font-bold text-white leading-tight">{ex.name}</h2>
        <div className="flex flex-wrap gap-2 mt-1.5 items-center">
          {ex.category && <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">{ex.category}</span>}
          <span className="text-sm text-neutral-400">
            {[ex.sets && `${ex.sets} sets`, ex.reps && `${ex.reps} reps`, ex.load && `@ ${ex.load}`, ex.rest && `rest ${ex.rest}`].filter(Boolean).join(" · ")}
          </span>
        </div>
        {ex.notes && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
            <p className="text-xs text-neutral-400">{ex.notes}</p>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2">
        {/* Media */}
        <ExerciseMedia ex={ex} />

        {/* Set tracking */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Sets</p>
            <span className={`text-xs font-medium ${allDone ? "text-emerald-400" : "text-neutral-500"}`}>
              {completedSets}/{totalSets} complete
            </span>
          </div>
          {log.sets.map((set, i) => (
            <SetRow key={i} set={set} setNum={i + 1}
              prescribed={{ reps: ex.reps, load: ex.load, rpe: ex.rpe }}
              onUpdate={(field, val) => onUpdateSet(i, field, val)}
              onComplete={() => onCompleteSet(i)} />
          ))}
        </div>

        {/* Notes */}
        <div>
          <p className="text-xs text-neutral-500 mb-1">Exercise notes (optional)</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="How did it feel? Technique notes…"
            rows={2} className="bg-neutral-900 border-neutral-700 text-white text-sm resize-none" />
        </div>

        {/* Intelligence panel */}
        <IntelPanel ex={ex} headers={headers} />
      </div>

      {/* Navigation footer */}
      <div className="mt-4 pt-3 border-t border-neutral-800 flex gap-3">
        <Button variant="outline" className="border-neutral-700 bg-neutral-900 text-neutral-300"
          onClick={onPrev} disabled={isFirst} data-testid="btn-exec-prev">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          className={`flex-1 font-semibold ${allDone ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"}`}
          onClick={() => { onDone(notes); if (!isLast) onNext(); }}
          data-testid="btn-exec-next">
          {isLast ? (allDone ? <><Check className="h-4 w-4 mr-2" /> Finish Session</> : "Finish Session") : (allDone ? "Next Exercise →" : "Next →")}
        </Button>
      </div>
    </div>
  );
}

// ─── Readiness Check ──────────────────────────────────────────────────────────
function ReadinessCheck({ onStart }: { onStart: (data: any) => void }) {
  const [overall, setOverall] = useState(7);
  const [sleep, setSleep] = useState(7);
  const [soreness, setSoreness] = useState(3);
  const [fatigue, setFatigue] = useState(3);
  const [motivation, setMotivation] = useState(7);
  const [painAreas, setPainAreas] = useState<string[]>([]);

  const PAIN_AREAS = ["Lower Back", "Knees", "Shoulders", "Hips", "Hamstrings", "Quads", "Calves", "Ankles"];

  function slider(label: string, value: number, onChange: (v: number) => void, low: string, high: string, color?: string) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <p className="text-sm text-neutral-300">{label}</p>
          <span className={`text-base font-bold tabular-nums ${value <= 3 ? "text-red-400" : value <= 6 ? "text-amber-400" : "text-emerald-400"}`}>{value}</span>
        </div>
        <Slider min={1} max={10} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
        <div className="flex justify-between text-xs text-neutral-600">
          <span>{low}</span><span>{high}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Pre-Session Check In</h2>
          <p className="text-neutral-400 text-sm mt-1">Tell your coach how you're feeling today.</p>
        </div>
        {slider("Overall Readiness", overall, setOverall, "Not ready", "100%")}
        {slider("Sleep Quality", sleep, setSleep, "Poor", "Great")}
        {slider("Muscle Soreness", soreness, setSoreness, "None", "Very sore")}
        {slider("Fatigue Level", fatigue, setFatigue, "Fresh", "Exhausted")}
        {slider("Motivation", motivation, setMotivation, "Low", "Fired up")}
        <div className="space-y-2">
          <p className="text-sm text-neutral-300">Pain areas? <span className="text-neutral-600">(optional)</span></p>
          <div className="flex flex-wrap gap-2">
            {PAIN_AREAS.map((a) => (
              <button key={a}
                onClick={() => setPainAreas((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a])}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${painAreas.includes(a) ? "bg-red-500/20 border-red-500/50 text-red-300" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="pt-3 border-t border-neutral-800">
        <Button className="w-full bg-emerald-700 hover:bg-emerald-600 text-white py-4 text-base font-semibold"
          onClick={() => onStart({ overall, sleep, soreness, fatigue, motivation, painAreas })}
          data-testid="btn-start-session">
          <Zap className="h-5 w-5 mr-2" /> Start Session
        </Button>
      </div>
    </div>
  );
}

// ─── Session Wrap-Up ──────────────────────────────────────────────────────────
function SessionWrapUp({ exLogs, exercises, readinessData, onSubmit, saving }: {
  exLogs: ExerciseLog[]; exercises: Exercise[]; readinessData: any;
  onSubmit: (notes: string, rating: number) => void; saving: boolean;
}) {
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");

  const totalSets = exLogs.reduce((acc, l) => acc + l.sets.length, 0);
  const completedSets = exLogs.reduce((acc, l) => acc + l.sets.filter((s) => s.completed).length, 0);
  const completedEx = exLogs.filter((l) => l.sets.some((s) => s.completed)).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Session Summary</h2>
          <p className="text-neutral-400 text-sm mt-1">Excellent work! Review your session before saving.</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Exercises", value: `${completedEx}/${exercises.length}` },
            { label: "Sets Done", value: `${completedSets}/${totalSets}` },
            { label: "Readiness", value: `${readinessData?.overall ?? "—"}/10` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-white">{value}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Exercise summary */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Exercise Log</p>
          {exLogs.map((log, i) => {
            const done = log.sets.filter((s) => s.completed).length;
            const total = log.sets.length;
            return (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${done === total && total > 0 ? "border-emerald-800/50 bg-emerald-950/20" : "border-neutral-800 bg-neutral-900"}`}>
                <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${done === total && total > 0 ? "bg-emerald-600" : "bg-neutral-800"}`}>
                  {done === total && total > 0 ? <Check className="h-3.5 w-3.5 text-white" /> : <span className="text-xs text-neutral-400">{done}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 truncate">{log.exerciseName}</p>
                  {log.sets.some((s) => s.actualLoad) && (
                    <p className="text-xs text-neutral-500">
                      {log.sets.filter((s) => s.completed).map((s) => `${s.actualReps ?? "?"}r @ ${s.actualLoad || exercises[i]?.load || "—"}`).join(", ")}
                    </p>
                  )}
                </div>
                <span className="text-xs text-neutral-500">{done}/{total}</span>
              </div>
            );
          })}
        </div>

        {/* Difficulty rating */}
        <div className="space-y-2">
          <p className="text-sm text-neutral-300">Session difficulty</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)}
                className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${n <= rating ? "bg-amber-500/20 border-amber-500/60 text-amber-300" : "border-neutral-700 text-neutral-500 hover:border-neutral-500"}`}>
                {"⭐".repeat(n)}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="text-sm text-neutral-300 mb-1.5">Session notes <span className="text-neutral-600">(optional)</span></p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="How was the session? Feedback for your coach…"
            rows={3} className="bg-neutral-900 border-neutral-700 text-white text-sm" />
        </div>
      </div>

      <div className="pt-3 border-t border-neutral-800">
        <Button className="w-full bg-emerald-700 hover:bg-emerald-600 text-white py-4 text-base font-semibold"
          disabled={saving} onClick={() => onSubmit(notes, rating)}
          data-testid="btn-submit-session">
          {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Trophy className="h-5 w-5 mr-2" />}
          Save Session
        </Button>
      </div>
    </div>
  );
}

// ─── Progress Header ──────────────────────────────────────────────────────────
function ProgressHeader({ current, total, sessionTitle, focus, completedEx }: {
  current: number; total: number; sessionTitle: string; focus: string | null; completedEx: number;
}) {
  const pct = total > 0 ? Math.round((completedEx / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{sessionTitle}</p>
          {focus && <p className="text-xs text-neutral-500 truncate">{focus}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-medium text-neutral-300">{current + 1}/{total}</p>
          <p className="text-xs text-neutral-600">{pct}% done</p>
        </div>
      </div>
      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${i < completedEx ? "bg-emerald-500" : i === current ? "bg-emerald-700" : "bg-neutral-800"}`} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Execution Page ──────────────────────────────────────────────────────
export default function AthleteExecutionPage() {
  const { slug, sessionId } = useParams();
  const [, setLocation] = useLocation();
  function navigate(to: string | number) {
    if (typeof to === "number") { window.history.go(to); } else { setLocation(to); }
  }
  const { toast } = useToast();

  const [phase, setPhase] = useState<"readiness" | "execute" | "wrapup" | "done">("readiness");
  const [currentExIdx, setCurrentExIdx] = useState(0);
  const [readinessData, setReadinessData] = useState<any>(null);
  const [exLogs, setExLogs] = useState<ExerciseLog[]>([]);
  const [showTimer, setShowTimer] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(90);
  const [showCelebration, setShowCelebration] = useState(false);
  const [streak, setStreak] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);

  // Fetch org context from athletic program (via query key on the existing bootstrap)
  const { data: athleticProgram } = useQuery<any>({
    queryKey: ["/api/athletic/programs/by-org-slug", slug],
    queryFn: () => fetch(`/api/athletic/programs/by-org-slug/${slug}/${slug}`).then((r) => r.json()),
    enabled: false,
  });

  // Use org token if available
  const orgId: string = athleticProgram?.organizationId ?? "";
  const headers = getExecHeaders(orgId);

  // Fetch the workout session directly
  const { data: sessionData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/workout-builder/session", sessionId],
    queryFn: () =>
      fetch(`/api/org/workout-builder/session/${sessionId}`, { credentials: "include", headers }).then((r) => r.json()),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const session = sessionData?.session;
  const exercises: Exercise[] = session?.sessionData?.exercises ?? [];
  const groups: any[] = sessionData?.groups ?? [];

  // Initialize exercise logs when session loads
  useEffect(() => {
    if (exercises.length > 0 && exLogs.length === 0) {
      const logs = exercises.map((ex: Exercise) => {
        const numSets = parseInt(ex.sets || "3") || 3;
        return {
          exerciseName: ex.name,
          notes: "",
          sets: Array.from({ length: numSets }, (_, i) => ({
            setNumber: i + 1,
            actualReps: "",
            actualLoad: "",
            rpe: 0,
            completed: false,
            notes: "",
          })),
        };
      });
      setExLogs(logs);
    }
  }, [exercises]);

  // Submit session
  const submitMutation = useMutation({
    mutationFn: (payload: any) =>
      fetch(`/api/org/workout-execution/session/${sessionId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        credentials: "include",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setStreak(data.streak?.currentStreak ?? 0);
      setTotalSessions(data.streak?.totalSessionsCompleted ?? 0);
      setPhase("done");
      setShowCelebration(true);
    },
    onError: () => toast({ title: "Could not save session", variant: "destructive" }),
  });

  function handleStartSession(rd: any) {
    setReadinessData(rd);
    setPhase("execute");
  }

  function updateSet(exIdx: number, setIdx: number, field: keyof SetLog, val: any) {
    setExLogs((prev) => {
      const updated = [...prev];
      const sets = [...updated[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [field]: val };
      updated[exIdx] = { ...updated[exIdx], sets };
      return updated;
    });
  }

  function completeSet(exIdx: number, setIdx: number) {
    setExLogs((prev) => {
      const updated = [...prev];
      const sets = [...updated[exIdx].sets];
      const wasCompleted = sets[setIdx].completed;
      sets[setIdx] = { ...sets[setIdx], completed: !wasCompleted };
      updated[exIdx] = { ...updated[exIdx], sets };
      return updated;
    });

    // Auto-start rest timer when completing a set (not un-completing)
    const wasCompleted = exLogs[exIdx]?.sets[setIdx]?.completed;
    if (!wasCompleted) {
      const ex = exercises[exIdx];
      const restStr = ex?.rest ?? "90s";
      const restSec = parseRestSeconds(restStr);
      if (restSec > 0) {
        setTimerSeconds(restSec);
        // Small delay to not immediately pop the timer
        setTimeout(() => setShowTimer(true), 300);
      }
    }
  }

  function parseRestSeconds(restStr: string): number {
    if (!restStr) return 90;
    const minMatch = restStr.match(/(\d+)\s*min/i);
    const secMatch = restStr.match(/(\d+)\s*s/i);
    if (minMatch) return parseInt(minMatch[1]) * 60;
    if (secMatch) return parseInt(secMatch[1]);
    const plain = parseInt(restStr);
    return isNaN(plain) ? 90 : plain > 20 ? plain : plain * 60;
  }

  function handleExDone(exIdx: number, notes: string) {
    setExLogs((prev) => {
      const updated = [...prev];
      updated[exIdx] = { ...updated[exIdx], notes };
      return updated;
    });
  }

  function getGroupLabel(exIdx: number): string | undefined {
    if (groups.length === 0) return undefined;
    for (const g of groups) {
      const idxs: number[] = g.exerciseIndices ?? [];
      if (idxs.includes(exIdx)) {
        return `${g.groupType === "superset" ? "Superset" : g.groupType === "circuit" ? "Circuit" : g.groupType} · ${g.title ?? ""}`.trim();
      }
    }
    return undefined;
  }

  function completedExCount(): number {
    return exLogs.filter((l) => l.sets.some((s) => s.completed)).length;
  }

  function handleSubmit(notes: string, rating: number) {
    const payload = {
      readinessData,
      exerciseLogs: exLogs.map((log, i) => ({
        exerciseName: log.exerciseName,
        prescribedData: exercises[i],
        setLogs: log.sets,
        notes: log.notes,
      })),
      completionNotes: notes || undefined,
      completionRating: rating > 0 ? rating : undefined,
    };
    submitMutation.mutate(payload);
  }

  function parseRestSeconds(restStr: string): number {
    if (!restStr) return 90;
    const minMatch = restStr.match(/(\d+)\s*min/i);
    const secMatch = restStr.match(/(\d+)\s*s/i);
    if (minMatch) return parseInt(minMatch[1]) * 60;
    if (secMatch) return parseInt(secMatch[1]);
    const plain = parseInt(restStr);
    return isNaN(plain) ? 90 : plain > 20 ? plain : plain * 60;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading || !session) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Dumbbell className="h-10 w-10 mx-auto text-neutral-600 animate-pulse" />
          <p className="text-neutral-500 text-sm">Loading session…</p>
        </div>
      </div>
    );
  }

  const currentEx = exercises[currentExIdx];
  const currentLog = exLogs[currentExIdx];

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col max-w-lg mx-auto">
      {/* Top navigation */}
      <div className="px-4 pt-safe-top pt-4 pb-3 border-b border-neutral-800 flex items-center gap-3 shrink-0">
        <button className="text-neutral-400 hover:text-white" onClick={() => navigate(-1)} data-testid="btn-exec-back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          {phase === "execute" && exercises.length > 0 ? (
            <ProgressHeader
              current={currentExIdx} total={exercises.length}
              sessionTitle={session.title} focus={session.focus}
              completedEx={completedExCount()} />
          ) : (
            <p className="text-sm font-medium text-white">{session.title}</p>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden px-4 pt-4 pb-safe-bottom pb-6">
        {/* ── Readiness ── */}
        {phase === "readiness" && (
          <ReadinessCheck onStart={handleStartSession} />
        )}

        {/* ── Execute ── */}
        {phase === "execute" && currentEx && currentLog && (
          <ExerciseExecCard
            ex={currentEx}
            exIndex={currentExIdx}
            log={currentLog}
            groupLabel={getGroupLabel(currentExIdx)}
            isActive
            onUpdateSet={(setIdx, field, val) => updateSet(currentExIdx, setIdx, field, val)}
            onCompleteSet={(setIdx) => completeSet(currentExIdx, setIdx)}
            onDone={(notes) => handleExDone(currentExIdx, notes)}
            onPrev={() => setCurrentExIdx((p) => Math.max(0, p - 1))}
            onNext={() => {
              if (currentExIdx < exercises.length - 1) {
                setCurrentExIdx((p) => p + 1);
              } else {
                setPhase("wrapup");
              }
            }}
            headers={headers}
            restSeconds={parseRestSeconds(currentEx.rest ?? "90s")}
            isFirst={currentExIdx === 0}
            isLast={currentExIdx === exercises.length - 1}
          />
        )}

        {/* ── Wrapup ── */}
        {phase === "wrapup" && (
          <SessionWrapUp
            exLogs={exLogs}
            exercises={exercises}
            readinessData={readinessData}
            onSubmit={handleSubmit}
            saving={submitMutation.isPending}
          />
        )}

        {/* ── If no exercises ── */}
        {phase === "execute" && exercises.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-center space-y-4">
            <div>
              <Dumbbell className="h-12 w-12 mx-auto text-neutral-700 mb-3" />
              <p className="text-neutral-400">No exercises in this session.</p>
              <Button className="mt-4 bg-neutral-800 border border-neutral-700" onClick={() => setPhase("wrapup")}>
                Go to Summary
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Rest timer overlay */}
      {showTimer && (
        <RestTimer seconds={timerSeconds} onDone={() => setShowTimer(false)} />
      )}

      {/* Completion celebration */}
      {showCelebration && phase === "done" && (
        <SessionCelebration
          streak={streak}
          totalSessions={totalSessions}
          onContinue={() => { setShowCelebration(false); navigate(-1); }}
        />
      )}
    </div>
  );
}
