import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Calendar, Clock, Filter, MapPin, Trash2, Users, UserPlus, UserMinus,
  Plus, X, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid,
  List, AlertCircle, CheckCircle2, Clock3, Dumbbell, SlidersHorizontal,
  TrendingUp, DollarSign, Sparkles, Star, Zap, Target
} from "lucide-react";
import { useState, useMemo } from "react";
import {
  format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, addDays, addWeeks, addMonths,
  subDays, subWeeks, subMonths, isSameDay, isSameMonth,
  eachDayOfInterval, differenceInMinutes, isToday, isBefore, isAfter
} from "date-fns";
import type { OpenSession, ParticipantWithUser } from "@/lib/types";
import type { UserProfile } from "@shared/schema";
import { AddSessionDialog } from "@/components/add-session-dialog";

// ─── Session Performance Badge (coaches only) ───────────────────────────────
function SessionPerformanceBadge({ bookingId }: { bookingId: string }) {
  const { data, isLoading } = useQuery<{ score: number; label: string; breakdown: any }>({
    queryKey: ["/api/scheduling/session-performance", bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/session-performance/${bookingId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });
  if (isLoading) return <Skeleton className="h-6 w-24" />;
  if (!data) return null;
  const colorClass = data.score >= 75
    ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20"
    : data.score >= 50
    ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
    : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
  return (
    <div className="flex items-center gap-2" data-testid="session-performance-badge">
      <Zap className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">Performance</span>
      <Badge className={`text-xs ${colorClass}`}>{data.label} · {data.score}</Badge>
    </div>
  );
}

// ─── Athlete Recommendations Panel (non-coach users) ────────────────────────
function AthleteRecommendationsPanel({ userId, currentSessionId }: { userId?: string; currentSessionId: string }) {
  const { data, isLoading } = useQuery<{ recommendations: any[]; hasProfile: boolean }>({
    queryKey: ["/api/scheduling/athlete-recommendations", userId],
    queryFn: async () => {
      if (!userId) return { recommendations: [], hasProfile: false };
      const res = await fetch(`/api/scheduling/athlete-recommendations/${userId}`, { credentials: "include" });
      if (!res.ok) return { recommendations: [], hasProfile: false };
      return res.json();
    },
    enabled: !!userId,
    retry: false,
  });
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data || data.recommendations.length === 0) return null;

  const others = data.recommendations.filter(r => r.sessionId !== currentSessionId).slice(0, 3);
  if (others.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="athlete-recommendations-panel">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recommended For You</p>
      </div>
      <div className="space-y-2">
        {others.map((r) => (
          <div key={r.sessionId} className="flex items-start justify-between gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{r.serviceName}</p>
              <p className="text-[10px] text-muted-foreground">{r.startAt ? format(new Date(r.startAt), "EEE MMM d · h:mm a") : ""}</p>
              {r.matchReasons.length > 0 && (
                <p className="text-[10px] text-primary mt-0.5">{r.matchReasons[0]}</p>
              )}
            </div>
            <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0">
              {r.matchScore}% match
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recommended For You strip (top of page, athletes only) ──────────────────
function RecommendedForYouStrip({
  userId, sessions, onSessionClick
}: { userId: string; sessions: OpenSession[]; onSessionClick: (s: OpenSession) => void }) {
  const { data, isLoading } = useQuery<{ recommendations: any[] }>({
    queryKey: ["/api/scheduling/athlete-recommendations", userId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/athlete-recommendations/${userId}`, { credentials: "include" });
      if (!res.ok) return { recommendations: [] };
      return res.json();
    },
    enabled: !!userId,
    retry: false,
    staleTime: 300000,
  });

  const sessionMap = new Map(sessions.map(s => [s.id, s]));

  if (isLoading) return (
    <div className="space-y-2" data-testid="recommended-for-you-strip">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Recommended For You</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-56 shrink-0 rounded-lg" />)}
      </div>
    </div>
  );

  const recs = (data?.recommendations || []).slice(0, 5);
  if (recs.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="recommended-for-you-strip">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Recommended For You</p>
        <Badge variant="secondary" className="text-xs ml-auto">Based on your training history</Badge>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {recs.map((r: any) => {
          const session = sessionMap.get(r.sessionId);
          return (
            <button
              key={r.sessionId}
              onClick={() => session && onSessionClick(session)}
              disabled={!session}
              className="shrink-0 w-52 rounded-lg border bg-card p-3 text-left shadow-sm hover:shadow-md hover:border-primary/40 transition-all disabled:opacity-50 cursor-pointer"
              data-testid={`rec-session-${r.sessionId}`}
            >
              <div className="flex items-start justify-between gap-1.5 mb-1.5">
                <p className="text-sm font-medium truncate leading-tight">{r.serviceName}</p>
                <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0 h-4 px-1">
                  {r.matchScore}%
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mb-1">
                {r.startAt ? format(new Date(r.startAt), "EEE MMM d · h:mm a") : ""}
              </p>
              {r.matchReasons?.length > 0 && (
                <p className="text-[10px] text-primary truncate">{r.matchReasons[0]}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Fill Campaign Button (coaches only, for open sessions) ──────────────────
function CoachFillCampaignButton({ session }: { session: OpenSession }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; smsBody: string; emailBody: string } | null>(null);
  const count = session.participantCount || 0;
  const max = session.maxParticipants || 6;
  const openSpots = max - count;
  if (openSpots === 0) return null;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/scheduling/fill-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId: session.id,
          sessionName: session.service?.name || "Group Session",
          startAt: session.startAt,
          openSpots,
          coachName: session.coach?.user ? `${session.coach.user.firstName} ${session.coach.user.lastName}` : "",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      setDraft({ subject: data.subject, smsBody: data.smsBody, emailBody: data.emailBody });
      setOpen(true);
    },
    onError: () => toast({ title: "Failed to generate campaign", variant: "destructive" }),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        data-testid={`button-fill-campaign-${session.id}`}
      >
        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
        {generateMutation.isPending ? "Generating…" : `Generate Fill Campaign (${openSpots} spots)`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Fill Campaign Draft
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Subject</p>
                <p className="p-2 bg-muted/50 rounded text-sm">{draft.subject}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">SMS</p>
                <p className="p-2 bg-muted/50 rounded text-sm whitespace-pre-wrap">{draft.smsBody}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Email Body</p>
                <p className="p-2 bg-muted/50 rounded text-sm whitespace-pre-wrap">{draft.emailBody}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" onClick={() => { setOpen(false); toast({ title: "Campaign saved to drafts" }); }}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Saved to Drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type CalendarView = "month" | "week" | "day";

interface Filters {
  sport: string;
  location: string;
  ageGroup: string;
  skillLevel: string;
  availability: string;
  sessionType: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSessionStatus(session: OpenSession): "Open" | "Full" | "Cancelled" | "Waitlist" {
  if (session.status === "CANCELLED") return "Cancelled";
  const count = session.participantCount || 0;
  const max = session.maxParticipants || 6;
  if (count >= max) return "Full";
  return "Open";
}

function getStatusBadge(status: string) {
  switch (status) {
    case "Open":
      return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20 text-xs">{status}</Badge>;
    case "Full":
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20 text-xs">{status}</Badge>;
    case "Cancelled":
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 text-xs">{status}</Badge>;
    case "Waitlist":
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20 text-xs">{status}</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function getStatusDotClass(status: string) {
  switch (status) {
    case "Open": return "bg-green-500";
    case "Full": return "bg-orange-500";
    case "Cancelled": return "bg-red-400";
    default: return "bg-muted-foreground";
  }
}

function sessionDuration(session: OpenSession): string {
  try {
    const start = parseISO(session.startAt as unknown as string);
    const end = parseISO(session.endAt as unknown as string);
    const mins = differenceInMinutes(end, start);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } catch {
    return "";
  }
}

// ─── Filter Panel ───────────────────────────────────────────────────────────

function FilterPanel({
  sessions, filters, setFilters, open, onToggle
}: {
  sessions: OpenSession[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const sports = Array.from(new Set(sessions.map(s => s.sport).filter((x): x is string => !!x && x.trim() !== ""))).sort();
  const locations = Array.from(new Set(sessions.map(s => s.location).filter((x): x is string => !!x && x.trim() !== ""))).sort();
  const ageGroups = Array.from(new Set(sessions.map(s => s.ageRange).filter((x): x is string => !!x && x.trim() !== ""))).sort();

  const hasActive = Object.values(filters).some(v => v !== "all");

  const clear = () => setFilters({ sport: "all", location: "all", ageGroup: "all", skillLevel: "all", availability: "all", sessionType: "all" });

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          className="gap-2 h-9"
          data-testid="button-toggle-filters"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {hasActive && <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground rounded-full">{Object.values(filters).filter(v => v !== "all").length}</Badge>}
        </Button>
        {hasActive && (
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clear} data-testid="button-clear-filters">
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 p-4 rounded-lg border bg-muted/30 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Availability</Label>
            <Select value={filters.availability} onValueChange={v => setFilters({ ...filters, availability: v })}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-availability"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="Full">Full</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Skill Level</Label>
            <Select value={filters.skillLevel} onValueChange={v => setFilters({ ...filters, skillLevel: v })}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-skill-level"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="Beginner">Beginner</SelectItem>
                <SelectItem value="Intermediate">Intermediate</SelectItem>
                <SelectItem value="Advanced">Advanced</SelectItem>
                <SelectItem value="All Levels">All Levels</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sports.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sport</Label>
              <Select value={filters.sport} onValueChange={v => setFilters({ ...filters, sport: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-sport"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  {sports.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {locations.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Select value={filters.location} onValueChange={v => setFilters({ ...filters, location: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-location"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {ageGroups.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Age Group</Label>
              <Select value={filters.ageGroup} onValueChange={v => setFilters({ ...filters, ageGroup: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-age-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Ages</SelectItem>
                  {ageGroups.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Athlete Compatibility Badge ─────────────────────────────────────────────

function CompatibilityBadge({ session, userId }: { session: OpenSession; userId?: string }) {
  const { data: profile } = useQuery<any>({
    queryKey: ["/api/scheduling/athlete-profile"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling/athlete-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!userId,
  });

  if (!userId || !profile) return null;
  if (!session.sport && !session.ageRange && !session.skillLevel) return null;

  let score = 0;
  let total = 0;

  if (session.sport && profile.sport) {
    total++;
    if ((profile.sport || "").toLowerCase() === session.sport.toLowerCase()) score++;
  }
  if (session.ageRange && profile.birthYear) {
    const parts = session.ageRange.match(/(\d+)[–\-](\d+)/);
    if (parts) {
      const min = parseInt(parts[1]), max = parseInt(parts[2]);
      const age = new Date().getFullYear() - parseInt(profile.birthYear);
      total++;
      if (age >= min && age <= max) score++;
    }
  }
  if (session.skillLevel && profile.trainingLevel) {
    total++;
    if ((profile.trainingLevel || "").toLowerCase() === session.skillLevel.toLowerCase()) score++;
  }

  if (total === 0) return null;

  const pct = score / total;
  const { emoji, label, cls } = pct === 1
    ? { emoji: "🟢", label: "Great Match", cls: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" }
    : pct >= 0.5
    ? { emoji: "🟡", label: "Good Match", cls: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" }
    : { emoji: "🔴", label: "Low Match", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" };

  return (
    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium ${cls}`} data-testid={`compatibility-badge-${session.id}`}>
      <span>{emoji}</span>
      <span>Compatibility: {label}</span>
      <span className="ml-auto text-muted-foreground font-normal">({score}/{total} factors)</span>
    </div>
  );
}

// ─── Revenue Intelligence Panel ───────────────────────────────────────────────

function RevenuePanel({ bookingId }: { bookingId: string }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/scheduling/session-revenue", bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/session-revenue/${bookingId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (!data) return null;

  const { capacity, registered, sessionRevenueCents, maxRevenueCents, utilizationPct } = data;

  return (
    <div className="space-y-2" data-testid={`revenue-panel-${bookingId}`}>
      <p className="text-sm font-medium flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 text-primary" />Revenue Intelligence
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground">Actual Rev.</p>
          <p className="font-semibold text-sm">${((sessionRevenueCents || 0) / 100).toFixed(0)}</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground">Max Possible</p>
          <p className="font-semibold text-sm">${((maxRevenueCents || 0) / 100).toFixed(0)}</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground">Utilization</p>
          <p className={`font-semibold text-sm ${(utilizationPct || 0) >= 80 ? "text-green-600 dark:text-green-400" : (utilizationPct || 0) >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
            {utilizationPct || 0}%
          </p>
        </div>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all ${(utilizationPct || 0) >= 80 ? "bg-green-500" : (utilizationPct || 0) >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
          style={{ width: `${Math.min(100, utilizationPct || 0)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Attendance Panel (coaches only, past sessions) ───────────────────────────

function AttendancePanel({ bookingId, participants, sessionId }: { bookingId: string; participants: ParticipantWithUser[] | undefined; sessionId: string }) {
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const mark = async (participantId: string, userId: string, status: string) => {
    setSaving(s => ({ ...s, [participantId]: true }));
    try {
      const res = await fetch(`/api/scheduling/attendance/${bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ participantUserId: userId, status }),
      });
      if (!res.ok) throw new Error("Failed");
      setStatuses(s => ({ ...s, [participantId]: status }));
      toast({ title: "Attendance saved" });
    } catch {
      toast({ title: "Error", description: "Could not save attendance", variant: "destructive" });
    } finally {
      setSaving(s => ({ ...s, [participantId]: false }));
    }
  };

  if (!participants || participants.length === 0) return null;

  const opts = [
    { value: "PRESENT", label: "✓ Present", active: "bg-green-500/20 text-green-700 dark:text-green-300 ring-1 ring-green-500/30" },
    { value: "LATE", label: "Late", active: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 ring-1 ring-yellow-500/30" },
    { value: "ABSENT", label: "Absent", active: "bg-red-500/20 text-red-700 dark:text-red-300 ring-1 ring-red-500/30" },
    { value: "EXCUSED", label: "Excused", active: "bg-blue-500/20 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30" },
  ];

  return (
    <div className="space-y-2" data-testid={`attendance-panel-${bookingId}`}>
      <p className="text-sm font-medium flex items-center gap-1.5">
        <CheckCircle2 className="h-4 w-4 text-primary" />Mark Attendance
      </p>
      <div className="space-y-2">
        {participants.map((p: any) => {
          const name = p.participantName || `${p.user?.firstName || ""} ${p.user?.lastName || ""}`.trim() || "Athlete";
          const cur = statuses[p.id];
          return (
            <div key={p.id} className="flex items-center gap-2 flex-wrap" data-testid={`attendance-row-${p.id}`}>
              <span className="text-xs font-medium min-w-[80px] truncate">{name}</span>
              <div className="flex gap-1">
                {opts.map(o => (
                  <button
                    key={o.value}
                    onClick={() => mark(p.id, p.userId || (p as any).user_id || "", o.value)}
                    disabled={saving[p.id]}
                    className={`text-[10px] px-2 py-0.5 rounded border font-medium transition-colors ${cur === o.value ? o.active : "bg-muted/40 text-muted-foreground hover:bg-muted/70 border-transparent"}`}
                    data-testid={`button-attendance-${p.id}-${o.value.toLowerCase()}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Session Detail Modal ───────────────────────────────────────────────────

function SessionDetailModal({
  session, userId, isAuthenticated, isCoach, onClose
}: {
  session: OpenSession | null;
  userId?: string;
  isAuthenticated: boolean;
  isCoach: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [joinParticipantNames, setJoinParticipantNames] = useState<string[]>([""]);

  const { data: participants, isLoading: participantsLoading } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", session?.id, "participants"],
    enabled: !!session,
  });

  const { data: waitlist } = useQuery<any[]>({
    queryKey: ["/api/bookings", session?.id, "waitlist"],
    enabled: !!session,
  });

  const hasJoined = !!(userId && participants?.some((p) => p.userId === userId));
  const onWaitlist = !!(userId && waitlist?.some((w: any) => w.user_id === userId));

  const status = session ? getSessionStatus(session) : "Open";
  const spotsRemaining = session ? (session.maxParticipants || 6) - (session.participantCount || 0) : 0;
  const isFull = spotsRemaining <= 0;

  const joinMutation = useMutation({
    mutationFn: async (data?: { participantNames?: string[] }) => {
      const res = await apiRequest("POST", `/api/bookings/${session!.id}/join`, data || {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Registered", description: "You've been added to this session." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session!.id, "participants"] });
      setShowJoinDialog(false);
      setJoinParticipantNames([""]);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Please log in", description: "You need to be logged in to join.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/bookings/${session!.id}/leave`);
    },
    onSuccess: () => {
      toast({ title: "Unregistered", description: "You've been removed from this session." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session!.id, "participants"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const waitlistJoinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bookings/${session!.id}/waitlist`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Added to Waitlist", description: "You'll be notified if a spot opens up." });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session!.id, "waitlist"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Please log in", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const waitlistLeaveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/bookings/${session!.id}/waitlist`);
    },
    onSuccess: () => {
      toast({ title: "Removed from Waitlist", description: "You've been removed from the waitlist." });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session!.id, "waitlist"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/coach/bookings/${session!.id}`);
    },
    onSuccess: () => {
      toast({ title: "Session Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      setShowDeleteConfirm(false);
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleJoinConfirm = () => {
    const filled = joinParticipantNames.filter(n => n.trim());
    joinMutation.mutate(filled.length > 0 ? { participantNames: filled } : undefined);
  };

  const isOwner = isCoach && session?.coach?.userId === userId;

  if (!session) return null;

  const startDate = parseISO(session.startAt as unknown as string);
  const endDate = parseISO(session.endAt as unknown as string);
  const duration = sessionDuration(session);

  return (
    <>
      <Dialog open={!!session} onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0" data-testid="modal-session-detail">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-semibold leading-tight">
                  {session.service?.name || "Group Session"}
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {getStatusBadge(status)}
                  {hasJoined && <Badge className="bg-primary/15 text-primary border-primary/20 text-xs">Registered</Badge>}
                  {onWaitlist && <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 text-xs">On Waitlist</Badge>}
                </div>
              </div>
              {isOwner && (
                <Button size="icon" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)} data-testid={`button-delete-session-${session.id}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 px-6">
            <div className="py-4 space-y-4">
              {session.groupDescription && (
                <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-group-desc-${session.id}`}>
                  {session.groupDescription}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-start gap-2 text-sm">
                  <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium">{format(startDate, "EEEE, MMM d")}</p>
                    <p className="text-muted-foreground text-xs">{format(startDate, "yyyy")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium">{format(startDate, "h:mm a")} – {format(endDate, "h:mm a")}</p>
                    <p className="text-muted-foreground text-xs">{duration}</p>
                  </div>
                </div>
                {session.location && (
                  <div className="flex items-start gap-2 text-sm col-span-2">
                    <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p data-testid={`text-session-location-${session.id}`}>{session.location}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {session.sport && <Badge variant="outline" className="text-xs" data-testid={`badge-sport-${session.id}`}><Dumbbell className="h-3 w-3 mr-1" />{session.sport}</Badge>}
                {session.ageRange && <Badge variant="outline" className="text-xs" data-testid={`badge-age-range-${session.id}`}>Ages: {session.ageRange}</Badge>}
                {session.skillLevel && <Badge variant="outline" className="text-xs" data-testid={`badge-skill-level-${session.id}`}>{session.skillLevel}</Badge>}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>Capacity</span>
                  </div>
                  <span className="font-medium">
                    {session.participantCount || 0} / {session.maxParticipants || 6}
                    {!isFull && <span className="text-muted-foreground text-xs ml-1">({spotsRemaining} left)</span>}
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${isFull ? "bg-orange-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(100, ((session.participantCount || 0) / (session.maxParticipants || 6)) * 100)}%` }}
                  />
                </div>
              </div>

              {session.coach?.user && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={session.coach.photoUrl || session.coach.user.profileImageUrl || undefined} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {(session.coach.user.firstName?.[0] || "").toUpperCase()}
                        {(session.coach.user.lastName?.[0] || "").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">Coach {session.coach.user.firstName} {session.coach.user.lastName}</p>
                      <p className="text-xs text-muted-foreground">Lead Coach</p>
                    </div>
                  </div>
                </>
              )}

              {!isCoach && <CompatibilityBadge session={session} userId={userId} />}

              {session.service && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Price</span>
                    <span className="font-semibold text-primary" data-testid={`text-session-price-${session.id}`}>
                      {session.service.priceCents === 0 ? "FREE" : `$${(session.service.priceCents / 100).toFixed(2)} per person`}
                    </span>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">Registered Athletes</p>
                {participantsLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : !participants || participants.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No athletes registered yet — be the first!</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" data-testid={`participants-list-${session.id}`}>
                    {participants.map((p: any) => (
                      <Badge key={p.id} variant="secondary" className="text-xs" data-testid={`badge-participant-${p.id}`}>
                        {p.participantName || `${p.user?.firstName || ""} ${p.user?.lastName || ""}`.trim()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {waitlist && waitlist.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Waitlist ({waitlist.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {waitlist.map((w: any) => (
                      <Badge key={w.id} variant="outline" className="text-xs text-muted-foreground">
                        {w.participant_name || `${w.first_name || ""} ${w.last_name || ""}`.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {isCoach && (
                <>
                  <Separator />
                  <SessionPerformanceBadge bookingId={session.id} />
                  <RevenuePanel bookingId={session.id} />
                </>
              )}

              {isCoach && isAfter(new Date(), endDate) && (
                <>
                  <Separator />
                  <AttendancePanel bookingId={session.id} participants={participants} sessionId={session.id} />
                </>
              )}

              {!isCoach && isAuthenticated && userId && (
                <>
                  <Separator />
                  <AthleteRecommendationsPanel userId={userId} currentSessionId={session.id} />
                </>
              )}
            </div>
          </ScrollArea>

          <div className="px-6 py-4 border-t space-y-2">
            {isCoach && <CoachFillCampaignButton session={session} />}
            {status === "Cancelled" ? (
              <Button className="w-full" disabled variant="outline">
                <AlertCircle className="h-4 w-4 mr-1.5" />
                Session Cancelled
              </Button>
            ) : hasJoined ? (
              <Button
                variant="outline"
                className="w-full border-destructive/30 text-destructive hover:bg-destructive/5"
                onClick={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending}
                data-testid={`button-leave-session-${session.id}`}
              >
                <UserMinus className="h-4 w-4 mr-1.5" />
                {leaveMutation.isPending ? "Unregistering…" : "Cancel Registration"}
              </Button>
            ) : isFull ? (
              onWaitlist ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => waitlistLeaveMutation.mutate()}
                  disabled={waitlistLeaveMutation.isPending}
                  data-testid={`button-leave-waitlist-${session.id}`}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  {waitlistLeaveMutation.isPending ? "Removing…" : "Leave Waitlist"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => {
                    if (!isAuthenticated) { window.location.href = "/"; return; }
                    waitlistJoinMutation.mutate();
                  }}
                  disabled={waitlistJoinMutation.isPending}
                  data-testid={`button-join-waitlist-${session.id}`}
                >
                  <Clock3 className="h-4 w-4 mr-1.5" />
                  {!isAuthenticated ? "Sign Up to Join Waitlist" : waitlistJoinMutation.isPending ? "Joining Waitlist…" : "Join Waitlist"}
                </Button>
              )
            ) : (
              <Button
                className="w-full"
                onClick={() => {
                  if (!isAuthenticated) { window.location.href = "/"; return; }
                  setShowJoinDialog(true);
                }}
                data-testid={`button-join-session-${session.id}`}
              >
                <UserPlus className="h-4 w-4 mr-1.5" />
                {!isAuthenticated ? "Sign Up to Join" : "Join Session"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group Session</AlertDialogTitle>
            <AlertDialogDescription>This will remove the session and all registered participants. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-session">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-session"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join — {session.service?.name || "Group Session"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add the names of athletes you're registering. You can register multiple participants (e.g., your kids).
            </p>
            <div className="space-y-2">
              <Label data-testid="label-join-participants">Participant Names</Label>
              {joinParticipantNames.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder={`Participant ${i + 1} name`}
                    value={name}
                    onChange={e => {
                      const u = [...joinParticipantNames];
                      u[i] = e.target.value;
                      setJoinParticipantNames(u);
                    }}
                    data-testid={`input-join-participant-${i}`}
                  />
                  {joinParticipantNames.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setJoinParticipantNames(joinParticipantNames.filter((_, j) => j !== i))} data-testid={`button-remove-join-participant-${i}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {joinParticipantNames.length < spotsRemaining && (
                <Button type="button" variant="outline" size="sm" onClick={() => setJoinParticipantNames([...joinParticipantNames, ""])} data-testid="button-add-join-participant">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Another Participant
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{spotsRemaining} spot{spotsRemaining !== 1 ? "s" : ""} remaining</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJoinDialog(false)} data-testid="button-cancel-join">Cancel</Button>
            <Button onClick={handleJoinConfirm} disabled={joinMutation.isPending} data-testid="button-confirm-join">
              <UserPlus className="h-4 w-4 mr-1" />
              {joinMutation.isPending ? "Joining…" : "Confirm Registration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Session Chip (compact, for calendar cells) ────────────────────────────

function SessionChip({ session, onClick }: { session: OpenSession; onClick: () => void }) {
  const status = getSessionStatus(session);
  const start = parseISO(session.startAt as unknown as string);
  const colorClass = status === "Open"
    ? "bg-green-500/10 border-green-500/30 text-green-800 dark:text-green-300 hover:bg-green-500/20"
    : status === "Full"
    ? "bg-orange-500/10 border-orange-500/30 text-orange-800 dark:text-orange-300 hover:bg-orange-500/20"
    : status === "Cancelled"
    ? "bg-muted/50 border-muted-foreground/20 text-muted-foreground line-through hover:bg-muted"
    : "bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300 hover:bg-blue-500/20";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left text-xs px-1.5 py-0.5 rounded border truncate transition-colors cursor-pointer ${colorClass}`}
      data-testid={`chip-session-${session.id}`}
    >
      {format(start, "h:mma")} {session.service?.name || "Session"}
    </button>
  );
}

// ─── Day Session Card (for day & week views) ───────────────────────────────

function DaySessionCard({ session, onClick }: { session: OpenSession; onClick: () => void }) {
  const status = getSessionStatus(session);
  const start = parseISO(session.startAt as unknown as string);
  const end = parseISO(session.endAt as unknown as string);
  const dur = sessionDuration(session);
  const isFull = status === "Full";
  const spotsLeft = (session.maxParticipants || 6) - (session.participantCount || 0);

  return (
    <Card
      className="p-3 cursor-pointer hover:shadow-md transition-all border-l-4 group"
      style={{ borderLeftColor: status === "Open" ? "rgb(34 197 94)" : status === "Full" ? "rgb(249 115 22)" : status === "Cancelled" ? "rgb(156 163 175)" : "rgb(59 130 246)" }}
      onClick={onClick}
      data-testid={`card-open-session-${session.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{session.service?.name || "Group Session"}</p>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{format(start, "h:mm a")} – {format(end, "h:mm a")}</span>
            {dur && <span className="text-muted-foreground/60">· {dur}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {getStatusBadge(status)}
            {session.sport && <Badge variant="outline" className="text-xs py-0">{session.sport}</Badge>}
            {session.skillLevel && <Badge variant="outline" className="text-xs py-0">{session.skillLevel}</Badge>}
          </div>
        </div>
        <div className="text-right shrink-0 space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
            <Users className="h-3 w-3" />
            <span>{session.participantCount || 0}/{session.maxParticipants || 6}</span>
          </div>
          {!isFull && <p className="text-xs text-green-600 dark:text-green-400">{spotsLeft} left</p>}
          {session.location && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end max-w-[100px]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{session.location}</span>
            </div>
          )}
        </div>
      </div>
      {session.coach?.user && (
        <div className="flex items-center gap-1.5 mt-2">
          <Avatar className="h-5 w-5">
            <AvatarImage src={session.coach.photoUrl || session.coach.user.profileImageUrl || undefined} />
            <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
              {(session.coach.user.firstName?.[0] || "").toUpperCase()}{(session.coach.user.lastName?.[0] || "").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground">Coach {session.coach.user.firstName} {session.coach.user.lastName}</span>
        </div>
      )}
    </Card>
  );
}

// ─── Month View ─────────────────────────────────────────────────────────────

function MonthView({
  currentDate, sessions, onDayClick, onSessionClick, selectedDay, isCoach, onCreateSession
}: {
  currentDate: Date;
  sessions: OpenSession[];
  onDayClick: (date: Date) => void;
  onSessionClick: (session: OpenSession) => void;
  selectedDay: Date | null;
  isCoach?: boolean;
  onCreateSession?: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days = eachDayOfInterval({ start: calStart, end: calEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, OpenSession[]>();
    sessions.forEach(s => {
      const key = format(parseISO(s.startAt as unknown as string), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [sessions]);

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {dayLabels.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((day, di) => {
            const key = format(day, "yyyy-MM-dd");
            const daySessions = sessionsByDay.get(key) || [];
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
            const isTodayDay = isToday(day);

            return (
              <div
                key={di}
                onClick={() => onDayClick(day)}
                className={`min-h-[80px] p-1.5 border-r last:border-r-0 cursor-pointer transition-colors group
                  ${!isCurrentMonth ? "bg-muted/20" : ""}
                  ${isSelected ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : "hover:bg-muted/40"}
                `}
                data-testid={`calendar-day-${key}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium 
                    ${isTodayDay ? "bg-primary text-primary-foreground" : ""}
                    ${!isCurrentMonth ? "text-muted-foreground/50" : "text-foreground"}
                  `}>
                    {format(day, "d")}
                  </div>
                  {isCoach && isCurrentMonth && onCreateSession && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCreateSession(day); }}
                      className="opacity-0 group-hover:opacity-100 h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-primary transition-all rounded"
                      data-testid={`button-create-session-${key}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {daySessions.slice(0, 2).map(s => (
                    <SessionChip
                      key={s.id}
                      session={s}
                      onClick={e => { (e as any).stopPropagation(); onSessionClick(s); }}
                    />
                  ))}
                  {daySessions.length > 2 && (
                    <p className="text-[10px] text-muted-foreground pl-1">+{daySessions.length - 2} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Week View ──────────────────────────────────────────────────────────────

function WeekView({
  currentDate, sessions, onSessionClick, onDayClick, isCoach, onCreateSession
}: {
  currentDate: Date;
  sessions: OpenSession[];
  onSessionClick: (session: OpenSession) => void;
  onDayClick: (date: Date) => void;
  isCoach?: boolean;
  onCreateSession?: (date: Date) => void;
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, OpenSession[]>();
    sessions.forEach(s => {
      const key = format(parseISO(s.startAt as unknown as string), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [sessions]);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {days.map(day => (
          <div
            key={day.toISOString()}
            className="py-2 text-center cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onDayClick(day)}
          >
            <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
            <p className={`text-sm font-medium mx-auto w-7 h-7 flex items-center justify-center rounded-full
              ${isToday(day) ? "bg-primary text-primary-foreground" : ""}
            `}>
              {format(day, "d")}
            </p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-h-[200px]">
        {days.map(day => {
          const key = format(day, "yyyy-MM-dd");
          const daySessions = (sessionsByDay.get(key) || []).sort(
            (a, b) => new Date(a.startAt as any).getTime() - new Date(b.startAt as any).getTime()
          );
          return (
            <div key={key} className="border-r last:border-r-0 p-1.5 space-y-1 min-h-[160px] group">
              {daySessions.length === 0 ? (
                <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-1">
                  <p className="text-[10px] text-muted-foreground/40">—</p>
                  {isCoach && onCreateSession && (
                    <button
                      onClick={() => onCreateSession(day)}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-primary border border-dashed rounded transition-all"
                      data-testid={`button-create-session-week-${key}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                daySessions.map(s => (
                  <SessionChip key={s.id} session={s} onClick={() => onSessionClick(s)} />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day View ───────────────────────────────────────────────────────────────

function DayView({
  currentDate, sessions, onSessionClick, isCoach, onCreateSession
}: {
  currentDate: Date;
  sessions: OpenSession[];
  onSessionClick: (session: OpenSession) => void;
  isCoach?: boolean;
  onCreateSession?: (date: Date) => void;
}) {
  const daySessions = sessions
    .filter(s => isSameDay(parseISO(s.startAt as unknown as string), currentDate))
    .sort((a, b) => new Date(a.startAt as any).getTime() - new Date(b.startAt as any).getTime());

  if (daySessions.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center">
        <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground font-medium">No sessions on {format(currentDate, "MMMM d")}</p>
        <p className="text-sm text-muted-foreground mt-1">Try a different day or adjust your filters</p>
        {isCoach && onCreateSession && (
          <Button size="sm" variant="outline" className="mt-4" onClick={() => onCreateSession(currentDate)} data-testid="button-create-session-day">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Session on This Day
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {daySessions.map(s => (
        <DaySessionCard key={s.id} session={s} onClick={() => onSessionClick(s)} />
      ))}
    </div>
  );
}

// ─── Selected Day Panel (for month view drill-down) ─────────────────────────

function SelectedDayPanel({
  date, sessions, onSessionClick, onClose
}: {
  date: Date;
  sessions: OpenSession[];
  onSessionClick: (session: OpenSession) => void;
  onClose: () => void;
}) {
  const daySessions = sessions
    .filter(s => isSameDay(parseISO(s.startAt as unknown as string), date))
    .sort((a, b) => new Date(a.startAt as any).getTime() - new Date(b.startAt as any).getTime());

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">{format(date, "EEEE, MMMM d")}</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {daySessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No sessions this day</p>
      ) : (
        <div className="space-y-2">
          {daySessions.map(s => (
            <DaySessionCard key={s.id} session={s} onClick={() => onSessionClick(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function OpenSessionsPage() {
  const { user, isAuthenticated } = useAuth();
  const [view, setView] = useState<CalendarView>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedSession, setSelectedSession] = useState<OpenSession | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [createSessionDate, setCreateSessionDate] = useState<Date | undefined>(undefined);
  const [filters, setFilters] = useState<Filters>({
    sport: "all", location: "all", ageGroup: "all",
    skillLevel: "all", availability: "all", sessionType: "all"
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";
  const userId = user?.id;

  const { data: sessions = [], isLoading } = useQuery<OpenSession[]>({
    queryKey: ["/api/sessions/open"],
  });

  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      if (filters.availability !== "all") {
        const status = getSessionStatus(session);
        if (status !== filters.availability) return false;
      }
      if (filters.skillLevel !== "all" && session.skillLevel !== filters.skillLevel) return false;
      if (filters.sport !== "all" && session.sport !== filters.sport) return false;
      if (filters.location !== "all" && session.location !== filters.location) return false;
      if (filters.ageGroup !== "all" && session.ageRange !== filters.ageGroup) return false;
      return true;
    });
  }, [sessions, filters]);

  const navigate = (dir: "prev" | "next" | "today") => {
    if (dir === "today") { setCurrentDate(new Date()); setSelectedDay(null); return; }
    const delta = dir === "next" ? 1 : -1;
    if (view === "month") setCurrentDate(d => delta > 0 ? addMonths(d, 1) : subMonths(d, 1));
    else if (view === "week") setCurrentDate(d => delta > 0 ? addWeeks(d, 1) : subWeeks(d, 1));
    else setCurrentDate(d => delta > 0 ? addDays(d, 1) : subDays(d, 1));
    setSelectedDay(null);
  };

  const periodLabel = () => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      return isSameMonth(ws, we)
        ? `${format(ws, "MMM d")} – ${format(we, "d, yyyy")}`
        : `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  };

  const handleDayClick = (date: Date) => {
    if (view === "month") {
      setSelectedDay(prev => (prev && isSameDay(prev, date)) ? null : date);
    } else {
      setCurrentDate(date);
      setView("day");
    }
  };

  const handleCreateSession = (date: Date) => {
    setCreateSessionDate(date);
    setCreateSessionOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-open-sessions-title">Open Group Sessions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Browse and join semi-private training sessions</p>
        </div>
        {isCoach && <AddSessionDialog />}
      </div>

      {/* Recommended For You (non-coach athletes only) */}
      {!isCoach && userId && <RecommendedForYouStrip userId={userId} sessions={sessions} onSessionClick={setSelectedSession} />}

      {/* Filters */}
      <FilterPanel
        sessions={sessions}
        filters={filters}
        setFilters={setFilters}
        open={filtersOpen}
        onToggle={() => setFiltersOpen(f => !f)}
      />

      {/* Calendar Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-muted/30">
          <Button
            variant={view === "month" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => { setView("month"); setSelectedDay(null); }}
            data-testid="view-month"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Month</span>
          </Button>
          <Button
            variant={view === "week" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => { setView("week"); setSelectedDay(null); }}
            data-testid="view-week"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Week</span>
          </Button>
          <Button
            variant={view === "day" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => { setView("day"); setSelectedDay(null); }}
            data-testid="view-day"
          >
            <List className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Day</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate("prev")} data-testid="button-prev-period">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3 text-xs font-medium" onClick={() => navigate("today")} data-testid="button-today">
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate("next")} data-testid="button-next-period">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <p className="font-semibold text-sm" data-testid="text-period-label">{periodLabel()}</p>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Open</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Full</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />Cancelled</span>
        </div>
      </div>

      {/* Calendar Body */}
      {view === "month" && (
        <MonthView
          currentDate={currentDate}
          sessions={filteredSessions}
          onDayClick={handleDayClick}
          onSessionClick={setSelectedSession}
          selectedDay={selectedDay}
          isCoach={isCoach}
          onCreateSession={handleCreateSession}
        />
      )}
      {view === "week" && (
        <WeekView
          currentDate={currentDate}
          sessions={filteredSessions}
          onSessionClick={setSelectedSession}
          onDayClick={handleDayClick}
          isCoach={isCoach}
          onCreateSession={handleCreateSession}
        />
      )}
      {view === "day" && (
        <DayView
          currentDate={currentDate}
          sessions={filteredSessions}
          onSessionClick={setSelectedSession}
          isCoach={isCoach}
          onCreateSession={handleCreateSession}
        />
      )}

      {/* Selected Day Drill-down (month view) */}
      {view === "month" && selectedDay && (
        <SelectedDayPanel
          date={selectedDay}
          sessions={filteredSessions}
          onSessionClick={setSelectedSession}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {/* Total count */}
      {filteredSessions.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Showing {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Click-to-create session dialog (coaches only) */}
      {isCoach && (
        <AddSessionDialog
          controlledOpen={createSessionOpen}
          onControlledOpenChange={setCreateSessionOpen}
          initialDate={createSessionDate}
        />
      )}

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          userId={user?.id}
          isAuthenticated={isAuthenticated}
          isCoach={isCoach}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
