import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  Trophy,
  ArrowLeft,
  Zap,
  Dumbbell,
  X,
  AlertTriangle,
  User,
  LogOut,
  CalendarCheck,
  Settings2,
  Lock,
  LayoutDashboard,
} from "lucide-react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, addDays, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import type { AthleticBooking, AthleticProgram } from "@shared/schema";

const SLOT_HEIGHT_PX = 120;

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h} ${suffix}`;
}

function buildTimeSlots(startHour: number, endHour: number) {
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push({ id: `${h.toString().padStart(2, "0")}:00`, label: formatHour(h), hour: h });
  }
  return slots;
}

function ProgramSelector({ org, programs }: { org: any; programs: AthleticProgram[] }) {
  const backUrl = `/org/${org.slug}`;
  const activePrograms = programs.filter((p: any) => p.active && (p.type === "scheduling" || !p.type));

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <a href={backUrl} className="flex items-center gap-2" data-testid="link-nav-home">
            {org.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-8 rounded-md" />}
            <span className="font-semibold text-lg tracking-tight">{org.name}</span>
          </a>
          <a href={backUrl}>
            <Button variant="ghost" size="sm" data-testid="link-back-home">
              <ArrowLeft className="h-4 w-4 mr-1" /> Home
            </Button>
          </a>
        </div>
      </nav>
      <main className="pt-24 pb-12 px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold" data-testid="text-program-selector-title">Athletic Programs</h1>
          <p className="text-muted-foreground">Select a program to view the schedule and book a time slot.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {activePrograms.map((p: any) => (
              <a key={p.id} href={`/org/${org.slug}/athletic/${p.slug}`} data-testid={`link-program-${p.id}`}>
                <Card className="p-6 hover:border-primary/50 transition-colors cursor-pointer space-y-2">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">{p.name}</h2>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatHour(p.startHour)} - {formatHour(p.endHour)}</span>
                    <span className="flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5" /> {(p.trainingTypes || []).join(", ")}</span>
                    <span>Max {p.maxTeamsPerSlot} teams/slot</span>
                  </div>
                </Card>
              </a>
            ))}
          </div>
          {activePrograms.length === 0 && (
            <p className="text-muted-foreground text-center py-8">No active programs available at this time.</p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function AthleticSchedulingPage() {
  const params = useParams<{ slug?: string; programSlug?: string }>();
  const [, navigate] = useLocation();
  const slug = params.slug || "efficiencystrength";
  const programSlug = params.programSlug;

  const { data: org, isLoading: orgLoading } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;

  const { data: programs } = useQuery<AthleticProgram[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${orgId}`);
      return res.json();
    },
    enabled: !!orgId && org?.athleticEnabled,
  });

  const { data: program, isLoading: programLoading } = useQuery<AthleticProgram>({
    queryKey: ["/api/athletic/programs/by-slug", orgId, programSlug],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs/by-slug/${orgId}/${programSlug}`);
      if (!res.ok) throw new Error("Program not found");
      return res.json();
    },
    enabled: !!orgId && !!programSlug,
  });

  const activePrograms = programs?.filter((p: any) => p.active && (p.type === "scheduling" || !p.type)) || [];
  const resolvedProgram = programSlug ? program : (activePrograms.length === 1 ? activePrograms[0] : null);
  const maxTeamsPerSlot = resolvedProgram?.maxTeamsPerSlot ?? 2;
  const trainingTypes = resolvedProgram?.trainingTypes || ["Strength", "Speed"];

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ id: string; label: string; hour: number } | null>(null);
  const [teamName, setTeamName] = useState("");
  const [trainingType, setTrainingType] = useState(trainingTypes[0] || "Strength");
  const { toast } = useToast();

  // ── Org Auth State ────────────────────────────────────────────────────────
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [orgUser, setOrgUser] = useState<any>(null);
  const [orgMembership, setOrgMembership] = useState<any>(null);
  const [showOrgAuth, setShowOrgAuth] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<{ id: string; label: string; hour: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);

  // Load org token after orgId is available
  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setOrgToken(token);
        setOrgUser(data.user);
        setOrgMembership(data.membership);
      })
      .catch(() => {
        localStorage.removeItem(`orgToken_${orgId}`);
      });
  }, [orgId]);

  // Booking settings
  const { data: bookingSettings, refetch: refetchSettings } = useQuery<{
    allowGuestBooking: boolean;
    requireLoginToBook: boolean;
  }>({
    queryKey: ["/api/org/booking-settings", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/org/booking-settings?orgId=${orgId}`);
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    enabled: !!orgId,
  });

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const programId = resolvedProgram?.id;

  const { data: config } = useQuery<{ startHour: number; endHour: number; maxTeamsPerSlot: number; trainingTypes: string[] }>({
    queryKey: ["/api/athletic/config", programId, dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/config?date=${dateStr}&programId=${programId}`);
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    enabled: !!programId,
  });

  const startHour = config?.startHour ?? resolvedProgram?.startHour ?? 16;
  const endHour = config?.endHour ?? resolvedProgram?.endHour ?? 20;
  const timeSlots = buildTimeSlots(startHour, endHour);

  const { data: bookings, isLoading } = useQuery<AthleticBooking[]>({
    queryKey: ["/api/athletic/bookings", programId, dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/bookings?date=${dateStr}&programId=${programId}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
    enabled: !!programId,
  });

  const bookMutation = useMutation({
    mutationFn: async (data: { date: string; timeSlot: string; teamName: string; trainingType: string; programId: string }) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch("/api/athletic/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to book");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", programId, dateStr] });
      setScheduleDialogOpen(false);
      setTeamName("");
      setTrainingType(trainingTypes[0] || "Strength");
      setSelectedSlot(null);
      const scheduleUrl = `/org/${slug}/my-schedule`;
      toast({
        title: "Booked!",
        description: orgToken
          ? "Your session is confirmed and saved to your account."
          : "Your team has been booked for this time slot.",
        action: orgToken ? (
          <a href={scheduleUrl} className="underline text-sm font-medium">View My Schedule</a>
        ) : undefined,
      } as any);
    },
    onError: (error: any) => {
      if (error.message?.includes("Login required")) {
        setPendingSlot(selectedSlot);
        setScheduleDialogOpen(false);
        setShowOrgAuth(true);
        return;
      }
      toast({ title: "Could not schedule", description: error.message || "This slot may be full.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await fetch(`/api/athletic/bookings/${bookingId}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", programId, dateStr] });
      toast({ title: "Session removed", description: "The scheduled session has been deleted." });
    },
    onError: (error: any) => {
      toast({ title: "Could not delete", description: error.message || "Failed to remove session.", variant: "destructive" });
    },
  });

  const getSlotBookings = (slotId: string) => {
    return bookings?.filter(b => b.timeSlot === slotId) || [];
  };

  const handleSlotClick = (slot: { id: string; label: string; hour: number }) => {
    const slotBookings = getSlotBookings(slot.id);
    if (slotBookings.length >= maxTeamsPerSlot) return;

    // If login is required and user is not logged in, prompt auth first
    if (bookingSettings?.requireLoginToBook && !orgToken) {
      setPendingSlot(slot);
      setShowOrgAuth(true);
      return;
    }

    setSelectedSlot(slot);
    setTeamName(orgUser?.name || "");
    setTrainingType(trainingTypes[0] || "Strength");
    setScheduleDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !teamName.trim() || !programId) return;
    bookMutation.mutate({
      date: dateStr,
      timeSlot: selectedSlot.id,
      teamName: teamName.trim(),
      trainingType,
      programId,
    });
  };

  function handleOrgAuthenticated(token: string, user: any, membership: any) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setOrgUser(user);
    setOrgMembership(membership);
    setShowOrgAuth(false);
    // If there was a pending slot, open the booking dialog for it
    if (pendingSlot) {
      setSelectedSlot(pendingSlot);
      setTeamName(user.name || "");
      setTrainingType(trainingTypes[0] || "Strength");
      setScheduleDialogOpen(true);
      setPendingSlot(null);
    }
  }

  function handleLogout() {
    if (orgId) localStorage.removeItem(`orgToken_${orgId}`);
    setOrgToken(null);
    setOrgUser(null);
    setOrgMembership(null);
  }

  async function handleToggleSetting(key: "allowGuestBooking" | "requireLoginToBook", value: boolean) {
    if (!orgToken) return;
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/org/booking-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      await refetchSettings();
      toast({ title: "Setting updated" });
    } catch (err: any) {
      toast({ title: "Failed to update setting", description: err.message, variant: "destructive" });
    } finally {
      setSettingsLoading(false);
    }
  }

  const totalBooked = bookings?.length || 0;
  const slotsAvailable = timeSlots.filter(s => getSlotBookings(s.id).length < maxTeamsPerSlot).length;
  const backUrl = `/org/${slug}`;
  const myScheduleUrl = `/org/${slug}/my-schedule`;
  const isCoach = orgMembership?.role === "coach";

  if (orgLoading || programLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!org || !org.athleticEnabled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Athletic Scheduling Not Available</h2>
          <p className="text-muted-foreground">This organization does not have athletic scheduling enabled.</p>
          <a href={backUrl}>
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" /> Go Back
            </Button>
          </a>
        </Card>
      </div>
    );
  }

  // If a programSlug was given but resolves to a non-scheduling type, redirect to the correct tool route
  if (programSlug && program && program.type && program.type !== "scheduling") {
    navigate(`/org/${slug}/programs/${programSlug}`, { replace: true });
    return null;
  }

  if (!programSlug && activePrograms.length > 1) {
    return <ProgramSelector org={org} programs={activePrograms} />;
  }

  if (!programSlug && activePrograms.length === 1) {
    navigate(`/org/${slug}/athletic/${activePrograms[0].slug}`, { replace: true });
    return null;
  }

  if (!resolvedProgram) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Program Not Found</h2>
          <p className="text-muted-foreground">The requested athletic program could not be found.</p>
          <a href={backUrl}>
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" /> Go Back
            </Button>
          </a>
        </Card>
      </div>
    );
  }

  const programName = resolvedProgram.name;

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <a href={backUrl} className="flex items-center gap-2" data-testid="link-nav-home">
            {org.logoUrl && (
              <img src={org.logoUrl} alt={org.name} className="h-8 rounded-md" data-testid="img-athletic-nav-logo" />
            )}
            <span className="font-semibold text-lg tracking-tight" data-testid="text-athletic-brand">
              {org.name}
            </span>
          </a>
          <div className="flex items-center gap-2">
            {orgUser ? (
              <>
                <span className="text-sm text-muted-foreground hidden sm:flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span data-testid="text-nav-user-name">{orgUser.name}</span>
                </span>
                <a href={`/org/${slug}/portal`} data-testid="link-portal">
                  <Button variant="ghost" size="sm">
                    <LayoutDashboard className="h-4 w-4 mr-1" /> Portal
                  </Button>
                </a>
                <a href={`/org/${slug}/profile`} data-testid="link-profile">
                  <Button variant="ghost" size="sm">
                    <User className="h-4 w-4 mr-1" /> Profile
                  </Button>
                </a>
                <a href={myScheduleUrl}>
                  <Button variant="ghost" size="sm" data-testid="link-my-schedule">
                    <CalendarCheck className="h-4 w-4 mr-1" /> My Schedule
                  </Button>
                </a>
                {isCoach && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSettings(v => !v)}
                    data-testid="button-settings-toggle"
                  >
                    <Settings2 className="h-4 w-4 mr-1" /> Settings
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                  <LogOut className="h-4 w-4 mr-1" /> Log Out
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOrgAuth(true)}
                data-testid="button-login"
              >
                <User className="h-4 w-4 mr-1" /> Log In
              </Button>
            )}
            <a href={backUrl}>
              <Button variant="ghost" size="sm" data-testid="link-back-home">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Home
              </Button>
            </a>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-athletic-title">
                {programName}
              </h1>
              <p className="text-muted-foreground mt-1">Daily calendar view — {formatHour(startHour)} to {formatHour(endHour)}</p>
            </div>
          </div>

          {/* Coach Settings Panel */}
          {isCoach && showSettings && bookingSettings && (
            <Card className="p-4 space-y-3 border-primary/20 bg-primary/5" data-testid="card-coach-settings">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                Booking Settings
              </h3>
              <div className="space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-muted-foreground">Allow guest booking (no login required)</span>
                  <button
                    type="button"
                    disabled={settingsLoading}
                    onClick={() => handleToggleSetting("allowGuestBooking", !bookingSettings.allowGuestBooking)}
                    className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${bookingSettings.allowGuestBooking ? "bg-primary" : "bg-muted-foreground/30"}`}
                    data-testid="toggle-allow-guest"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${bookingSettings.allowGuestBooking ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-muted-foreground">Require login to book</span>
                  <button
                    type="button"
                    disabled={settingsLoading}
                    onClick={() => handleToggleSetting("requireLoginToBook", !bookingSettings.requireLoginToBook)}
                    className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${bookingSettings.requireLoginToBook ? "bg-primary" : "bg-muted-foreground/30"}`}
                    data-testid="toggle-require-login"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${bookingSettings.requireLoginToBook ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </label>
              </div>
            </Card>
          )}

          {/* Soft login banner — shown to guests when login is not required */}
          {!orgToken && bookingSettings && !bookingSettings.requireLoginToBook && (
            <div
              className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5"
              data-testid="banner-login-prompt"
            >
              <User className="h-4 w-4 text-primary flex-shrink-0" />
              <p className="text-sm text-muted-foreground flex-1">
                <button
                  onClick={() => setShowOrgAuth(true)}
                  className="underline text-primary font-medium"
                  data-testid="link-banner-login"
                >
                  Log in
                </button>{" "}
                to track your bookings and view your schedule history.
              </p>
            </div>
          )}

          {/* Login required banner — shown when requireLoginToBook is true and guest is visiting */}
          {!orgToken && bookingSettings?.requireLoginToBook && (
            <div
              className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2.5"
              data-testid="banner-login-required"
            >
              <Lock className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-sm text-muted-foreground flex-1">
                Login is required to book sessions.{" "}
                <button
                  onClick={() => setShowOrgAuth(true)}
                  className="underline text-primary font-medium"
                  data-testid="link-banner-login-required"
                >
                  Log in or sign up
                </button>{" "}
                to continue.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setSelectedDate(d => subDays(d, 1))}
                data-testid="button-prev-day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-w-[220px] justify-start"
                    data-testid="button-date-picker"
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(selectedDate, "EEEE, MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => {
                      if (d) setSelectedDate(d);
                      setCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>

              <Button
                size="icon"
                variant="outline"
                onClick={() => setSelectedDate(d => addDays(d, 1))}
                data-testid="button-next-day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(new Date())}
              data-testid="button-today"
            >
              Today
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4 space-y-1">
              <p className="text-sm text-muted-foreground">Total Slots</p>
              <p className="text-2xl font-bold" data-testid="text-total-slots">{timeSlots.length}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-sm text-muted-foreground">Teams Booked</p>
              <p className="text-2xl font-bold" data-testid="text-teams-booked">{totalBooked}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-sm text-muted-foreground">Slots Available</p>
              <p className="text-2xl font-bold text-primary" data-testid="text-slots-available">{slotsAvailable}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-sm text-muted-foreground">Max Per Slot</p>
              <p className="text-2xl font-bold" data-testid="text-max-per-slot">{maxTeamsPerSlot}</p>
            </Card>
          </div>

          <Card className="p-0 overflow-x-hidden overflow-y-auto" style={{ maxHeight: "70vh" }}>
            <div
              className="relative"
              style={{ height: `${timeSlots.length * SLOT_HEIGHT_PX}px` }}
              data-testid="calendar-timeline"
            >
              {timeSlots.map((slot, i) => {
                const slotBookings = getSlotBookings(slot.id);
                const isFull = slotBookings.length >= maxTeamsPerSlot;
                const top = i * SLOT_HEIGHT_PX;

                return (
                  <div key={slot.id}>
                    <div
                      className="absolute left-0 right-0 border-b border-border/50"
                      style={{ top: `${top}px`, height: `${SLOT_HEIGHT_PX}px` }}
                      data-testid={`slot-row-${slot.id}`}
                    >
                      <span className="absolute left-2 top-2 text-xs text-muted-foreground font-medium w-10 text-right">
                        {slot.label}
                      </span>
                    </div>

                    {slotBookings.map((booking, bi) => (
                      <div
                        key={booking.id}
                        className={`absolute left-14 right-2 rounded-md px-3 flex items-center ${
                          isFull
                            ? "bg-destructive/10 border border-destructive/20"
                            : "bg-primary/10 border border-primary/20"
                        }`}
                        style={{
                          top: `${top + 4 + bi * 52}px`,
                          height: "48px",
                          zIndex: 10,
                        }}
                        data-testid={`booking-block-${booking.id}`}
                      >
                        <div className="flex items-center gap-2 h-full w-full">
                          <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm font-semibold truncate flex-1" data-testid={`text-team-name-${booking.id}`}>
                            {booking.teamName}
                          </span>
                          <Badge variant="secondary" className="flex-shrink-0" data-testid={`badge-training-type-${booking.id}`}>
                            {booking.trainingType}
                          </Badge>
                          {(booking as any).orgUserId && (
                            <User className="h-3.5 w-3.5 text-primary/60 flex-shrink-0" title="Booked by a logged-in member" />
                          )}
                          <button
                            className="ml-auto flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove ${booking.teamName} from this time slot?`)) {
                                deleteMutation.mutate(booking.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-booking-${booking.id}`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {!isFull && (
                      <div
                        className="absolute left-14 right-2 cursor-pointer group"
                        style={{
                          top: `${top + 4 + slotBookings.length * 52}px`,
                          height: `${SLOT_HEIGHT_PX - 8 - slotBookings.length * 52}px`,
                          zIndex: 5,
                        }}
                        onClick={() => handleSlotClick(slot)}
                        data-testid={`slot-click-area-${slot.id}`}
                      >
                        <div className="h-full w-full rounded-md border border-dashed border-transparent group-hover:border-primary/30 group-hover:bg-primary/5 flex items-center justify-center transition-colors">
                          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                            {bookingSettings?.requireLoginToBook && !orgToken
                              ? "Log in to book a slot"
                              : "Click to schedule a team"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div
                className="absolute left-0 right-0 border-b border-border/50"
                style={{ top: `${timeSlots.length * SLOT_HEIGHT_PX}px` }}
              >
                <span className="absolute left-2 top-1 text-xs text-muted-foreground font-medium">
                  {formatHour(endHour)}
                </span>
              </div>
            </div>
          </Card>

          <div className="flex items-center gap-4 text-sm text-muted-foreground justify-center">
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-primary/10 border border-primary/20" />
              Booked team
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-destructive/10 border border-destructive/20" />
              Full slot
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-primary/5 border border-dashed border-primary/30" />
              Available
            </span>
          </div>
        </div>
      </main>

      {/* Booking Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={(open) => {
        setScheduleDialogOpen(open);
        if (!open) {
          setTeamName("");
          setTrainingType(trainingTypes[0] || "Strength");
          setSelectedSlot(null);
        }
      }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-schedule-team">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Schedule Your Team
            </DialogTitle>
            <DialogDescription>
              {selectedSlot && (
                <>
                  Booking for {format(selectedDate, "EEEE, MMM d")} — {formatHour(selectedSlot.hour)} to {formatHour(selectedSlot.hour + 1)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {orgUser && (
            <div className="flex items-center gap-2 px-1 py-1 bg-primary/5 rounded-md text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5 text-primary" />
              Booking as <span className="font-medium text-foreground">{orgUser.name}</span> — saved to your account
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label htmlFor="team-name" className="text-sm font-medium">
                What team are you scheduling?
              </label>
              <Input
                id="team-name"
                placeholder="e.g. Varsity Football, JV Basketball..."
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
                autoFocus
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Training Type
              </label>
              <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(trainingTypes.length, 3)}, 1fr)` }}>
                {trainingTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTrainingType(type)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-colors ${
                      trainingType === type
                        ? "border-primary bg-primary/10"
                        : "border-muted hover-elevate"
                    }`}
                    data-testid={`button-training-${type.toLowerCase()}`}
                  >
                    <Dumbbell className={`h-6 w-6 ${trainingType === type ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-sm font-medium ${trainingType === type ? "text-primary" : "text-muted-foreground"}`}>
                      {type}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={bookMutation.isPending || !teamName.trim()}
              data-testid="button-confirm-schedule"
            >
              <CalendarIcon className="h-4 w-4 mr-2" />
              {bookMutation.isPending ? "Scheduling..." : "Confirm Booking"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Org Auth Modal */}
      {showOrgAuth && org && orgId && (
        <OrgAuthModal
          orgId={orgId}
          programId={resolvedProgram?.id}
          programName={org.name}
          onAuthenticated={handleOrgAuthenticated}
          onClose={() => {
            setShowOrgAuth(false);
            setPendingSlot(null);
          }}
        />
      )}
    </div>
  );
}
