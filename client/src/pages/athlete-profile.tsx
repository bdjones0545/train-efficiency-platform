import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OrgSidebar } from "@/components/OrgSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  User, Flame, Trophy, Brain, BookOpen, Activity, Shield, AlertTriangle,
  Loader2, Sparkles, TrendingUp, TrendingDown, ArrowLeft, Plus, Pin,
  MessageSquare, Calendar, Zap, Target, BarChart3, ChevronRight,
  CheckCircle2, Clock, Star, Save, RefreshCw, Trash2,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtFull(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-neutral-500";
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function riskColor(risk: string | null | undefined): string {
  if (risk === "green") return "bg-emerald-900/40 text-emerald-300 border-emerald-700/60";
  if (risk === "yellow") return "bg-amber-900/40 text-amber-300 border-amber-700/60";
  if (risk === "red") return "bg-red-900/40 text-red-300 border-red-700/60";
  return "bg-neutral-800 text-neutral-400 border-neutral-700";
}

// ─── Status Score Ring ────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number | null | undefined }) {
  const s = score ?? 0;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - (s / 100) * circ;
  const color = s >= 70 ? "#10b981" : s >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg className="h-20 w-20 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#262626" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-white tabular-nums">{s}</span>
        <span className="text-[9px] text-neutral-500 uppercase tracking-wide">Status</span>
      </div>
    </div>
  );
}

// ─── Health Card ──────────────────────────────────────────────────────────────
function HealthCard({ label, value, unit, icon: Icon, color, sub }: {
  label: string; value: number | string | null | undefined;
  unit?: string; icon: any; color: string; sub?: string;
}) {
  const isNull = value == null;
  return (
    <div className={`bg-neutral-900 border rounded-xl p-4 space-y-1 ${color}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 opacity-60" />
        <span className="text-xs opacity-50">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${isNull ? "text-neutral-600" : ""}`}>
        {isNull ? "—" : `${value}${unit ?? ""}`}
      </p>
      {sub && <p className="text-xs opacity-50">{sub}</p>}
    </div>
  );
}

// ─── Readiness chart ──────────────────────────────────────────────────────────
function ReadinessChart({ data, range }: { data: any[]; range: number }) {
  if (!data.length) return <EmptyChart label="No readiness data" />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#737373" }} tickFormatter={(v) => v.slice(5)} />
        <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: "#737373" }} />
        <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} />
        <ReferenceLine y={7} stroke="#10b981" strokeDasharray="4 4" opacity={0.4} />
        <Line type="monotone" dataKey="readiness" stroke="#10b981" strokeWidth={2} dot={false} name="Readiness" />
        <Line type="monotone" dataKey="fatigue" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Fatigue" strokeDasharray="4 4" />
        <Line type="monotone" dataKey="sleep" stroke="#6366f1" strokeWidth={1.5} dot={false} name="Sleep" />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Adherence chart ──────────────────────────────────────────────────────────
