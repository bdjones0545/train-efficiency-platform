import { useState, useEffect, useRef } from "react";
import { ActivityFeed } from "@/components/activity-feed";
import PlayerCard from "@/components/pr-tracker/PlayerCard";
import type { PlayerCardProfile } from "@/components/pr-tracker/PlayerCard";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import {
  ArrowLeft,
  Users,
  Trophy,
  Search,
  Download,
  FileText,
  CalendarCheck,
  Star,
  ChevronRight,
  ClipboardList,
  Save,
  Loader2,
  X,
  Camera,
  CheckCircle2,
  Archive,
  AlertTriangle,
  UserMinus,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  entryCount: number;
  bestPr: { liftName: string; value: number; unit: string } | null;
}

interface AthleteProfile {
  athlete: { id: string; name: string; email: string; createdAt: string; memberSince: string | null };
  team: { id: string; name: string; sport: string | null; season: string | null; orgId: string };
  bestPrs: Array<{ liftTypeId: string; liftName: string; unit: string; value: number; entryDate: string }>;
  recentEntries: Array<{ id: string; liftName: string; value: number; unit: string; entryDate: string; notes: string | null }>;
  upcomingBookings: Array<{ id: string; date: string; timeSlot: string; teamName: string; trainingType: string }>;
  notes: string;
  stats: { totalEntries: number; liftTypes: number; upcomingSessions: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const avatarColors = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}


// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function RosterSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoachTeamDetailPage() {
  const params = useParams<{ slug: string; teamId: string }>();
  const slug = params.slug || "";
  const teamId = params.teamId || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: org } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const { hasAccess, isHydrating } = usePermissions(slug);

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setOrgToken(token))
      .catch(() => { localStorage.removeItem(`orgToken_${orgId}`); });
  }, [orgId]);

  // Team data
  const { data: teamData, isLoading: teamLoading } = useQuery<any>({
    queryKey: ["/api/org/coach/teams", teamId, orgToken, hasAccess],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch(`/api/org/coach/teams/${teamId}`, { headers, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!teamId && (!!orgToken || hasAccess),
  });

  // Athlete profile
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AthleteProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  function buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...getAuthHeaders() };
    if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
    return headers;
  }

  async function loadAthleteProfile(userId: string) {
    setSelectedUserId(userId);
    setSelectedProfile(null);
    setProfileLoading(true);
    try {
      const res = await fetch(`/api/org/coach/teams/${teamId}/athletes/${userId}`, {
        headers: buildAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setSelectedProfile(await res.json());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setSelectedUserId(null);
    } finally {
      setProfileLoading(false);
    }
  }

  // Coach notes
  const [editingNotes, setEditingNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"profile" | "notes">("profile");

  useEffect(() => {
    if (selectedProfile) setEditingNotes(selectedProfile.notes || "");
  }, [selectedProfile]);

  const saveNotesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/teams/${teamId}/athletes/${selectedUserId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ notes: editingNotes }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      if (selectedProfile) setSelectedProfile({ ...selectedProfile, notes: editingNotes });
      toast({ title: "Notes saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Archive team dialog
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveNameInput, setArchiveNameInput] = useState("");

  // Remove athlete dialog
  const [removeAthleteTarget, setRemoveAthleteTarget] = useState<TeamMember | null>(null);

  const canManageTeam = teamData?.canManageTeam ?? false;

  // Archive team mutation
  const archiveTeamMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/teams/${teamId}`, {
        method: "DELETE",
        headers: { ...buildAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Team archived", description: "The team has been removed from active views. All athlete records are preserved." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/coach/teams"] });
      queryClient.invalidateQueries({ queryKey: ["org-activity"] });
      setLocation(`/org/${slug}/coach/teams`);
    },
    onError: (e: any) => toast({ title: "Failed to archive team", description: e.message, variant: "destructive" }),
  });

  // Remove athlete mutation
  const removeAthleteMutation = useMutation({
    mutationFn: async (athleteId: string) => {
      const res = await fetch(`/api/org/coach/teams/${teamId}/athletes/${athleteId}`, {
        method: "DELETE",
        headers: { ...buildAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Athlete removed", description: "The athlete has been removed from this team. Their profile and history remain intact." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/coach/teams", teamId, orgToken, hasAccess] });
      queryClient.invalidateQueries({ queryKey: ["org-activity"] });
      setRemoveAthleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Failed to remove athlete", description: e.message, variant: "destructive" }),
  });

  // Search
  const [search, setSearch] = useState("");
  const members: TeamMember[] = teamData?.members || [];
  const filteredMembers = members.filter(
    (m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase())
  );

  // Screenshot ref for visible player card (in dialog)
  const playerCardRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  async function downloadPlayerCardPng() {
    if (!playerCardRef.current || !selectedProfile) return;
    setIsCapturing(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(playerCardRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `${selectedProfile.athlete.name.replace(/\s+/g, "-")}-player-card.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "Player card downloaded" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
  }

  // Batch PDF export
  const batchExportRef = useRef<HTMLDivElement>(null);
  const [batchProfile, setBatchProfile] = useState<AthleteProfile | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, name: "" });

  async function exportTeamPdf() {
    if (!members.length) return;
    setIsGeneratingPdf(true);
    setPdfProgress({ current: 0, total: members.length, name: "" });

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      let firstPage = true;

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        setPdfProgress({ current: i + 1, total: members.length, name: member.name });

        try {
          const res = await fetch(`/api/org/coach/teams/${teamId}/athletes/${member.userId}`, {
            headers: buildAuthHeaders(),
            credentials: "include",
          });
          if (!res.ok) continue;
          const profile: AthleteProfile = await res.json();

          setBatchProfile(profile);
          await new Promise<void>((resolve) => setTimeout(resolve, 700));

          if (!batchExportRef.current) continue;

          const canvas = await html2canvas(batchExportRef.current, {
            scale: 2,
            backgroundColor: "#ffffff",
            useCORS: true,
            allowTaint: true,
            logging: false,
          });

          if (!firstPage) pdf.addPage();
          firstPage = false;

          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const ratio = canvas.height / canvas.width;
          const imgH = Math.min(pageW * ratio, pageH);
          pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, imgH);
        } catch {
          // Skip failed athlete
        }
      }

      setBatchProfile(null);
      pdf.save(`${teamData?.team?.name || "team"}-report-${new Date().toISOString().split("T")[0]}.pdf`);
      toast({ title: "Team PDF exported", description: `${members.length} athlete card${members.length !== 1 ? "s" : ""} included` });
    } catch (e: any) {
      toast({ title: "PDF export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
      setBatchProfile(null);
      setPdfProgress({ current: 0, total: 0, name: "" });
    }
  }

  function handleAuthenticated(token: string) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setShowAuth(false);
  }

  // ── Auth guard ──────────────────────────────────────────────────────────
  if (!orgToken && !hasAccess && !isHydrating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center space-y-6">
        {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-14 w-auto rounded-xl" />}
        <div>
          <h1 className="text-2xl font-bold">{org?.name}</h1>
          <p className="text-muted-foreground mt-1">Coach login required</p>
        </div>
        <Button size="lg" onClick={() => setShowAuth(true)}>Log In</Button>
        {showAuth && (
          <OrgAuthModal orgId={orgId || ""} programName={org?.name || ""} onAuthenticated={handleAuthenticated} onClose={() => setShowAuth(false)} />
        )}
      </div>
    );
  }

  const team = teamData?.team;

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <a href={`/org/${slug}/coach/teams`} data-testid="link-back-teams">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Teams
            </Button>
          </a>
          <span className="font-semibold text-sm truncate max-w-[180px]">{team?.name || "Team Roster"}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={exportTeamPdf}
            disabled={isGeneratingPdf || !members.length}
            data-testid="button-export-pdf"
          >
            {isGeneratingPdf ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {pdfProgress.current}/{pdfProgress.total}</>
            ) : (
              <><FileText className="h-3.5 w-3.5 mr-1.5" /> Export PDF</>
            )}
          </Button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 pt-6 space-y-5">
        {/* Team Info Banner */}
        {team && (
          <Card className="p-4" data-testid="card-team-info">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold" data-testid="text-team-name">{team.name}</h1>
                  {team.sport && <Badge variant="outline" className="text-xs">{team.sport}</Badge>}
                  {team.season && <Badge variant="secondary" className="text-xs">{team.season}</Badge>}
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                  <span>{members.length} athlete{members.length !== 1 ? "s" : ""}</span>
                  <span className="flex items-center gap-1.5">
                    Join code:
                    <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded font-bold tracking-widest" data-testid="text-join-code">
                      {team.joinCode}
                    </code>
                  </span>
                </div>
              </div>
              {canManageTeam && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive flex-shrink-0"
                  onClick={() => { setShowArchiveConfirm(true); setArchiveNameInput(""); }}
                  data-testid="button-archive-team"
                >
                  <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search athletes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-athletes"
          />
        </div>

        {/* Athlete Grid */}
        {teamLoading ? (
          <RosterSkeleton />
        ) : filteredMembers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{search ? "No athletes match your search" : "No athletes in this team yet"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredMembers.map((member) => (
              <button
                key={member.userId}
                onClick={() => loadAthleteProfile(member.userId)}
                className="text-left"
                data-testid={`card-athlete-${member.userId}`}
              >
                <Card className="p-4 h-full hover:border-primary/40 transition-colors cursor-pointer group space-y-3">
                  {/* Avatar + name */}
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className={`h-12 w-12 rounded-full ${avatarColor(member.name)} text-white font-bold text-lg flex items-center justify-center`}>
                      {getInitials(member.name)}
                    </div>
                    <div>
                      <p className="font-semibold text-sm leading-tight" data-testid={`text-athlete-name-${member.userId}`}>{member.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[120px]">{member.email}</p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-1.5 text-center">
                    <div className="rounded-lg bg-muted/50 py-1.5">
                      <p className="text-sm font-bold">{member.entryCount}</p>
                      <p className="text-[10px] text-muted-foreground">PRs</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 py-1.5">
                      {member.bestPr ? (
                        <>
                          <p className="text-sm font-bold text-amber-500">{member.bestPr.value}</p>
                          <p className="text-[10px] text-muted-foreground truncate px-1">{member.bestPr.liftName?.split(" ")[0]}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-muted-foreground">—</p>
                          <p className="text-[10px] text-muted-foreground">Best</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1 mt-1">
                    <span
                      className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                      onClick={(e) => { e.preventDefault(); loadAthleteProfile(member.userId); }}
                    >
                      Quick view
                    </span>
                    <a
                      href={`/org/${slug}/coach/athletes/${member.userId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-primary font-medium flex items-center gap-0.5 hover:underline"
                      data-testid={`link-athlete-profile-${member.userId}`}
                    >
                      Full Profile <ChevronRight className="h-3 w-3" />
                    </a>
                  </div>
                  {canManageTeam && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRemoveAthleteTarget(member); }}
                      className="w-full mt-1.5 text-[10px] text-destructive/60 hover:text-destructive flex items-center justify-center gap-1 py-0.5 rounded hover:bg-destructive/5 transition-colors"
                      data-testid={`button-remove-athlete-${member.userId}`}
                    >
                      <UserMinus className="h-3 w-3" /> Remove
                    </button>
                  )}
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Athlete Profile Dialog ──────────────────────────────────────── */}
      <Dialog open={!!selectedUserId} onOpenChange={(open) => { if (!open) { setSelectedUserId(null); setSelectedProfile(null); setActiveTab("profile"); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            {selectedProfile ? (
              <div className="flex items-center gap-4">
                <div className={`h-12 w-12 rounded-full ${avatarColor(selectedProfile.athlete.name)} text-white font-bold text-lg flex items-center justify-center flex-shrink-0`}>
                  {getInitials(selectedProfile.athlete.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-lg font-bold" data-testid="text-dialog-athlete-name">
                    {selectedProfile.athlete.name}
                  </DialogTitle>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">{selectedProfile.athlete.email}</span>
                    {selectedProfile.team.sport && <Badge variant="outline" className="text-xs">{selectedProfile.team.sport}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <a
                    href={`/org/${slug}/coach/athletes/${selectedProfile?.athlete.id}`}
                    data-testid="link-full-profile"
                  >
                    <Button size="sm" variant="outline" className="text-xs">
                      Full Profile
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    onClick={downloadPlayerCardPng}
                    disabled={isCapturing}
                    data-testid="button-download-player-card"
                  >
                    {isCapturing ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Capturing…</>
                    ) : (
                      <><Camera className="h-4 w-4 mr-1.5" /> Card</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <DialogTitle>Loading…</DialogTitle>
            )}
          </DialogHeader>

          {/* Tabs */}
          {selectedProfile && (
            <div className="flex border-b flex-shrink-0 px-6">
              {(["profile", "notes"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                    activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "profile" ? "Performance" : "Coach Notes"}
                </button>
              ))}
            </div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {profileLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {selectedProfile && activeTab === "profile" && (
              <div className="p-6 space-y-6">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  <Card className="p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-500" data-testid="stat-total-entries">{selectedProfile.stats.totalEntries}</p>
                    <p className="text-xs text-muted-foreground">Total Entries</p>
                  </Card>
                  <Card className="p-3 text-center">
                    <p className="text-2xl font-bold text-blue-500" data-testid="stat-lift-types">{selectedProfile.stats.liftTypes}</p>
                    <p className="text-xs text-muted-foreground">Lift Types</p>
                  </Card>
                  <Card className="p-3 text-center">
                    <p className="text-2xl font-bold text-violet-500" data-testid="stat-upcoming">{selectedProfile.stats.upcomingSessions}</p>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </Card>
                </div>

                {/* Best PRs */}
                {selectedProfile.bestPrs.length > 0 ? (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 text-amber-400" /> Personal Records
                    </h3>
                    <div className="space-y-2">
                      {selectedProfile.bestPrs.map((pr, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border" data-testid={`pr-row-${i}`}>
                          <Star className="h-4 w-4 text-amber-400 flex-shrink-0" />
                          <span className="flex-1 text-sm font-medium">{pr.liftName}</span>
                          <Badge className="bg-amber-400/20 text-amber-700 dark:text-amber-300 border-amber-400/30 font-mono">
                            {pr.value} {pr.unit}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{pr.entryDate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground border rounded-lg">
                    <Trophy className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No PR entries yet</p>
                  </div>
                )}

                {/* Recent Entries */}
                {selectedProfile.recentEntries.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" /> Recent Entries
                    </h3>
                    <div className="rounded-lg border divide-y overflow-hidden">
                      {selectedProfile.recentEntries.map((e, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5" data-testid={`entry-row-${i}`}>
                          <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{e.entryDate}</span>
                          <span className="flex-1 text-sm">{e.liftName}</span>
                          <span className="text-sm font-bold text-primary">{e.value} {e.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upcoming Sessions */}
                {selectedProfile.upcomingBookings.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                      <CalendarCheck className="h-3.5 w-3.5" /> Upcoming Sessions
                    </h3>
                    <div className="space-y-2">
                      {selectedProfile.upcomingBookings.map((b, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20" data-testid={`booking-row-${i}`}>
                          <CalendarCheck className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{b.date}</p>
                            <p className="text-xs text-muted-foreground">{b.timeSlot} · {b.trainingType}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hidden player card for screenshot */}
                <div className="overflow-hidden rounded-xl border" style={{ maxHeight: "300px" }}>
                  <div className="text-xs text-muted-foreground px-3 py-2 bg-muted border-b flex items-center justify-between">
                    <span className="flex items-center gap-1"><Camera className="h-3 w-3" /> Player Card Preview</span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={downloadPlayerCardPng} disabled={isCapturing}>
                      {isCapturing ? "…" : "Download PNG"}
                    </Button>
                  </div>
                  <div className="overflow-auto" style={{ maxHeight: "240px" }}>
                    <div style={{ transform: "scale(0.6)", transformOrigin: "top left", width: "800px" }}>
                      <PlayerCard
                        ref={playerCardRef}
                        profile={selectedProfile}
                        orgLogo={org?.logoUrl}
                        orgName={org?.name}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedProfile && activeTab === "notes" && (
              <div className="p-6 space-y-4">
                <div className="text-sm text-muted-foreground">
                  Notes are private to coaches and appear on the player card when exported.
                </div>
                <Textarea
                  value={editingNotes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  placeholder="Add notes about this athlete's performance, goals, areas to improve…"
                  className="min-h-[200px] font-mono text-sm"
                  data-testid="textarea-coach-notes"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNotesMutation.mutate()}
                    disabled={saveNotesMutation.isPending}
                    className="flex-1"
                    data-testid="button-save-notes"
                  >
                    {saveNotesMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</>
                    ) : (
                      <><Save className="h-4 w-4 mr-1.5" /> Save Notes</>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setEditingNotes(selectedProfile.notes || "")}>
                    Reset
                  </Button>
                </div>

                {/* Preview of current notes */}
                {selectedProfile.notes && (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Saved notes
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-foreground">{selectedProfile.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Archive Team Confirmation Dialog ────────────────────────────── */}
      <Dialog open={showArchiveConfirm} onOpenChange={(open) => { if (!open) setShowArchiveConfirm(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Archive Team
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">This team will be removed from all active views.</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">Athletes, PRs, workouts, and all historical records will be fully preserved.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Type <strong>{team?.name}</strong> to confirm:</p>
              <Input
                value={archiveNameInput}
                onChange={(e) => setArchiveNameInput(e.target.value)}
                placeholder={team?.name}
                data-testid="input-archive-confirm"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowArchiveConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={archiveNameInput !== team?.name || archiveTeamMutation.isPending}
                onClick={() => archiveTeamMutation.mutate()}
                data-testid="button-confirm-archive"
              >
                {archiveTeamMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archive Team"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Remove Athlete Confirmation Dialog ───────────────────────────── */}
      <Dialog open={!!removeAthleteTarget} onOpenChange={(open) => { if (!open) setRemoveAthleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserMinus className="h-4 w-4 text-destructive" /> Remove Athlete
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remove <strong className="text-foreground">{removeAthleteTarget?.name}</strong> from <strong className="text-foreground">{team?.name}</strong>?
            </p>
            <p className="text-xs text-muted-foreground">
              Their PRs, workout history, education progress, and profile will remain completely intact. Only their membership in this team will be removed.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemoveAthleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={removeAthleteMutation.isPending}
                onClick={() => removeAthleteTarget && removeAthleteMutation.mutate(removeAthleteTarget.userId)}
                data-testid="button-confirm-remove-athlete"
              >
                {removeAthleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove from Team"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Team Activity Feed ───────────────────────────────────────────── */}
      <div className="px-4 pb-4" data-testid="section-team-activity">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> Recent Team Activity
        </h2>
        <ActivityFeed teamId={teamId} limit={15} />
      </div>

      {/* ── Batch PDF Export Progress Overlay ──────────────────────────── */}
      {isGeneratingPdf && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <Card className="p-8 max-w-sm w-full mx-4 text-center space-y-4" data-testid="card-export-progress">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Generating Team PDF</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Processing {pdfProgress.current} of {pdfProgress.total}
              </p>
              {pdfProgress.name && (
                <p className="text-xs text-primary mt-2 font-medium">{pdfProgress.name}</p>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${pdfProgress.total ? (pdfProgress.current / pdfProgress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Please wait, do not close this tab</p>
          </Card>
        </div>
      )}

      {/* ── Hidden batch export canvas (off-screen) ─────────────────────── */}
      <div style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "800px", pointerEvents: "none", zIndex: -1 }}>
        {batchProfile && (
          <PlayerCard
            ref={batchExportRef}
            profile={batchProfile}
            orgLogo={org?.logoUrl}
            orgName={org?.name}
          />
        )}
      </div>
    </div>
  );
}
