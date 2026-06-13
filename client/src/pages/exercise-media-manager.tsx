import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { OrgSidebar } from "@/components/OrgSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Youtube, Check, X, Loader2, Brain, TrendingUp, TrendingDown,
  BarChart3, Zap, RefreshCw, Sparkles, Database, CheckCircle2, Image,
  ExternalLink, Eye, Save, Film,
} from "lucide-react";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getHeaders(orgId?: string): Record<string, string> {
  const h: Record<string, string> = {};
  const t = localStorage.getItem("authToken");
  if (t) h["Authorization"] = `Bearer ${t}`;
  if (orgId) {
    const ot = localStorage.getItem(`orgToken_${orgId}`);
    if (ot) h["x-org-auth-token"] = ot;
  }
  return h;
}

// ─── Coverage badge ───────────────────────────────────────────────────────────
function CoverageBadge({ score }: { score: number }) {
  const c = score >= 80
    ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/60"
    : score >= 40
    ? "bg-amber-900/40 text-amber-300 border-amber-700/60"
    : "bg-red-900/40 text-red-300 border-red-700/60";
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-mono font-bold ${c}`}>{score}%</span>;
}

function CoverageBar({ score }: { score: number }) {
  const c = score >= 80 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-16 bg-neutral-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${c}`} style={{ width: `${score}%` }} />
    </div>
  );
}

