import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { OrgSidebar } from "@/components/OrgSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dumbbell, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Loader2, Save, Sparkles, BookOpen, Copy, Edit3, X, Search,
  Youtube, Link2, Brain, ArrowLeft, Check, Layers, Zap, RefreshCw,
  ChevronRight, Clock, Target,
} from "lucide-react";

// ─── Auth header helper ───────────────────────────────────────────────────────
function getBuilderHeaders(orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const bearerToken = localStorage.getItem("authToken");
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
  if (orgId) {
    const orgToken = localStorage.getItem(`orgToken_${orgId}`);
    if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
  }
  return headers;
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
  youtubeUrl?: string | null;
  _exId?: string | null;
}

interface Session {
  id: string;
  weekNumber: number;
  dayNumber: number;
  title: string;
  focus: string | null;
  sessionData: { exercises: Exercise[]; notes?: string } | null;
  groups?: any[];
}

interface Week {
  weekNumber: number;
  title: string;
  description: string | null;
  blockType: string;
  sessions: Session[];
}

interface LibraryExercise {
  id: string;
  name: string;
  category: string;
  movementPattern: string | null;
  difficulty: string | null;
  primaryMuscles: string[];
  equipment: string[];
  coachingCues: string[];
  youtubeUrl: string | null;
  tags: string[];
}

// ─── Category colors ──────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  strength: "bg-blue-900/40 text-blue-300 border-blue-700",
  power: "bg-orange-900/40 text-orange-300 border-orange-700",
  speed: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
  plyometric: "bg-red-900/40 text-red-300 border-red-700",
  core: "bg-purple-900/40 text-purple-300 border-purple-700",
  conditioning: "bg-green-900/40 text-green-300 border-green-700",
  mobility: "bg-teal-900/40 text-teal-300 border-teal-700",
  recovery: "bg-neutral-800 text-neutral-300 border-neutral-600",
};