function AdherenceChart({ data }: { data: any[] }) {
  if (!data.length) return <EmptyChart label="No workout data" />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#737373" }} tickFormatter={(v) => v.slice(5)} />
        <YAxis tick={{ fontSize: 10, fill: "#737373" }} />
        <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── PR chart ─────────────────────────────────────────────────────────────────
function PRChart({ prByLift }: { prByLift: Record<string, any[]> }) {
  const lifts = Object.keys(prByLift);
  const [activeLift, setActiveLift] = useState(lifts[0] ?? "");
  if (!lifts.length) return <EmptyChart label="No PR data" />;
  const series = prByLift[activeLift] ?? [];
  const COLORS = ["#f97316", "#10b981", "#6366f1", "#f59e0b", "#ec4899"];
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {lifts.map((l) => (
          <button key={l} onClick={() => setActiveLift(l)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${activeLift === l ? "bg-orange-700 border-orange-600 text-white" : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>
            {l}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={series} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#737373" }} />
          <YAxis tick={{ fontSize: 10, fill: "#737373" }} />
          <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="value" stroke={COLORS[lifts.indexOf(activeLift) % COLORS.length]}
            strokeWidth={2} dot={{ r: 3 }} name={activeLift} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── RPE chart ────────────────────────────────────────────────────────────────
function RPEChart({ data }: { data: any[] }) {
  if (!data.length) return <EmptyChart label="No RPE data" />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#737373" }} tickFormatter={(v) => v.slice(5)} />
        <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: "#737373" }} />
        <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} />
        <ReferenceLine y={7} stroke="#f59e0b" strokeDasharray="4 4" opacity={0.4} />
        <Line type="monotone" dataKey="rpe" stroke="#f97316" strokeWidth={2} dot={false} name="RPE" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Empty chart placeholder ──────────────────────────────────────────────────
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-neutral-600 text-sm">
      <BarChart3 className="h-5 w-5 mr-2 opacity-40" />{label}
    </div>
  );
}

// ─── Timeline event row ───────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  workout:     "border-emerald-800/60 bg-emerald-900/20",
  pr:          "border-yellow-800/60 bg-yellow-900/20",
  readiness:   "border-sky-800/60 bg-sky-900/20",
  education:   "border-purple-800/60 bg-purple-900/20",
  intervention:"border-orange-800/60 bg-orange-900/20",
  note:        "border-neutral-700 bg-neutral-900/50",
};

function TimelineEvent({ event }: { event: any }) {
  const colors = TYPE_COLORS[event.type] ?? "border-neutral-700 bg-neutral-900";
  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${colors}`}>
      <span className="text-lg shrink-0 leading-none mt-0.5">{event.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-white">{event.title}</p>
          <span className="text-xs text-neutral-500 shrink-0">{fmt(event.date)}</span>
        </div>
        {event.detail && <p className="text-xs text-neutral-400 mt-0.5">{event.detail}</p>}
        {event.notes && <p className="text-xs text-neutral-600 mt-0.5 italic">"{event.notes}"</p>}
      </div>
    </div>
  );
}

// ─── Coach Notes Panel ────────────────────────────────────────────────────────
function CoachNotesPanel({ userId, orgId, coachNotes, onRefresh }: {
  userId: string; orgId: string; coachNotes: any[]; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/org/athlete-profile/${userId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders(orgId) },
        credentials: "include",
        body: JSON.stringify({ title: title || "Coach Note", note, pinned }),
      });
      setNote(""); setTitle(""); setPinned(false); setAdding(false);
      onRefresh();
      toast({ title: "Note saved" });
    } finally { setSaving(false); }
  }

  async function deleteNote(id: string) {
    await fetch(`/api/org/athlete-profile/${userId}/notes/${id}`, {
      method: "DELETE", headers: getHeaders(orgId), credentials: "include",
    });
    onRefresh();
  }

  const pinnedNotes = coachNotes.filter(n => n.status === "pinned");
  const regularNotes = coachNotes.filter(n => n.status !== "pinned");

  return (
    <div className="space-y-3">
      {pinnedNotes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Pin className="h-3 w-3" /> Pinned
          </p>
          {pinnedNotes.map(n => (
            <div key={n.id} className="bg-amber-900/10 border border-amber-800/40 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-white">{n.title}</p>
                <div className="flex gap-1 shrink-0">
                  <span className="text-xs text-neutral-500">{fmt(n.createdAt)}</span>
                  <button onClick={() => deleteNote(n.id)} className="text-neutral-600 hover:text-red-400 ml-1">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-neutral-300 mt-1 whitespace-pre-line">{n.summary}</p>
            </div>
          ))}
        </div>
      )}

      {regularNotes.map(n => (
        <div key={n.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white">{n.title}</p>
            <div className="flex gap-1 shrink-0 items-center">
              <span className="text-xs text-neutral-500">{fmt(n.createdAt)}</span>
              <button onClick={() => deleteNote(n.id)} className="text-neutral-600 hover:text-red-400 ml-1">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1 whitespace-pre-line">{n.summary}</p>
        </div>
      ))}

      {coachNotes.length === 0 && !adding && (
        <p className="text-sm text-neutral-600 text-center py-4">No notes yet</p>
      )}

      {adding ? (
        <div className="space-y-2 bg-neutral-900 border border-neutral-700 rounded-xl p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title (optional)"
            className="bg-neutral-800 border-neutral-700 text-white text-sm h-8" />
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write your observation…"
            className="bg-neutral-800 border-neutral-700 text-white text-sm min-h-[80px] resize-none" />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)}
                className="rounded border-neutral-600" />
              <Pin className="h-3 w-3" /> Pin note
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs text-neutral-400" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs bg-emerald-700 hover:bg-emerald-600" onClick={save} disabled={saving || !note.trim()}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-1" />Save</>}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="w-full h-8 text-xs text-neutral-500 hover:text-neutral-300 border border-dashed border-neutral-800 hover:border-neutral-600"
          onClick={() => setAdding(true)} data-testid="btn-add-note">
          <Plus className="h-3 w-3 mr-1.5" /> Add Note
        </Button>
      )}
    </div>
  );
}

// ─── AI Summary panel ─────────────────────────────────────────────────────────
function AISummaryPanel({ userId, orgId }: { userId: string; orgId: string }) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const r = await fetch(`/api/org/athlete-profile/${userId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders(orgId) },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const d = await r.json();
      setSummary(d.summary ?? "");
      setGeneratedAt(d.generatedAt ?? null);
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-1.5">
            <Brain className="h-4 w-4 text-purple-400" /> AI Intelligence Summary
          </p>
          {generatedAt && <p className="text-xs text-neutral-600 mt-0.5">Generated {fmtFull(generatedAt)}</p>}
        </div>
        <Button size="sm" className="bg-purple-700 hover:bg-purple-600" onClick={generate} disabled={loading}
          data-testid="btn-generate-summary">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />{summary ? "Regenerate" : "Generate"}</>}
        </Button>
      </div>
      {summary ? (
        <p className="text-sm text-neutral-300 leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm text-neutral-600 italic">Click Generate to create an AI-powered athlete development summary.</p>
      )}
    </div>
  );
}

