import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import PlayerCard from "@/components/pr-tracker/PlayerCard";
import type { PlayerCardProfile } from "@/components/pr-tracker/PlayerCard";
import PRIntelligencePanel from "@/components/pr-tracker/PRIntelligencePanel";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Users,
  Trophy,
  CalendarCheck,
  Star,
  ClipboardList,
  Save,
  Loader2,
  Camera,
  FileText,
  RefreshCw,
  LogOut,
  LayoutDashboard,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  TrendingUp,
  Activity,
  Lock,
  BarChart2,
  Calendar,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AthleteFullProfile {
  athlete: { id: string; name: string; email: string; createdAt: string };
  orgMembership: { role: string; createdAt: string } | null;
  teams: Array<{ id: string; name: string; sport: string | null; season: string | null; memberRole: string; joinedAt: string; coachUserId: string }>;
  bestPrs: Array<{ liftTypeId: string; liftName: string; unit: string; bestValue: number; entryCount: number; lastDate: string }>;
  prHistory: Record<string, Array<{ id: string; liftName: string; value: number; unit: string; entryDate: string; notes: string | null }>>;
  recentEntries: Array<{ id: string; liftName: string; value: number; unit: string; entryDate: string; notes: string | null }>;
  upcomingBookings: Array<{ id: string; date: string; timeSlot: string; teamName: string; trainingType: string }>;
  pastBookings: Array<{ id: string; date: string; timeSlot: string; teamName: string; trainingType: string }>;
  notes: string;
  notesUpdatedAt: string | null;
  stats: { totalEntries: number; liftTypes: number; upcomingSessions: number; pastSessions: number; teamsCount: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const avatarColors = ["bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500"];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function safeFmt(dateStr: string | null | undefined, fmt = "MMM d, yyyy") {
  if (!dateStr) return "—";
  try { return format(parseISO(dateStr), fmt); } catch { return dateStr; }
}

// ─── Placeholder card ─────────────────────────────────────────────────────────

function ComingSoonCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-dashed opacity-70">
      <button className="w-full p-4 flex items-center gap-3 text-left" onClick={() => setOpen(!open)}>
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">Coming soon</p>
        </div>
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && <p className="px-4 pb-4 text-xs text-muted-foreground">{description}</p>}
    </Card>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoachAthleteDetailPage() {
  const params = useParams<{ slug: string; userId: string }>();
  const slug = params.slug || "";
  const userId = params.userId || "";
  const { toast } = useToast();

  const { data: org } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const orgId = org?.id;

  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setOrgToken(token))
      .catch(() => { localStorage.removeItem(`orgToken_${orgId}`); });
  }, [orgId]);

  const { data: profile, isLoading, refetch } = useQuery<AthleteFullProfile>({
    queryKey: ["/api/org/coach/athletes", userId, orgToken],
    queryFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${userId}`, {
        headers: { "X-Org-Auth-Token": orgToken! },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!orgToken && !!userId,
  });

  // Notes
  const [editingNotes, setEditingNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  useEffect(() => {
    if (profile) setEditingNotes(profile.notes || "");
  }, [profile]);

  const saveNotesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${userId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken! },
        body: JSON.stringify({ notes: editingNotes }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
      toast({ title: "Notes saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // PR History filter
  const [historyLiftFilter, setHistoryLiftFilter] = useState("__all__");
  const [historySort, setHistorySort] = useState<"newest" | "best">("newest");
  const [bookingTab, setBookingTab] = useState<"upcoming" | "past">("upcoming");

  // Player Card
  const playerCardRef = useRef<HTMLDivElement>(null);
  const batchExportRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  async function downloadCardPng() {
    if (!playerCardRef.current || !profile) return;
    setIsCapturing(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(playerCardRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: true, logging: false });
      const link = document.createElement("a");
      link.download = `${profile.athlete.name.replace(/\s+/g, "-")}-player-card.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "Player card downloaded" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
  }

  async function exportPdf() {
    if (!batchExportRef.current || !profile) return;
    setIsGeneratingPdf(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
      await new Promise<void>((r) => setTimeout(r, 300));
      const canvas = await html2canvas(batchExportRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: true, logging: false });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.height / canvas.width;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, Math.min(pageW * ratio, pageH));
      pdf.save(`${profile.athlete.name.replace(/\s+/g, "-")}-report-${new Date().toISOString().split("T")[0]}.pdf`);
      toast({ title: "PDF exported" });
    } catch (e: any) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  function handleLogout() {
    if (orgId) localStorage.removeItem(`orgToken_${orgId}`);
    setOrgToken(null);
    window.location.href = `/org/${slug}/portal`;
  }

  function handleAuthenticated(token: string) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setShowAuth(false);
  }

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (!orgToken) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center space-y-6">
        {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-14 w-auto rounded-xl" />}
        <div>
          <h1 className="text-2xl font-bold">{org?.name}</h1>
          <p className="text-muted-foreground mt-1">Coach login required</p>
        </div>
        <Button size="lg" onClick={() => setShowAuth(true)}>Log In</Button>
        {showAuth && <OrgAuthModal orgId={orgId || ""} programName={org?.name || ""} onAuthenticated={handleAuthenticated} onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  // Build PlayerCard-compatible profile
  const playerCardProfile: PlayerCardProfile | null = profile ? {
    athlete: {
      id: profile.athlete.id,
      name: profile.athlete.name,
      email: profile.athlete.email,
      createdAt: profile.athlete.createdAt,
      memberSince: profile.orgMembership?.createdAt || null,
    },
    team: profile.teams[0] || { id: "", name: "—", sport: null, season: null, orgId: "" },
    bestPrs: profile.bestPrs.map((pr) => ({ liftTypeId: pr.liftTypeId, liftName: pr.liftName, unit: pr.unit, value: pr.bestValue, entryDate: pr.lastDate })),
    recentEntries: profile.recentEntries,
    upcomingBookings: profile.upcomingBookings,
    notes: profile.notes,
    stats: {
      totalEntries: profile.stats.totalEntries,
      liftTypes: profile.stats.liftTypes,
      upcomingSessions: profile.stats.upcomingSessions,
    },
  } : null;

  // PR History filtered list
  const allHistoryEntries = Object.values(profile?.prHistory || {}).flat();
  const filteredHistory = historyLiftFilter === "__all__"
    ? allHistoryEntries
    : (profile?.prHistory[historyLiftFilter] || []);
  const sortedHistory = [...filteredHistory].sort((a, b) => {
    if (historySort === "best") return b.value - a.value;
    return b.entryDate.localeCompare(a.entryDate);
  });

  const primaryTeam = profile?.teams[0];
  const backTeamId = primaryTeam?.id;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-3 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            {backTeamId ? (
              <a href={`/org/${slug}/coach/teams/${backTeamId}`} data-testid="link-back-team">
                <Button variant="ghost" size="sm" className="text-xs px-2">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Team
                </Button>
              </a>
            ) : (
              <a href={`/org/${slug}/coach/teams`} data-testid="link-back-teams">
                <Button variant="ghost" size="sm" className="text-xs px-2">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Teams
                </Button>
              </a>
            )}
            <a href={`/org/${slug}/portal`} data-testid="link-portal">
              <Button variant="ghost" size="sm" className="text-xs px-2" title="Portal">
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            </a>
          </div>

          <span className="font-semibold text-sm truncate max-w-[140px]" data-testid="nav-athlete-name">
            {profile?.athlete.name || "Athlete Profile"}
          </span>

          <div className="flex items-center gap-0.5">
            <Button size="sm" variant="ghost" onClick={() => refetch()} title="Refresh" data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={downloadCardPng} disabled={isCapturing || !profile} className="text-xs px-2" data-testid="button-download-card">
              {isCapturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="outline" onClick={exportPdf} disabled={isGeneratingPdf || !profile} className="text-xs px-2" data-testid="button-export-pdf">
              {isGeneratingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      {isLoading ? (
        <PageSkeleton />
      ) : !profile ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-4 opacity-30" />
          <p className="font-medium">Athlete not found</p>
          <p className="text-sm mt-1">You may not have access to this athlete's profile.</p>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

          {/* ── 1. Athlete Hero Card ─────────────────────────────────────── */}
          <Card className="p-5" data-testid="card-athlete-hero">
            <div className="flex items-start gap-4">
              <div className={`h-16 w-16 rounded-2xl ${avatarColor(profile.athlete.name)} text-white font-bold text-2xl flex items-center justify-center flex-shrink-0`}>
                {getInitials(profile.athlete.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold leading-tight" data-testid="text-athlete-name">{profile.athlete.name}</h1>
                <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-athlete-email">{profile.athlete.email}</p>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge variant="outline" className="text-xs" data-testid="badge-role">
                    {profile.orgMembership?.role || "member"}
                  </Badge>
                  {profile.teams.map((t) => (
                    <Badge key={t.id} variant="secondary" className="text-xs" data-testid={`badge-team-${t.id}`}>{t.name}</Badge>
                  ))}
                  {profile.teams[0]?.sport && (
                    <Badge variant="outline" className="text-xs">{profile.teams[0].sport}</Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
                  {profile.orgMembership?.createdAt && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3" /> Member since {safeFmt(profile.orgMembership.createdAt, "MMM yyyy")}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <BarChart2 className="h-3 w-3" /> {profile.stats.totalEntries} total PR entries
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarCheck className="h-3 w-3" /> {profile.stats.upcomingSessions} upcoming
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* ── 2. Quick Stat Cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2.5" data-testid="grid-stats">
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-emerald-500" data-testid="stat-total-entries">{profile.stats.totalEntries}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">PR Entries</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-amber-500" data-testid="stat-best-pr">
                {profile.bestPrs[0] ? profile.bestPrs[0].bestValue : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate px-1">
                {profile.bestPrs[0]?.liftName?.split(" ")[0] || "Best PR"}
              </p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-500" data-testid="stat-lift-types">{profile.stats.liftTypes}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Lift Types</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-violet-500" data-testid="stat-upcoming">{profile.stats.upcomingSessions}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Upcoming</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-cyan-500" data-testid="stat-teams">{profile.stats.teamsCount}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Teams</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-rose-400" data-testid="stat-past">{profile.stats.pastSessions}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Past Sessions</p>
            </Card>
          </div>

          {/* ── 3. Best PRs ─────────────────────────────────────────────── */}
          <section data-testid="section-best-prs">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-amber-400" /> Personal Records
            </h2>

            {profile.bestPrs.length === 0 ? (
              <Card className="p-6 text-center border-dashed">
                <Trophy className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-30" />
                <p className="text-sm text-muted-foreground">No PR entries yet</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {profile.bestPrs.map((pr, i) => (
                  <Card key={pr.liftTypeId} className="p-3.5 flex items-center gap-3" data-testid={`pr-card-${i}`}>
                    <div className="h-9 w-9 rounded-lg bg-amber-400/10 flex items-center justify-center flex-shrink-0">
                      <Star className="h-4 w-4 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate">{pr.liftName}</p>
                      <p className="text-xs text-muted-foreground">{pr.entryCount} entries · Last: {safeFmt(pr.lastDate)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-amber-500">{pr.bestValue} <span className="text-xs font-normal text-muted-foreground">{pr.unit}</span></p>
                      <p className="text-[10px] text-muted-foreground">best</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ── 4. PR History ────────────────────────────────────────────── */}
          <section data-testid="section-pr-history">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> PR History
              </h2>
              <div className="flex items-center gap-2">
                <Select value={historyLiftFilter} onValueChange={setHistoryLiftFilter}>
                  <SelectTrigger className="h-7 text-xs w-32" data-testid="select-lift-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All lifts</SelectItem>
                    {Object.entries(profile.prHistory).map(([liftTypeId, entries]) => (
                      <SelectItem key={liftTypeId} value={liftTypeId}>{entries[0]?.liftName || liftTypeId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={historySort} onValueChange={(v) => setHistorySort(v as any)}>
                  <SelectTrigger className="h-7 text-xs w-24" data-testid="select-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="best">Best</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sortedHistory.length === 0 ? (
              <Card className="p-5 text-center border-dashed">
                <p className="text-sm text-muted-foreground">No history entries</p>
              </Card>
            ) : (
              <div className="rounded-xl border overflow-hidden divide-y">
                {sortedHistory.slice(0, 20).map((e, i) => (
                  <div key={e.id || i} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors" data-testid={`history-row-${i}`}>
                    <div className="text-xs text-muted-foreground w-20 flex-shrink-0">{e.entryDate}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{e.liftName}</p>
                      {e.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{e.notes}</p>}
                    </div>
                    <div className="text-sm font-bold text-primary flex-shrink-0">{e.value} <span className="text-xs font-normal text-muted-foreground">{e.unit}</span></div>
                  </div>
                ))}
                {sortedHistory.length > 20 && (
                  <div className="px-4 py-2 text-xs text-center text-muted-foreground bg-muted/20">
                    +{sortedHistory.length - 20} more entries
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── 5. Bookings ─────────────────────────────────────────────── */}
          <section data-testid="section-bookings">
            <div className="flex items-center gap-0 border rounded-xl overflow-hidden mb-3">
              {(["upcoming", "past"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBookingTab(tab)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors capitalize ${bookingTab === tab ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:text-foreground"}`}
                  data-testid={`tab-booking-${tab}`}
                >
                  {tab === "upcoming" ? `Upcoming (${profile.upcomingBookings.length})` : `Past (${profile.pastBookings.length})`}
                </button>
              ))}
            </div>

            {bookingTab === "upcoming" && (
              profile.upcomingBookings.length === 0 ? (
                <Card className="p-5 text-center border-dashed">
                  <CalendarCheck className="h-6 w-6 mx-auto mb-2 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">No upcoming sessions</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {profile.upcomingBookings.map((b, i) => (
                    <Card key={b.id || i} className="p-3.5 flex items-center gap-3 border-emerald-500/20 bg-emerald-500/5" data-testid={`upcoming-booking-${i}`}>
                      <CalendarCheck className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{safeFmt(b.date)}</p>
                        <p className="text-xs text-muted-foreground">{b.timeSlot} · {b.trainingType}</p>
                      </div>
                      <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Scheduled</Badge>
                    </Card>
                  ))}
                </div>
              )
            )}

            {bookingTab === "past" && (
              profile.pastBookings.length === 0 ? (
                <Card className="p-5 text-center border-dashed">
                  <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">No past sessions</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {profile.pastBookings.slice(0, 10).map((b, i) => (
                    <Card key={b.id || i} className="p-3.5 flex items-center gap-3 opacity-70" data-testid={`past-booking-${i}`}>
                      <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{safeFmt(b.date)}</p>
                        <p className="text-xs text-muted-foreground">{b.timeSlot} · {b.trainingType}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">Completed</Badge>
                    </Card>
                  ))}
                </div>
              )
            )}
          </section>

          {/* ── 6. Team Membership ──────────────────────────────────────── */}
          {profile.teams.length > 0 && (
            <section data-testid="section-teams">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Team Membership
              </h2>
              <div className="space-y-2">
                {profile.teams.map((team) => (
                  <Card key={team.id} className="p-4 flex items-center gap-3" data-testid={`team-card-${team.id}`}>
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{team.name}</p>
                        {team.sport && <Badge variant="outline" className="text-xs">{team.sport}</Badge>}
                        {team.season && <Badge variant="secondary" className="text-xs">{team.season}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Joined {safeFmt(team.joinedAt, "MMM d, yyyy")}</p>
                    </div>
                    <a href={`/org/${slug}/coach/teams/${team.id}`} data-testid={`link-team-roster-${team.id}`}>
                      <Button size="sm" variant="ghost" className="text-xs">Roster</Button>
                    </a>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── 7. Coach Notes ──────────────────────────────────────────── */}
          <section data-testid="section-coach-notes">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Coach Notes <span className="normal-case text-muted-foreground/60">(private)</span>
              </h2>
              {profile.notesUpdatedAt && (
                <span className="text-xs text-muted-foreground">Updated {safeFmt(profile.notesUpdatedAt, "MMM d")}</span>
              )}
            </div>
            <Card className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Notes are visible only to coaches and appear on exported player cards.</p>
              <Textarea
                value={editingNotes}
                onChange={(e) => { setEditingNotes(e.target.value); setNotesSaved(false); }}
                placeholder="Add notes about this athlete's performance, form cues, goals, areas to improve…"
                className="min-h-[140px] text-sm font-mono resize-none"
                data-testid="textarea-coach-notes"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => saveNotesMutation.mutate()}
                  disabled={saveNotesMutation.isPending}
                  size="sm"
                  className="flex-1"
                  data-testid="button-save-notes"
                >
                  {saveNotesMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</>
                  ) : notesSaved ? (
                    <><CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-400" /> Saved</>
                  ) : (
                    <><Save className="h-4 w-4 mr-1.5" /> Save Notes</>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditingNotes(profile.notes || "")}>Reset</Button>
              </div>
            </Card>
          </section>

          {/* ── 8. PR Intelligence Panel ────────────────────────────────── */}
          <PRIntelligencePanel
            athleteUserId={userId}
            orgToken={orgToken}
            athleteName={profile.athlete.name}
            coachNotes={editingNotes}
          />

          {/* ── 9. Player Card Preview ──────────────────────────────────── */}
          <section data-testid="section-player-card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" /> Player Card
              </h2>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={downloadCardPng} disabled={isCapturing} data-testid="button-download-card-section">
                  {isCapturing ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Capturing…</> : <><Camera className="h-3.5 w-3.5 mr-1.5" /> PNG</>}
                </Button>
                <Button size="sm" variant="outline" onClick={exportPdf} disabled={isGeneratingPdf} data-testid="button-export-pdf-section">
                  {isGeneratingPdf ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</> : <><FileText className="h-3.5 w-3.5 mr-1.5" /> PDF</>}
                </Button>
              </div>
            </div>
            {playerCardProfile && (
              <Card className="overflow-hidden">
                <div className="bg-muted/30 text-xs text-muted-foreground px-3 py-2 border-b">Preview — use buttons above to export</div>
                <div className="overflow-auto" style={{ maxHeight: "320px" }}>
                  <div style={{ transform: "scale(0.58)", transformOrigin: "top left", width: "800px" }}>
                    <PlayerCard
                      ref={playerCardRef}
                      profile={playerCardProfile}
                      orgLogo={org?.logoUrl}
                      orgName={org?.name}
                    />
                  </div>
                </div>
              </Card>
            )}
          </section>

          {/* ── 9. Future Placeholders ──────────────────────────────────── */}
          <section data-testid="section-placeholders">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Coming Soon</h2>
            <div className="space-y-2">
              <ComingSoonCard
                icon={<Dumbbell className="h-4 w-4 text-muted-foreground" />}
                title="Workout History"
                description="Full session logs, workout programs, and training volume trends will appear here."
              />
              <ComingSoonCard
                icon={<Activity className="h-4 w-4 text-muted-foreground" />}
                title="Readiness Trends"
                description="Track athlete readiness scores, recovery, and sleep data over time."
              />
              <ComingSoonCard
                icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
                title="Attendance Trends"
                description="Attendance patterns, session streaks, and consistency metrics."
              />
            </div>
          </section>
        </div>
      )}

      {/* Hidden export canvas for PDF (full size, off-screen) */}
      {playerCardProfile && (
        <div style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "800px", pointerEvents: "none", zIndex: -1 }}>
          <PlayerCard
            ref={batchExportRef}
            profile={playerCardProfile}
            orgLogo={org?.logoUrl}
            orgName={org?.name}
          />
        </div>
      )}

      {/* PDF progress overlay */}
      {isGeneratingPdf && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <Card className="p-8 max-w-xs w-full mx-4 text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <div>
              <h3 className="font-bold">Generating PDF</h3>
              <p className="text-sm text-muted-foreground mt-1">Please wait…</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