// ─── YouTube Search Panel ─────────────────────────────────────────────────────
function YouTubeSearchPanel({ exerciseName, orgId, onSelect }: {
  exerciseName: string; orgId: string; onSelect: (v: any) => void;
}) {
  const [q, setQ] = useState(exerciseName);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  async function search() {
    if (!q) return;
    setLoading(true);
    try {
      const r = await fetch("/api/org/exercises/search-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders(orgId) },
        credentials: "include",
        body: JSON.stringify({ query: q }),
      });
      const d = await r.json();
      setResults(d.results ?? []);
    } finally { setLoading(false); }
  }

  function vidId(url: string) {
    const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
    return m?.[1] ?? null;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search YouTube…"
          className="flex-1 bg-neutral-800 border-neutral-700 text-white"
          onKeyDown={(e) => e.key === "Enter" && search()} data-testid="input-youtube-search" />
        <Button onClick={search} disabled={loading} className="bg-red-700 hover:bg-red-600 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Youtube className="h-4 w-4 mr-1.5" />Search</>}
        </Button>
      </div>
      {results.length === 0 && !loading && (
        <div className="text-center py-6 text-neutral-500">
          <Youtube className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Search for a demo video to attach</p>
        </div>
      )}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {results.map((r, i) => {
          const vid = vidId(r.youtubeUrl ?? "");
          const thumb = r.thumbnailUrl ?? (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null);
          return (
            <div key={i} onClick={() => onSelect({ ...r, thumbnailUrl: thumb, embeddedVideoUrl: vid ? `https://www.youtube.com/embed/${vid}` : null })}
              className="flex gap-3 p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-600 cursor-pointer group"
              data-testid={`youtube-result-${i}`}>
              {thumb
                ? <img src={thumb} alt={r.title} className="h-14 w-24 object-cover rounded shrink-0 bg-neutral-800" />
                : <div className="h-14 w-24 bg-neutral-800 rounded shrink-0 flex items-center justify-center"><Youtube className="h-5 w-5 text-neutral-600" /></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white line-clamp-2 leading-tight">{r.title}</p>
                {r.channelName && <p className="text-xs text-neutral-500 mt-0.5">{r.channelName}</p>}
              </div>
              <div className="shrink-0 flex items-center">
                <div className="h-7 w-7 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center group-hover:bg-emerald-700 group-hover:border-emerald-600 transition-colors">
                  <Check className="h-3.5 w-3.5 text-neutral-400 group-hover:text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Cue Generator ─────────────────────────────────────────────────────────
function AICueGenerator({ exercise, orgId, onApply }: {
  exercise: any; orgId: string; onApply: (field: string, values: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState<any>(null);

  async function generate() {
    setLoading(true);
    try {
      const r = await fetch(`/api/org/exercises/${exercise.id}/generate-cues`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders(orgId) },
        credentials: "include",
        body: JSON.stringify({ field: "all" }),
      });
      const d = await r.json();
      setGenerated(d.generated ?? null);
    } finally { setLoading(false); }
  }

  const fieldConfig: Array<{ key: string; label: string; color: string }> = [
    { key: "coachingCues", label: "Coaching Cues", color: "text-emerald-400" },
    { key: "commonMistakes", label: "Common Mistakes", color: "text-amber-400" },
    { key: "progressions", label: "Progressions", color: "text-orange-400" },
    { key: "regressions", label: "Regressions", color: "text-sky-400" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">AI Coaching Intelligence</p>
          <p className="text-xs text-neutral-500">Generate cues, mistakes &amp; alternatives</p>
        </div>
        <Button size="sm" className="bg-purple-700 hover:bg-purple-600" onClick={generate} disabled={loading}
          data-testid="btn-generate-cues">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate</>}
        </Button>
      </div>
      {generated && (
        <div className="space-y-2">
          {fieldConfig.map(({ key, label, color }) => {
            const items: string[] = generated[key] ?? [];
            if (!items.length) return null;
            return (
              <div key={key} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</p>
                  <Button size="sm" variant="ghost" className="h-6 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30"
                    onClick={() => onApply(key, items)}>
                    <Check className="h-3 w-3 mr-1" />Apply
                  </Button>
                </div>
                {items.map((item, i) => (
                  <p key={i} className="text-xs text-neutral-300 flex items-start gap-1.5">
                    <span className="text-neutral-600 shrink-0">•</span>{item}
                  </p>
                ))}
              </div>
            );
          })}
          <Button size="sm" className="w-full bg-emerald-700 hover:bg-emerald-600"
            onClick={() => fieldConfig.forEach(({ key }) => generated[key]?.length && onApply(key, generated[key]))}
            data-testid="btn-apply-all-cues">
            <Zap className="h-3.5 w-3.5 mr-1.5" />Apply All
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── String List Editor ───────────────────────────────────────────────────────
function StringListEditor({ label, values, onChange, color, placeholder }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
  color: "emerald" | "amber" | "orange" | "sky"; placeholder?: string;
}) {
  const cls: Record<string, string> = {
    emerald: "border-emerald-700/40 text-emerald-200",
    amber:   "border-amber-700/40 text-amber-200",
    orange:  "border-orange-700/40 text-orange-200",
    sky:     "border-sky-700/40 text-sky-200",
  };
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{label}</p>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input value={v} placeholder={placeholder}
              onChange={(e) => { const n = [...values]; n[i] = e.target.value; onChange(n); }}
              className={`flex-1 h-8 text-sm bg-neutral-900 border ${cls[color]}`} />
            <button onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="h-8 w-8 flex items-center justify-center text-neutral-600 hover:text-red-400 rounded-lg border border-neutral-800 bg-neutral-900">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="text-xs text-neutral-500 hover:text-neutral-300 h-7"
        onClick={() => onChange([...values, ""])}>+ Add item</Button>
    </div>
  );
}

// ─── Exercise Media Modal ─────────────────────────────────────────────────────
function ExerciseMediaModal({ exercise, orgId, onClose, onSaved }: {
  exercise: any; orgId: string; onClose: () => void; onSaved: (u: any) => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("video");
  const [saving, setSaving] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(exercise.youtubeUrl ?? "");
  const [gifUrl, setGifUrl] = useState(exercise.gifUrl ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState(exercise.thumbnailUrl ?? "");
  const [cues, setCues] = useState<string[]>((exercise.coachingCues as string[]) ?? []);
  const [mistakes, setMistakes] = useState<string[]>((exercise.commonMistakes as string[]) ?? []);
  const [progressions, setProgressions] = useState<string[]>((exercise.progressions as string[]) ?? []);
  const [regressions, setRegressions] = useState<string[]>((exercise.regressions as string[]) ?? []);

  function embedUrl(url: string) {
    const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
    return m ? `https://www.youtube.com/embed/${m[1]}?rel=0&modestbranding=1` : null;
  }

  function applyAI(field: string, vals: string[]) {
    if (field === "coachingCues") setCues(vals);
    else if (field === "commonMistakes") setMistakes(vals);
    else if (field === "progressions") setProgressions(vals);
    else if (field === "regressions") setRegressions(vals);
  }

  async function save() {
    setSaving(true);
    try {
      const vid = embedUrl(youtubeUrl);
      const h = { "Content-Type": "application/json", ...getHeaders(orgId) };
      await fetch(`/api/org/exercises/${exercise.id}/media`, {
        method: "POST", headers: h, credentials: "include",
        body: JSON.stringify({ youtubeUrl: youtubeUrl || null, embeddedVideoUrl: vid || null, gifUrl: gifUrl || null, thumbnailUrl: thumbnailUrl || null, demoType: youtubeUrl ? "youtube" : gifUrl ? "gif" : undefined }),
      });
      const r2 = await fetch(`/api/org/exercises/${exercise.id}`, {
        method: "PATCH", headers: h, credentials: "include",
        body: JSON.stringify({ coachingCues: cues, commonMistakes: mistakes, progressions, regressions }),
      });
      const d2 = await r2.json();
      toast({ title: "Exercise saved" });
      onSaved(d2.exercise ?? exercise);
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally { setSaving(false); }
  }

  const previewUrl = embedUrl(youtubeUrl);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 bg-neutral-950 border-neutral-800">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-neutral-800">
          <DialogTitle className="text-white flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-emerald-400" />
            {exercise.name}
            {exercise.category && <span className="text-xs text-neutral-500 font-normal ml-auto capitalize">{exercise.category}</span>}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="mx-5 mt-3 bg-neutral-900 border border-neutral-800 shrink-0 grid grid-cols-5">
            {[["video","Demo"], ["cues","Cues"], ["mistakes","Mistakes"], ["progressions","Harder"], ["regressions","Easier"]].map(([id, lbl]) => (
              <TabsTrigger key={id} value={id} className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white">{lbl}</TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <TabsContent value="video" className="mt-0 space-y-4">
              {previewUrl && (
                <div className="relative rounded-xl overflow-hidden" style={{ paddingTop: "42%" }}>
                  <iframe src={previewUrl} className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-400 font-medium">YouTube URL</p>
                <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="bg-neutral-900 border-neutral-700 text-white text-sm" data-testid="input-youtube-url" />
                {youtubeUrl && (
                  <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-red-400 flex items-center gap-1 hover:text-red-300">
                    <ExternalLink className="h-3 w-3" />Preview on YouTube
                  </a>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-400 font-medium">GIF URL <span className="text-neutral-600">(optional)</span></p>
                <Input value={gifUrl} onChange={(e) => setGifUrl(e.target.value)}
                  placeholder="https://example.com/exercise.gif"
                  className="bg-neutral-900 border-neutral-700 text-white text-sm" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-400 font-medium">Thumbnail <span className="text-neutral-600">(auto-filled from YouTube)</span></p>
                <Input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://i.ytimg.com/vi/..."
                  className="bg-neutral-900 border-neutral-700 text-white text-sm" />
              </div>
              <div className="border-t border-neutral-800 pt-3">
                <p className="text-xs font-medium text-neutral-400 mb-2">Search YouTube</p>
                <YouTubeSearchPanel exerciseName={exercise.name} orgId={orgId}
                  onSelect={(v) => { setYoutubeUrl(v.youtubeUrl ?? ""); if (v.thumbnailUrl) setThumbnailUrl(v.thumbnailUrl); }} />
              </div>
            </TabsContent>

            <TabsContent value="cues" className="mt-0 space-y-4">
              <StringListEditor label="Coaching Cues" values={cues} onChange={setCues} color="emerald" placeholder="e.g. Chest up, knees tracking toes" />
              <div className="border-t border-neutral-800 pt-3">
                <AICueGenerator exercise={exercise} orgId={orgId} onApply={applyAI} />
              </div>
            </TabsContent>

            <TabsContent value="mistakes" className="mt-0 space-y-4">
              <StringListEditor label="Common Mistakes" values={mistakes} onChange={setMistakes} color="amber" placeholder="e.g. Caving knees inward" />
              <div className="border-t border-neutral-800 pt-3">
                <AICueGenerator exercise={exercise} orgId={orgId} onApply={applyAI} />
              </div>
            </TabsContent>

            <TabsContent value="progressions" className="mt-0">
              <StringListEditor label="Progressions (Harder)" values={progressions} onChange={setProgressions} color="orange" placeholder="e.g. Pause Squat" />
            </TabsContent>

            <TabsContent value="regressions" className="mt-0">
              <StringListEditor label="Regressions (Easier)" values={regressions} onChange={setRegressions} color="sky" placeholder="e.g. Goblet Squat" />
            </TabsContent>
          </div>
        </Tabs>

        <div className="px-5 pb-5 pt-3 border-t border-neutral-800 flex gap-3">
          <Button variant="outline" className="border-neutral-700 text-neutral-300 bg-neutral-900" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-emerald-700 hover:bg-emerald-600" disabled={saving} onClick={save} data-testid="btn-save-exercise">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : <><Save className="h-4 w-4 mr-2" />Save Exercise</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, icon: Icon, accent }: { value: number | string; label: string; icon: any; accent: string }) {
  return (
    <div className={`bg-neutral-900 border rounded-xl p-4 space-y-1 ${accent}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 opacity-60" />
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </div>
      <p className="text-xs opacity-50">{label}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  strength:     "bg-blue-900/30 text-blue-300 border-blue-700/50",
  power:        "bg-orange-900/30 text-orange-300 border-orange-700/50",
  speed:        "bg-yellow-900/30 text-yellow-300 border-yellow-700/50",
  plyometric:   "bg-red-900/30 text-red-300 border-red-700/50",
  core:         "bg-purple-900/30 text-purple-300 border-purple-700/50",
  conditioning: "bg-green-900/30 text-green-300 border-green-700/50",
  mobility:     "bg-teal-900/30 text-teal-300 border-teal-700/50",
};
const CATEGORIES = Object.keys(CAT_COLORS);

export default function ExerciseMediaManagerPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();

  // ── Fetch org ──
  const { data: org } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: () => fetchJson(`/api/organizations/${slug}`),
    enabled: !!slug,
  });
  const orgId: string = org?.id ?? "";

  // ── Filters ──
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"coverage" | "name">("coverage");
  const [selectedExercise, setSelectedExercise] = useState<any>(null);
  const [autoEnrichId, setAutoEnrichId] = useState<string | null>(null);
  const [autoEnrichData, setAutoEnrichData] = useState<any>(null);
  const [autoEnrichLoading, setAutoEnrichLoading] = useState(false);

  const qParams = new URLSearchParams({
    ...(search ? { search } : {}),
    ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
    ...(coverageFilter === "missing_video" ? { hasVideo: "false" } : {}),
    ...(coverageFilter === "missing_cues" ? { hasNoCues: "true" } : {}),
  });

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/exercises/media-coverage", orgId, search, categoryFilter, coverageFilter],
    queryFn: () => fetchJson(`/api/org/exercises/media-coverage?${qParams}`, { headers: getHeaders(orgId) }),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const stats = data?.stats;
  let exercises: any[] = data?.exercises ?? [];
  if (sortBy === "coverage") exercises = [...exercises].sort((a, b) => a.mediaCoverageScore - b.mediaCoverageScore);
  else exercises = [...exercises].sort((a, b) => a.name.localeCompare(b.name));

  // ── Auto-enrich ──
  async function autoEnrich(id: string) {
    setAutoEnrichId(id);
    setAutoEnrichLoading(true);
    setAutoEnrichData(null);
    try {
      const r = await fetch(`/api/org/exercises/${id}/auto-enrich`, {
        method: "POST", headers: { "Content-Type": "application/json", ...getHeaders(orgId) }, credentials: "include",
        body: JSON.stringify({}),
      });
      setAutoEnrichData(await r.json());
    } finally { setAutoEnrichLoading(false); }
  }

  async function applyAutoEnrich(id: string, suggestion: any) {
    await fetch(`/api/org/exercises/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getHeaders(orgId) }, credentials: "include",
      body: JSON.stringify({ coachingCues: suggestion.coachingCues ?? [], commonMistakes: suggestion.commonMistakes ?? [], progressions: suggestion.progressions ?? [], regressions: suggestion.regressions ?? [] }),
    });
    toast({ title: "Exercise enriched" });
    setAutoEnrichId(null);
    setAutoEnrichData(null);
    refetch();
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-neutral-950 flex w-full">
        <OrgSidebar orgSlug={slug!} />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Header */}
          <div className="px-6 py-5 border-b border-neutral-800 flex items-center justify-between gap-4 shrink-0">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Film className="h-5 w-5 text-emerald-400" />
                Exercise Media Manager
              </h1>
              <p className="text-sm text-neutral-500 mt-0.5">Manage demo videos, coaching cues, and exercise intelligence</p>
            </div>
            <Button variant="outline" size="sm" className="border-neutral-700 text-neutral-300 bg-neutral-900 shrink-0"
              onClick={() => refetch()} data-testid="btn-refresh-media">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard value={stats.total}         label="Total exercises"   icon={Database}     accent="border-neutral-700 text-white" />
                <StatCard value={`${stats.avgCoverage}%`} label="Avg. coverage" icon={BarChart3}    accent="border-neutral-700 text-white" />
                <StatCard value={stats.fullyEnriched} label="Fully enriched"    icon={CheckCircle2} accent="border-emerald-800/60 text-emerald-300" />
                <StatCard value={stats.missingVideo}  label="Missing video"     icon={Youtube}      accent="border-red-800/60 text-red-300" />
                <StatCard value={stats.missingCues}   label="Missing cues"      icon={Brain}        accent="border-amber-800/60 text-amber-300" />
              </div>
            )}

            {/* Library coverage bar */}
            {stats && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">Library Coverage</p>
                  <span className="text-sm font-bold text-white tabular-nums">{stats.avgCoverage}%</span>
                </div>
                <div className="h-3 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                    style={{ width: `${stats.avgCoverage}%` }} />
                </div>
                <div className="flex justify-between text-xs text-neutral-600">
                  <span>Needs work</span>
                  <span>{stats.fullyEnriched} / {stats.total} fully enriched</span>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-40">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search exercises…" className="pl-8 bg-neutral-900 border-neutral-700 text-white h-9"
                  data-testid="input-exercise-search" />
              </div>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm">
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
              <select value={coverageFilter} onChange={(e) => setCoverageFilter(e.target.value)}
                className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm">
                <option value="all">All coverage</option>
                <option value="missing_video">Missing video</option>
                <option value="missing_cues">Missing cues</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm">
                <option value="coverage">Coverage ↑</option>
                <option value="name">Name A–Z</option>
              </select>
              <span className="text-xs text-neutral-500 ml-auto">{exercises.length} exercises</span>
            </div>

            {/* Exercise list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-7 w-7 animate-spin text-neutral-500" />
              </div>
            ) : exercises.length === 0 ? (
              <div className="text-center py-16 text-neutral-500">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No exercises match your filters</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {exercises.map((ex) => (
                  <div key={ex.id}
                    className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex items-center gap-3 hover:border-neutral-600 transition-colors"
                    data-testid={`exercise-row-${ex.id}`}>

                    {/* Coverage */}
                    <div className="shrink-0 w-16 space-y-1 hidden sm:block">
                      <CoverageBadge score={ex.mediaCoverageScore} />
                      <CoverageBar score={ex.mediaCoverageScore} />
                    </div>

                    {/* Thumbnail */}
                    <div className="shrink-0 h-10 w-14 rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                      {ex.thumbnailUrl
                        ? <img src={ex.thumbnailUrl} alt={ex.name} className="h-full w-full object-cover" />
                        : ex.youtubeUrl
                        ? <Youtube className="h-4 w-4 text-red-400" />
                        : <Image className="h-4 w-4 text-neutral-600" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white">{ex.name}</p>
                        {ex.category && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border capitalize ${CAT_COLORS[ex.category] ?? "bg-neutral-800 text-neutral-400 border-neutral-700"}`}>
                            {ex.category}
                          </span>
                        )}
                        <span className="sm:hidden"><CoverageBadge score={ex.mediaCoverageScore} /></span>
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span className={`text-xs flex items-center gap-1 ${ex.hasVideo ? "text-emerald-500" : "text-neutral-600"}`}>
                          <Youtube className="h-3 w-3" />{ex.hasVideo ? "Video" : "No video"}
                        </span>
                        <span className={`text-xs flex items-center gap-1 ${ex.hasCues ? "text-emerald-500" : "text-neutral-600"}`}>
                          <Brain className="h-3 w-3" />{ex.hasCues ? `${(ex.coachingCues as string[])?.length} cues` : "No cues"}
                        </span>
                        <span className={`text-xs flex items-center gap-1 ${ex.hasProgressions ? "text-emerald-500" : "text-neutral-600"}`}>
                          <TrendingUp className="h-3 w-3" />{ex.hasProgressions ? "Progressions" : "—"}
                        </span>
                        <span className={`text-xs flex items-center gap-1 ${ex.hasRegressions ? "text-emerald-500" : "text-neutral-600"}`}>
                          <TrendingDown className="h-3 w-3" />{ex.hasRegressions ? "Regressions" : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {ex.mediaCoverageScore < 60 && (
                        <Button size="sm" variant="ghost"
                          className="h-7 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-900/20"
                          onClick={() => autoEnrich(ex.id)} disabled={autoEnrichLoading && autoEnrichId === ex.id}
                          data-testid={`btn-ai-fill-${ex.id}`}>
                          {autoEnrichLoading && autoEnrichId === ex.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Zap className="h-3 w-3 mr-1" />AI Fill</>}
                        </Button>
                      )}
                      <Button size="sm"
                        className="h-7 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-xs"
                        onClick={() => setSelectedExercise(ex)} data-testid={`btn-edit-exercise-${ex.id}`}>
                        <Eye className="h-3 w-3 mr-1" />Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Exercise Media Modal */}
      {selectedExercise && (
        <ExerciseMediaModal
          exercise={selectedExercise}
          orgId={orgId}
          onClose={() => setSelectedExercise(null)}
          onSaved={(updated) => { setSelectedExercise(null); refetch(); toast({ title: `${updated.name ?? "Exercise"} saved` }); }}
        />
      )}

      {/* Auto-Enrich Approval Modal */}
      {autoEnrichData && autoEnrichId && (
        <Dialog open onOpenChange={() => { setAutoEnrichId(null); setAutoEnrichData(null); }}>
          <DialogContent className="max-w-lg bg-neutral-950 border-neutral-800">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />AI Enrichment Preview
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-neutral-400">
                Review AI-generated intelligence for <strong className="text-white">{autoEnrichData.exerciseName}</strong> before applying.
              </p>
              {[
                { key: "coachingCues", label: "Coaching Cues", color: "text-emerald-400" },
                { key: "commonMistakes", label: "Common Mistakes", color: "text-amber-400" },
                { key: "progressions", label: "Progressions", color: "text-orange-400" },
                { key: "regressions", label: "Regressions", color: "text-sky-400" },
              ].map(({ key, label, color }) => {
                const items: string[] = autoEnrichData.suggestion?.[key] ?? [];
                if (!items.length) return null;
                return (
                  <div key={key} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                    <p className={`text-xs font-semibold mb-1.5 ${color}`}>{label}</p>
                    {items.map((item, i) => (
                      <p key={i} className="text-xs text-neutral-300 flex items-start gap-1.5">
                        <span className="text-neutral-600">•</span>{item}
                      </p>
                    ))}
                  </div>
                );
              })}
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 border-neutral-700 text-neutral-300 bg-neutral-900"
                  onClick={() => { setAutoEnrichId(null); setAutoEnrichData(null); }}>Cancel</Button>
                <Button className="flex-1 bg-emerald-700 hover:bg-emerald-600"
                  onClick={() => applyAutoEnrich(autoEnrichId, autoEnrichData.suggestion)}
                  data-testid="btn-confirm-auto-enrich">
                  <Check className="h-4 w-4 mr-2" />Apply All
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </SidebarProvider>
  );
}