// ─── Chart Panel wrapper ──────────────────────────────────────────────────────
function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-white">{title}</p>
      {children}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AthleteProfilePage() {
  const { slug, userId } = useParams<{ slug: string; userId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [graphRange, setGraphRange] = useState(30);
  const [timelineType, setTimelineType] = useState("all");

  // ── Fetch org ──
  const { data: org } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: () => fetch(`/api/organizations/${slug}`).then((r) => r.json()),
    enabled: !!slug,
  });
  const orgId: string = org?.id ?? "";
  const headers = getHeaders(orgId);

  // ── Profile data ──
  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useQuery<any>({
    queryKey: ["/api/org/athlete-profile", userId, orgId],
    queryFn: () => fetch(`/api/org/athlete-profile/${userId}`, { credentials: "include", headers }).then((r) => r.json()),
    enabled: !!orgId && !!userId,
  });

  // ── Graph data ──
  const { data: graphs, isLoading: graphsLoading } = useQuery<any>({
    queryKey: ["/api/org/athlete-profile/graphs", userId, orgId, graphRange],
    queryFn: () => fetch(`/api/org/athlete-profile/${userId}/graphs?range=${graphRange}`, { credentials: "include", headers }).then((r) => r.json()),
    enabled: !!orgId && !!userId,
  });

  // ── Timeline ──
  const { data: timeline, isLoading: timelineLoading } = useQuery<any>({
    queryKey: ["/api/org/athlete-profile/timeline", userId, orgId, timelineType],
    queryFn: () => fetch(`/api/org/athlete-profile/${userId}/timeline?type=${timelineType}`, { credentials: "include", headers }).then((r) => r.json()),
    enabled: !!orgId && !!userId && activeTab === "timeline",
  });

  if (profileLoading || !orgId) {
    return (
      <SidebarProvider>
        <div className="min-h-screen bg-neutral-950 flex w-full">
          <OrgSidebar orgSlug={slug!} />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
          </div>
        </div>
      </SidebarProvider>
    );
  }

  const { user, snapshot, streak, healthSnapshot, coachNotes, riskFlags, prs, interventions } = profile ?? {};

  const initials = (user?.name ?? "?").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-neutral-950 flex w-full">
        <OrgSidebar orgSlug={slug!} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* ── Back nav ── */}
          <div className="px-6 pt-4 shrink-0">
            <button onClick={() => setLocation(`/org/${slug}/coach/athlete-status`)}
              className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors mb-4">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Athletes
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-6">

            {/* ── Profile Header ── */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* Avatar */}
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900 flex items-center justify-center text-xl font-bold text-white shrink-0">
                  {initials}
                </div>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold text-white">{user?.name ?? "Unknown Athlete"}</h1>
                    {snapshot?.riskLevel && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${riskColor(snapshot.riskLevel)}`}>
                        {snapshot.riskLevel === "green" ? "On Track" : snapshot.riskLevel === "yellow" ? "Needs Attention" : "At Risk"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-neutral-500">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{user?.email ?? "—"}</span>
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined {fmtFull(user?.createdAt)}</span>
                    {streak?.totalSessionsCompleted > 0 && (
                      <span className="flex items-center gap-1 text-emerald-400"><Trophy className="h-3 w-3" />{streak.totalSessionsCompleted} sessions</span>
                    )}
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(streak?.currentStreak ?? 0) >= 3 && (
                      <span className="text-xs bg-orange-900/30 text-orange-300 border border-orange-700/50 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <Flame className="h-3 w-3" /> {streak.currentStreak}d streak
                      </span>
                    )}
                    {(streak?.longestStreak ?? 0) >= 7 && (
                      <span className="text-xs bg-yellow-900/30 text-yellow-300 border border-yellow-700/50 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <Star className="h-3 w-3" /> {streak.longestStreak}d best
                      </span>
                    )}
                    {(healthSnapshot?.educationPct ?? 0) >= 80 && (
                      <span className="text-xs bg-purple-900/30 text-purple-300 border border-purple-700/50 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <BookOpen className="h-3 w-3" /> Scholar
                      </span>
                    )}
                    {(snapshot?.statusScore ?? 0) >= 80 && (
                      <span className="text-xs bg-emerald-900/30 text-emerald-300 border border-emerald-700/50 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <Zap className="h-3 w-3" /> Elite
                      </span>
                    )}
                  </div>
                </div>

                {/* Score ring */}
                <ScoreRing score={snapshot?.statusScore} />
              </div>

              {/* Score breakdown pills */}
              {snapshot && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-4 border-t border-neutral-800">
                  {[
                    { label: "Readiness", value: snapshot.readinessScore, icon: Activity },
                    { label: "Adherence", value: snapshot.adherenceScore, icon: CheckCircle2 },
                    { label: "Recovery", value: snapshot.recoveryScore, icon: Zap },
                    { label: "Education", value: snapshot.educationScore, icon: BookOpen },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="bg-neutral-800/50 rounded-lg px-3 py-2 flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
                      <div>
                        <p className="text-xs text-neutral-500">{label}</p>
                        <p className={`text-sm font-bold ${scoreColor(value)}`}>{value ?? "—"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── AI Summary ── */}
            <AISummaryPanel userId={userId!} orgId={orgId} />

            {/* ── Risk Flags ── */}
            {(riskFlags?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> Active Risk Flags
                </p>
                {(riskFlags ?? []).map((f: any) => (
                  <div key={f.id} className={`p-3 rounded-lg border flex items-start gap-2 ${
                    f.severity === "critical" ? "bg-red-900/20 border-red-800/50" :
                    f.severity === "warning" ? "bg-amber-900/20 border-amber-800/50" :
                    "bg-neutral-900 border-neutral-800"}`}>
                    <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${f.severity === "critical" ? "text-red-400" : f.severity === "warning" ? "text-amber-400" : "text-neutral-500"}`} />
                    <div>
                      <p className="text-sm font-medium text-white">{f.title}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">{f.summary}</p>
                      {f.recommendation && <p className="text-xs text-emerald-400 mt-1">→ {f.recommendation}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Main Tabs ── */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-neutral-900 border border-neutral-800 grid grid-cols-4 sm:w-fit">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "graphs", label: "Graphs" },
                  { id: "timeline", label: "Timeline" },
                  { id: "notes", label: "Notes" },
                ].map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm data-[state=active]:bg-neutral-800 data-[state=active]:text-white">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* ── Overview ── */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                {/* Health Snapshot */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <HealthCard label="Avg Readiness" value={healthSnapshot?.avgReadiness} unit="/10" icon={Activity} color="border-emerald-800/50 text-emerald-300" sub="30 days" />
                  <HealthCard label="Avg Fatigue" value={healthSnapshot?.avgFatigue} unit="/10" icon={Zap} color="border-red-800/50 text-red-300" sub="30 days" />
                  <HealthCard label="Avg Soreness" value={healthSnapshot?.avgSoreness} unit="/10" icon={Activity} color="border-amber-800/50 text-amber-300" sub="30 days" />
                  <HealthCard label="Adherence" value={healthSnapshot?.adherencePct} unit="%" icon={CheckCircle2} color="border-blue-800/50 text-blue-300" />
                  <HealthCard label="Education" value={healthSnapshot?.educationPct} unit="%" icon={BookOpen} color="border-purple-800/50 text-purple-300" sub={`${profile?.eduProgress?.completed ?? 0}/${profile?.eduProgress?.total ?? 0} modules`} />
                  <HealthCard label="Avg Quiz" value={healthSnapshot?.avgQuiz} unit="%" icon={Brain} color="border-indigo-800/50 text-indigo-300" />
                </div>

                {/* PRs */}
                {(prs?.length ?? 0) > 0 && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-medium text-white flex items-center gap-1.5">
                      <Trophy className="h-4 w-4 text-yellow-400" /> Personal Records
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {(prs ?? []).map((pr: any) => (
                        <div key={pr.liftName} className="bg-neutral-800 rounded-lg p-3 border border-neutral-700">
                          <p className="text-xs text-neutral-500">{pr.liftName}</p>
                          <p className="text-lg font-bold text-yellow-400 tabular-nums">{pr.best}</p>
                          <p className="text-xs text-neutral-600">{pr.unit}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Streaks */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-neutral-900 border border-orange-800/40 rounded-xl p-4 text-center">
                    <Flame className="h-5 w-5 text-orange-400 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-orange-400 tabular-nums">{streak?.currentStreak ?? 0}</p>
                    <p className="text-xs text-neutral-500">Current Streak</p>
                  </div>
                  <div className="bg-neutral-900 border border-yellow-800/40 rounded-xl p-4 text-center">
                    <Star className="h-5 w-5 text-yellow-400 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-yellow-400 tabular-nums">{streak?.longestStreak ?? 0}</p>
                    <p className="text-xs text-neutral-500">Best Streak</p>
                  </div>
                  <div className="bg-neutral-900 border border-emerald-800/40 rounded-xl p-4 text-center">
                    <Trophy className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-emerald-400 tabular-nums">{streak?.totalSessionsCompleted ?? 0}</p>
                    <p className="text-xs text-neutral-500">Total Sessions</p>
                  </div>
                </div>

                {/* Interventions */}
                {(interventions?.length ?? 0) > 0 && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-medium text-white flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-orange-400" /> Interventions
                    </p>
                    <div className="space-y-2">
                      {(interventions ?? []).slice(0, 5).map((i: any) => (
                        <div key={i.id} className={`p-3 rounded-lg border ${i.severity === "warning" ? "border-amber-800/50 bg-amber-900/10" : "border-neutral-800 bg-neutral-800/30"}`}>
                          <p className="text-sm font-medium text-white">{i.title}</p>
                          <p className="text-xs text-neutral-400 mt-0.5">{i.summary}</p>
                          {i.suggestedAction && <p className="text-xs text-emerald-400 mt-1">→ {i.suggestedAction}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Graphs ── */}
              <TabsContent value="graphs" className="mt-4 space-y-4">
                <div className="flex gap-2">
                  {[7, 30, 90].map((d) => (
                    <button key={d} onClick={() => setGraphRange(d)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${graphRange === d ? "bg-emerald-700 border-emerald-600 text-white" : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>
                      {d}d
                    </button>
                  ))}
                </div>

                {graphsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-7 w-7 animate-spin text-neutral-500" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <ChartPanel title="Readiness / Fatigue / Sleep Trend">
                      <ReadinessChart data={graphs?.readinessSeries ?? []} range={graphRange} />
                    </ChartPanel>
                    <ChartPanel title="PR Progression">
                      <PRChart prByLift={graphs?.prByLift ?? {}} />
                    </ChartPanel>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <ChartPanel title="Workout Adherence">
                        <AdherenceChart data={graphs?.adherenceSeries ?? []} />
                      </ChartPanel>
                      <ChartPanel title="RPE Trend">
                        <RPEChart data={graphs?.rpeSeries ?? []} />
                      </ChartPanel>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Timeline ── */}
              <TabsContent value="timeline" className="mt-4 space-y-3">
                <div className="flex gap-1.5 flex-wrap">
                  {[["all","All"], ["workout","Workouts"], ["pr","PRs"], ["readiness","Readiness"], ["education","Education"], ["intervention","Interventions"]].map(([val, label]) => (
                    <button key={val} onClick={() => setTimelineType(val)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${timelineType === val ? "bg-emerald-700 border-emerald-600 text-white" : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {timelineLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
                  </div>
                ) : (timeline?.events?.length ?? 0) === 0 ? (
                  <div className="text-center py-12 text-neutral-600">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>No events found for this filter</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(timeline?.events ?? []).map((event: any) => (
                      <TimelineEvent key={`${event.type}-${event.id}`} event={event} />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── Notes ── */}
              <TabsContent value="notes" className="mt-4">
                <CoachNotesPanel userId={userId!} orgId={orgId}
                  coachNotes={coachNotes ?? []} onRefresh={refetchProfile} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