function CatBadge({ cat }: { cat?: string }) {
  const c = cat ?? "strength";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${CAT_COLORS[c] ?? "bg-neutral-800 text-neutral-300 border-neutral-700"}`}>
      {c}
    </span>
  );
}

// ─── Inline-editable field ────────────────────────────────────────────────────
function InlineField({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="h-7 bg-neutral-800 border-neutral-700 text-white text-xs px-2" />
    </div>
  );
}

// ─── Exercise Card ─────────────────────────────────────────────────────────────
function ExerciseCard({
  ex, index, sessionId, orgId, headers, onUpdate, onDelete, onMoveUp, onMoveDown,
  isDragging, onDragStart, onDragOver, onDrop,
}: {
  ex: Exercise; index: number; sessionId: string; orgId: string; headers: Record<string, string>;
  onUpdate: (idx: number, field: string, val: string) => void;
  onDelete: (idx: number) => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(ex.youtubeUrl ?? "");
  const [savingMedia, setSavingMedia] = useState(false);
  const { toast } = useToast();

  async function saveMedia() {
    if (!ex._exId) return;
    setSavingMedia(true);
    try {
      const r = await fetch(`/api/org/exercises/${ex._exId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        credentials: "include",
        body: JSON.stringify({ youtubeUrl: youtubeUrl || null, demoType: youtubeUrl ? "youtube" : undefined }),
      });
      if (r.ok) {
        onUpdate(index, "youtubeUrl", youtubeUrl);
        toast({ title: "Media saved" });
        setShowMedia(false);
      } else {
        toast({ title: "Failed to save media", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error saving media", variant: "destructive" });
    } finally { setSavingMedia(false); }
  }

  const hasCues = (ex.coachingCues?.length ?? 0) > 0;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      className={`bg-neutral-900 border rounded-lg transition-all ${isDragging ? "opacity-40 border-emerald-500" : "border-neutral-700 hover:border-neutral-500"}`}
      data-testid={`exercise-card-${index}`}
    >
      <div className="flex items-center gap-2 p-3">
        {/* Drag handle */}
        <div className="cursor-grab active:cursor-grabbing text-neutral-600 hover:text-neutral-400 shrink-0">
          <GripVertical className="h-4 w-4" />
        </div>

        {/* Exercise content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="font-medium text-sm text-white truncate">{ex.name}</span>
            <CatBadge cat={ex.category} />
            {ex.youtubeUrl ? (
              <button onClick={() => setShowMedia((v) => !v)} className="text-red-400 hover:text-red-300" title="YouTube demo attached">
                <Youtube className="h-3.5 w-3.5" />
              </button>
            ) : ex._exId ? (
              <button onClick={() => setShowMedia((v) => !v)} className="text-neutral-600 hover:text-neutral-400" title="Add demo media">
                <Youtube className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <InlineField label="Sets" value={ex.sets} onChange={(v) => onUpdate(index, "sets", v)} />
            <InlineField label="Reps" value={ex.reps} onChange={(v) => onUpdate(index, "reps", v)} />
            <InlineField label="Load" value={ex.load} onChange={(v) => onUpdate(index, "load", v)} placeholder="e.g. 70kg" />
            <InlineField label="RPE" value={ex.rpe} onChange={(v) => onUpdate(index, "rpe", v)} placeholder="1-10" />
            <InlineField label="Rest" value={ex.rest} onChange={(v) => onUpdate(index, "rest", v)} placeholder="90s" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Notes</span>
              <Input value={ex.notes} onChange={(e) => onUpdate(index, "notes", e.target.value)}
                placeholder="Coaching note"
                className="h-7 bg-neutral-800 border-neutral-700 text-white text-xs px-2" />
            </div>
          </div>

          {/* Coach media management */}
          {showMedia && ex._exId && (
            <div className="mt-2 pt-2 border-t border-neutral-800 space-y-2">
              <p className="text-xs text-neutral-400 font-medium flex items-center gap-1.5">
                <Youtube className="h-3 w-3 text-red-400" /> Demo Media
              </p>
              <div className="flex gap-2">
                <Input
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="YouTube URL (e.g. https://youtube.com/watch?v=...)"
                  className="flex-1 h-7 bg-neutral-800 border-neutral-700 text-white text-xs"
                  data-testid={`input-youtube-url-${index}`}
                />
                <Button size="sm" className="h-7 bg-emerald-700 hover:bg-emerald-600 text-xs"
                  disabled={savingMedia} onClick={saveMedia}>
                  {savingMedia ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
              </div>
              <p className="text-xs text-neutral-600">Athletes will see an embedded demo on their execution screen.</p>
            </div>
          )}

          {/* Coaching cues */}
          {expanded && hasCues && (
            <div className="mt-2 pt-2 border-t border-neutral-800">
              <p className="text-xs text-neutral-500 mb-1">Coaching Cues:</p>
              <ul className="space-y-0.5">
                {ex.coachingCues!.map((cue, i) => (
                  <li key={i} className="text-xs text-neutral-300 flex items-start gap-1.5">
                    <Check className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                    {cue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-neutral-500 hover:text-neutral-300"
            onClick={() => onMoveUp(index)} data-testid={`btn-move-up-${index}`}>
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-neutral-500 hover:text-neutral-300"
            onClick={() => onMoveDown(index)} data-testid={`btn-move-down-${index}`}>
            <ChevronDown className="h-3 w-3" />
          </Button>
          {hasCues && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-neutral-400 hover:text-neutral-200"
              onClick={() => setExpanded((v) => !v)} data-testid={`btn-expand-${index}`}>
              <BookOpen className="h-3 w-3" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500/60 hover:text-red-400"
            onClick={() => onDelete(index)} data-testid={`btn-delete-ex-${index}`}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Session Panel ─────────────────────────────────────────────────────────────
function SessionPanel({
  session, orgId, headers, onAddExercise, onSessionUpdated,
}: {
  session: Session; orgId: string; headers: Record<string, string>;
  onAddExercise: () => void;
  onSessionUpdated: () => void;
}) {
  const { toast } = useToast();
  const [exercises, setExercises] = useState<Exercise[]>(() => session.sessionData?.exercises ?? []);
  const [title, setTitle] = useState(session.title);
  const [focus, setFocus] = useState(session.focus ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ exercises: Exercise[]; summary: string } | null>(null);
  const dragIdx = useRef<number | null>(null);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  function handleUpdateEx(idx: number, field: string, val: string) {
    setExercises((prev) => prev.map((ex, i) => i === idx ? { ...ex, [field]: val } : ex));
    setDirty(true);
  }

  function handleDeleteEx(idx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    setExercises((prev) => { const a = [...prev]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; return a; });
    setDirty(true);
  }

  function handleMoveDown(idx: number) {
    setExercises((prev) => {
      if (idx >= prev.length - 1) return prev;
      const a = [...prev]; [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a;
    });
    setDirty(true);
  }

  function handleDragStart(_e: React.DragEvent, idx: number) { dragIdx.current = idx; }
  function handleDragOver(e: React.DragEvent, _idx: number) { e.preventDefault(); }
  function handleDrop(_e: React.DragEvent, toIdx: number) {
    if (dragIdx.current === null || dragIdx.current === toIdx) return;
    const arr = [...exercises];
    const [moved] = arr.splice(dragIdx.current, 1);
    arr.splice(toIdx, 0, moved);
    setExercises(arr);
    setDirty(true);
    dragIdx.current = null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/org/workout-builder/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ title, focus, sessionData: { ...session.sessionData, exercises } }),
      });
      setDirty(false);
      toast({ title: "Saved", description: `${title} updated.` });
      onSessionUpdated();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleAIRefine() {
    setAiLoading(true);
    try {
      const r = await fetch("/api/org/workout-builder/refine-with-trainchat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ sessionId: session.id, instruction: aiInstruction, currentExercises: exercises }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setAiPreview({ exercises: data.exercises, summary: data.summary });
    } catch {
      toast({ title: "AI refinement failed", variant: "destructive" });
    } finally { setAiLoading(false); }
  }

  function applyAIPreview() {
    if (!aiPreview) return;
    setExercises(aiPreview.exercises);
    setAiPreview(null);
    setShowAI(false);
    setAiInstruction("");
    setDirty(true);
  }

  return (
    <div className="space-y-3">
      {/* Session header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-neutral-400">Session Title</Label>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              className="h-8 bg-neutral-800 border-neutral-700 text-white text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-neutral-400">Focus / Theme</Label>
            <Input value={focus} onChange={(e) => { setFocus(e.target.value); setDirty(true); }}
              placeholder="e.g. Lower Body Power" className="h-8 bg-neutral-800 border-neutral-700 text-white text-sm mt-1" />
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" className="border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-purple-900/30 text-xs"
            onClick={() => setShowAI((v) => !v)} data-testid="btn-ai-refine">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Refine with AI
          </Button>
          <Button size="sm" variant="outline" className="border-neutral-700 bg-neutral-800 text-neutral-300 text-xs"
            onClick={onAddExercise} data-testid="btn-add-exercise">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Exercise
          </Button>
          {dirty && (
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs"
              onClick={handleSave} disabled={saving} data-testid="btn-save-session">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
          )}
        </div>
      </div>

      {/* AI Refine Panel */}
      {showAI && (
        <div className="bg-purple-900/20 border border-purple-700/50 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-purple-300 flex items-center gap-2">
            <Brain className="h-4 w-4" /> Refine with TrainChat AI
          </p>
          <p className="text-xs text-neutral-400">Tell the AI how to adjust this session. It will preview changes before you apply them.</p>
          <div className="flex gap-2">
            <Input value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)}
              placeholder='e.g. "Increase power emphasis" or "Swap to dumbbell-only"'
              className="flex-1 bg-neutral-800 border-neutral-700 text-white text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && aiInstruction) handleAIRefine(); }} />
            <Button className="bg-purple-700 hover:bg-purple-600 text-white text-sm"
              disabled={!aiInstruction || aiLoading} onClick={handleAIRefine} data-testid="btn-ai-submit">
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refine"}
            </Button>
            <Button variant="ghost" className="text-neutral-400" onClick={() => { setShowAI(false); setAiPreview(null); }}><X className="h-4 w-4" /></Button>
          </div>
          {/* Example prompts */}
          <div className="flex flex-wrap gap-2">
            {["Increase power emphasis", "Add speed work", "Reduce lower body volume", "Swap to bodyweight-only", "Add a superset", "Increase rest periods"].map((p) => (
              <button key={p} onClick={() => setAiInstruction(p)}
                className="text-xs px-2 py-1 rounded bg-purple-900/40 border border-purple-700/50 text-purple-300 hover:bg-purple-800/40 transition-colors">
                {p}
              </button>
            ))}
          </div>
          {aiPreview && (
            <div className="bg-neutral-900 border border-emerald-700/50 rounded-lg p-3 space-y-3">
              <p className="text-sm text-emerald-400 font-medium">AI Preview — {aiPreview.summary}</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {aiPreview.exercises.map((ex, i) => (
                  <div key={i} className="text-xs text-neutral-300 flex items-center gap-2 py-1 border-b border-neutral-800 last:border-0">
                    <span className="font-medium">{ex.name}</span>
                    <span className="text-neutral-500">{ex.sets}×{ex.reps}</span>
                    {ex.load && <span className="text-neutral-500">@ {ex.load}</span>}
                    {ex.rpe && <span className="text-neutral-600">RPE {ex.rpe}</span>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={applyAIPreview} data-testid="btn-apply-ai">Apply Changes</Button>
                <Button size="sm" variant="outline" className="border-neutral-700 text-xs" onClick={() => setAiPreview(null)}>Discard</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exercise list */}
      {exercises.length === 0 ? (
        <div className="border border-dashed border-neutral-700 rounded-lg py-10 text-center">
          <Dumbbell className="h-8 w-8 mx-auto text-neutral-600 mb-2" />
          <p className="text-neutral-500 text-sm">No exercises yet</p>
          <p className="text-neutral-600 text-xs mt-1">Add from the library or type a quick add below</p>
          <Button size="sm" className="mt-3 bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 text-xs"
            onClick={onAddExercise} data-testid="btn-add-first-exercise">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Exercise
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {exercises.map((ex, i) => (
            <ExerciseCard key={i} ex={ex} index={i} sessionId={session.id} orgId={orgId} headers={headers}
              onUpdate={handleUpdateEx} onDelete={handleDeleteEx}
              onMoveUp={handleMoveUp} onMoveDown={handleMoveDown}
              isDragging={dragIdx.current === i}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Exercise Library Panel ───────────────────────────────────────────────────
function ExerciseLibraryPanel({
  headers, onSelect, onClose,
}: {
  headers: Record<string, string>;
  onSelect: (ex: LibraryExercise) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("strength");
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);

  const { data, isLoading, refetch } = useQuery<{ exercises: LibraryExercise[] }>({
    queryKey: ["/api/org/exercises", q, category, difficulty],
    queryFn: () =>
      fetchJson(`/api/org/exercises?${params.toString()}`, { headers }),
    staleTime: 30_000,
  });

  async function handleCreateExercise() {
    if (!newName) return;
    setCreating(true);
    try {
      await fetch("/api/org/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: newName, category: newCat }),
      });
      toast({ title: "Exercise created" });
      setNewName(""); setShowCreate(false);
      refetch();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally { setCreating(false); }
  }

  const exercises = data?.exercises ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-neutral-800">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-emerald-400" /> Exercise Library
        </h3>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-neutral-400" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-2 border-b border-neutral-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search exercises…"
            className="pl-8 h-8 bg-neutral-800 border-neutral-700 text-white text-sm" />
        </div>
        <div className="flex gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 bg-neutral-800 border-neutral-700 text-neutral-300 text-xs flex-1">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent className="bg-neutral-900 border-neutral-700">
              <SelectItem value="" className="text-neutral-300 text-xs">All categories</SelectItem>
              {["strength", "power", "speed", "plyometric", "core", "conditioning", "mobility", "recovery"].map((c) => (
                <SelectItem key={c} value={c} className="text-neutral-300 text-xs capitalize">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="h-7 bg-neutral-800 border-neutral-700 text-neutral-300 text-xs flex-1">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent className="bg-neutral-900 border-neutral-700">
              <SelectItem value="" className="text-neutral-300 text-xs">All levels</SelectItem>
              {["beginner", "intermediate", "advanced"].map((d) => (
                <SelectItem key={d} value={d} className="text-neutral-300 text-xs capitalize">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : exercises.length === 0 ? (
          <div className="text-center py-10 text-neutral-500 text-sm">No exercises found</div>
        ) : (
          exercises.map((ex) => (
            <button key={ex.id} onClick={() => onSelect(ex)}
              className="w-full text-left p-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 transition-colors group"
              data-testid={`lib-ex-${ex.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{ex.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <CatBadge cat={ex.category} />
                    {ex.movementPattern && <span className="text-xs text-neutral-500">{ex.movementPattern}</span>}
                    {ex.difficulty && <span className="text-xs text-neutral-600 capitalize">{ex.difficulty}</span>}
                  </div>
                </div>
                <Plus className="h-4 w-4 text-emerald-400 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
              </div>
            </button>
          ))
        )}
      </div>

      <div className="p-3 border-t border-neutral-800">
        {!showCreate ? (
          <Button size="sm" variant="outline" className="w-full border-neutral-700 bg-neutral-800 text-neutral-300 text-xs"
            onClick={() => setShowCreate(true)} data-testid="btn-create-exercise">
            <Plus className="h-3.5 w-3.5 mr-1" /> Create Custom Exercise
          </Button>
        ) : (
          <div className="space-y-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Exercise name" className="h-8 bg-neutral-800 border-neutral-700 text-white text-sm" />
            <Select value={newCat} onValueChange={setNewCat}>
              <SelectTrigger className="h-8 bg-neutral-800 border-neutral-700 text-neutral-300 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-neutral-900 border-neutral-700">
                {["strength", "power", "speed", "plyometric", "core", "conditioning", "mobility", "recovery"].map((c) => (
                  <SelectItem key={c} value={c} className="text-neutral-300 capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-xs"
                disabled={!newName || creating} onClick={handleCreateExercise}>
                {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
              </Button>
              <Button size="sm" variant="ghost" className="text-neutral-400 text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Save Template Modal ──────────────────────────────────────────────────────
function SaveTemplateModal({ programId, headers, orgId }: { programId: string; headers: Record<string, string>; orgId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [sport, setSport] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title) return;
    setSaving(true);
    try {
      await fetch("/api/org/program-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ title, category, sport, visibility: "org", programId }),
      });
      toast({ title: "Template saved", description: `"${title}" saved to your org templates.` });
      setOpen(false); setTitle(""); setCategory(""); setSport("");
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 text-xs" data-testid="btn-save-template">
          <Save className="h-3.5 w-3.5 mr-1.5" /> Save as Template
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-neutral-300 text-sm">Template Name *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 8-Week In-Season Strength Block"
              className="bg-neutral-800 border-neutral-600 text-white mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-neutral-300 text-sm">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-neutral-800 border-neutral-600 text-neutral-300 mt-1">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-900 border-neutral-700">
                  {["off-season", "in-season", "speed", "hypertrophy", "return-to-play", "conditioning"].map((c) => (
                    <SelectItem key={c} value={c} className="text-neutral-300">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-neutral-300 text-sm">Sport</Label>
              <Input value={sport} onChange={(e) => setSport(e.target.value)}
                placeholder="e.g. Football"
                className="bg-neutral-800 border-neutral-600 text-white mt-1" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-neutral-700" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1 bg-emerald-700 hover:bg-emerald-600" disabled={!title || saving} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Template"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProgramBuilderPage() {
  const { slug, programSlug } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  const [newSessionWeek, setNewSessionWeek] = useState<number>(1);
  const [newSessionDay, setNewSessionDay] = useState<number>(1);

  // Step 1: Get athletic program (org source of truth — has organizationId)
  const { data: athleticProgram, isLoading: athleticLoading } = useQuery<any>({
    queryKey: ["/api/athletic/programs/by-org-slug", slug, programSlug],
    queryFn: () => fetchJson(`/api/athletic/programs/by-org-slug/${slug}/${programSlug}`),
    enabled: !!slug && !!programSlug,
    staleTime: 60_000,
  });

  // Derive orgId and headers from the athletic program
  const orgId: string = athleticProgram?.organizationId ?? "";
  const headers = getBuilderHeaders(orgId);

  // Step 2: Find the workout program linked to this athletic program tool
  const { data: wbBootstrap } = useQuery<{ programs: any[] }>({
    queryKey: ["/api/org/workout-builder/bootstrap", orgId],
    queryFn: () => fetchJson("/api/org/workout-builder/bootstrap", { headers }),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Filter to programs belonging to this specific athletic program tool
  const athleticProgramId = athleticProgram?.id ?? null;
  const matchedPrograms = (wbBootstrap?.programs ?? []).filter((p: any) => p.programToolId === athleticProgramId);
  const workoutProgram = matchedPrograms[0] ?? wbBootstrap?.programs?.[0] ?? null;
  const programId = workoutProgram?.id ?? null;

  const { data: builderData, isLoading, refetch } = useQuery<{ program: any; weeks: Week[] }>({
    queryKey: ["/api/org/workout-builder/programs", programId, "sessions"],
    queryFn: () =>
      fetchJson(`/api/org/workout-builder/programs/${programId}/sessions`, { headers }),
    enabled: !!programId,
    staleTime: 10_000,
  });

  const weeks = builderData?.weeks ?? [];
  const program = builderData?.program ?? workoutProgram;

  // Add exercise to selected session
  async function handleAddExerciseFromLibrary(ex: LibraryExercise) {
    if (!selectedSession) { toast({ title: "Select a session first" }); return; }
    try {
      await fetch(`/api/org/workout-builder/sessions/${selectedSession.id}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          name: ex.name, sets: "3", reps: "8", load: "", rpe: "", rest: "90s", notes: "",
          category: ex.category, movementPattern: ex.movementPattern,
          coachingCues: ex.coachingCues, youtubeUrl: ex.youtubeUrl, id: ex.id,
        }),
      });
      toast({ title: `${ex.name} added`, description: `Added to ${selectedSession.title}` });
      refetch();
    } catch {
      toast({ title: "Failed to add exercise", variant: "destructive" });
    }
  }

  // Create new session
  async function handleCreateSession() {
    if (!programId) return;
    setAddingSession(true);
    try {
      await fetch("/api/org/workout-builder/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ workoutProgramId: programId, weekNumber: newSessionWeek, dayNumber: newSessionDay, title: `Week ${newSessionWeek} Day ${newSessionDay}` }),
      });
      toast({ title: "Session created" });
      refetch();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally { setAddingSession(false); }
  }

  // Duplicate session
  async function handleDuplicateSession(session: Session) {
    try {
      await fetch(`/api/org/workout-builder/sessions/${session.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({}),
      });
      toast({ title: "Session duplicated" });
      refetch();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  // Delete session
  async function handleDeleteSession(session: Session) {
    if (!confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    try {
      await fetch(`/api/org/workout-builder/sessions/${session.id}`, {
        method: "DELETE", headers,
      });
      if (selectedSession?.id === session.id) setSelectedSession(null);
      toast({ title: "Session deleted" });
      refetch();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  if (!programId && !isLoading && !athleticLoading && orgId) {
    return (
      <SidebarProvider>
        <div className="flex h-screen bg-neutral-950 text-white w-full overflow-hidden">
          <OrgSidebar orgSlug={slug!} />
          <main className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <Dumbbell className="h-12 w-12 mx-auto text-neutral-600" />
              <h2 className="text-xl font-semibold text-neutral-300">No Program Found</h2>
              <p className="text-neutral-500 text-sm">Generate a program with TrainChat first, then open the builder.</p>
              <Button variant="outline" className="border-neutral-700 bg-neutral-800 text-neutral-300"
                onClick={() => navigate(`/org/${slug}/programs/${programSlug}`)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Program
              </Button>
            </div>
          </main>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-neutral-950 text-white w-full overflow-hidden">
        <OrgSidebar orgSlug={slug!} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="h-14 border-b border-neutral-800 bg-neutral-950 flex items-center px-4 gap-3 shrink-0">
            <Button size="sm" variant="ghost" className="text-neutral-400 hover:text-white"
              onClick={() => navigate(`/org/${slug}/programs/${programSlug}`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="h-4 w-px bg-neutral-800" />
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold text-white truncate">
                {program?.title ?? "Program Builder"}
              </h1>
              {program && (
                <p className="text-xs text-neutral-500">{program.durationWeeks}w · {program.daysPerWeek}d/wk · {program.goal}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {programId && <SaveTemplateModal programId={programId} headers={headers} orgId={orgId} />}
              <Button size="sm" variant="outline"
                className="border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 text-xs"
                onClick={() => refetch()} data-testid="btn-refresh-builder">
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
              </Button>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 flex overflow-hidden">

            {/* Left panel: Week & Session list */}
            <div className="w-72 border-r border-neutral-800 bg-neutral-950 flex flex-col overflow-hidden shrink-0">
              <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Weeks & Sessions</h2>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-neutral-400 hover:text-white" data-testid="btn-add-session">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-sm">
                    <DialogHeader><DialogTitle>Add Session</DialogTitle></DialogHeader>
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-neutral-300 text-sm">Week #</Label>
                          <Input type="number" min={1} value={newSessionWeek}
                            onChange={(e) => setNewSessionWeek(parseInt(e.target.value) || 1)}
                            className="bg-neutral-800 border-neutral-600 text-white mt-1" />
                        </div>
                        <div>
                          <Label className="text-neutral-300 text-sm">Day #</Label>
                          <Input type="number" min={1} value={newSessionDay}
                            onChange={(e) => setNewSessionDay(parseInt(e.target.value) || 1)}
                            className="bg-neutral-800 border-neutral-600 text-white mt-1" />
                        </div>
                      </div>
                      <Button className="w-full bg-emerald-700 hover:bg-emerald-600"
                        disabled={addingSession} onClick={handleCreateSession}>
                        {addingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Session"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                  </div>
                ) : weeks.length === 0 ? (
                  <div className="text-center py-10 text-neutral-600 text-xs px-4">
                    <p>No sessions yet.</p>
                    <p className="mt-1">Generate a program or add sessions manually.</p>
                  </div>
                ) : (
                  weeks.map((week) => (
                    <div key={week.weekNumber}>
                      {/* Week header */}
                      <button
                        className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-900 transition-colors ${selectedWeek === week.weekNumber ? "bg-neutral-900" : ""}`}
                        onClick={() => setSelectedWeek((prev) => prev === week.weekNumber ? null : week.weekNumber)}
                        data-testid={`week-header-${week.weekNumber}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-neutral-300">{week.title}</span>
                          <span className="text-xs text-neutral-600">{week.sessions.length}d</span>
                        </div>
                        {selectedWeek === week.weekNumber ? <ChevronDown className="h-3 w-3 text-neutral-500" /> : <ChevronRight className="h-3 w-3 text-neutral-500" />}
                      </button>

                      {/* Sessions under this week */}
                      {(selectedWeek === null || selectedWeek === week.weekNumber) && week.sessions.map((session) => (
                        <div key={session.id}
                          className={`flex items-center group px-3 py-2 border-l-2 ml-2 cursor-pointer transition-colors ${selectedSession?.id === session.id ? "border-emerald-500 bg-emerald-900/10" : "border-transparent hover:border-neutral-600 hover:bg-neutral-900"}`}
                          onClick={() => { setSelectedSession(session); setSelectedWeek(session.weekNumber); }}
                          data-testid={`session-item-${session.id}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-neutral-300 truncate">{session.title}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {session.focus && <span className="text-xs text-neutral-500 truncate">{session.focus}</span>}
                              <span className="text-xs text-neutral-600 shrink-0">{session.sessionData?.exercises?.length ?? 0} ex</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-neutral-500 hover:text-neutral-300"
                              onClick={(e) => { e.stopPropagation(); handleDuplicateSession(session); }}
                              data-testid={`btn-dup-session-${session.id}`}>
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-neutral-500 hover:text-red-400"
                              onClick={(e) => { e.stopPropagation(); handleDeleteSession(session); }}
                              data-testid={`btn-del-session-${session.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Center: Session editor */}
            <div className="flex-1 overflow-y-auto p-4">
              {!selectedSession ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                  <Layers className="h-12 w-12 text-neutral-700" />
                  <h2 className="text-lg font-semibold text-neutral-400">Select a Session</h2>
                  <p className="text-neutral-600 text-sm max-w-sm">
                    Choose a session from the left panel to start editing exercises.
                    Drag to reorder, inline-edit sets/reps/load, and use AI to refine the session.
                  </p>
                  {weeks.length === 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-neutral-600 text-xs">No sessions yet — generate a program with TrainChat or add sessions manually.</p>
                      <Button variant="outline" className="border-neutral-700 bg-neutral-800 text-neutral-300"
                        onClick={() => navigate(`/org/${slug}/programs/${programSlug}`)}>
                        <Zap className="h-4 w-4 mr-2" /> Open TrainChat
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-4">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span>Week {selectedSession.weekNumber}</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="text-neutral-300">{selectedSession.title}</span>
                    {selectedSession.focus && (
                      <>
                        <ChevronRight className="h-3 w-3" />
                        <span className="text-neutral-500">{selectedSession.focus}</span>
                      </>
                    )}
                  </div>
                  <SessionPanel
                    key={selectedSession.id}
                    session={selectedSession}
                    orgId={orgId}
                    headers={headers}
                    onAddExercise={() => setShowLibrary(true)}
                    onSessionUpdated={refetch}
                  />
                </div>
              )}
            </div>

            {/* Right: Exercise Library */}
            {showLibrary && (
              <div className="w-80 border-l border-neutral-800 bg-neutral-950 flex flex-col overflow-hidden shrink-0">
                <ExerciseLibraryPanel
                  headers={headers}
                  onSelect={handleAddExerciseFromLibrary}
                  onClose={() => setShowLibrary(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
