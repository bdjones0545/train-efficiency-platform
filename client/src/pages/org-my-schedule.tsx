import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { logoutAllSessions } from "@/lib/logout";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Trophy,
  User,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  History,
  LayoutDashboard,
} from "lucide-react";
import { format, parseISO } from "date-fns";

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:00 ${suffix}`;
}

function parseTimeSlot(slot: string | null | undefined): number {
  if (!slot) return 0;
  return parseInt(slot.split(":")[0], 10);
}

function BookingCard({ booking, isPast }: { booking: any; isPast: boolean }) {
  let dateLabel = booking.date;
  try {
    dateLabel = format(parseISO(booking.date), "EEEE, MMM d, yyyy");
  } catch {}

  return (
    <Card className={`p-4 flex items-start gap-4 ${isPast ? "opacity-70" : ""}`} data-testid={`card-booking-${booking.id}`}>
      <div className={`rounded-full p-2 flex-shrink-0 ${isPast ? "bg-muted" : "bg-primary/10"}`}>
        <Trophy className={`h-5 w-5 ${isPast ? "text-muted-foreground" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold truncate" data-testid={`text-booking-team-${booking.id}`}>{booking.teamName}</p>
          <Badge variant={isPast ? "secondary" : "default"} data-testid={`badge-booking-type-${booking.id}`}>
            {booking.trainingType}
          </Badge>
          {!isPast && (
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">Upcoming</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-3 mt-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            <span data-testid={`text-booking-date-${booking.id}`}>{dateLabel}</span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span data-testid={`text-booking-time-${booking.id}`}>{formatHour(parseTimeSlot(booking.timeSlot))}</span>
          </span>
        </div>
      </div>
      <div className="flex-shrink-0">
        {isPast ? (
          <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        )}
      </div>
    </Card>
  );
}

export default function OrgMySchedulePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";

  const { data: org, isLoading: orgLoading } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;

  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [orgUser, setOrgUser] = useState<any>(null);
  const [showOrgAuth, setShowOrgAuth] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setOrgToken(token);
        setOrgUser(data.user);
      })
      .catch(() => {
        localStorage.removeItem(`orgToken_${orgId}`);
      });
  }, [orgId]);

  const { data: schedule, isLoading: scheduleLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/my-schedule", orgId, orgToken],
    queryFn: async () => {
      const res = await fetch("/api/org/my-schedule", {
        headers: { "X-Org-Auth-Token": orgToken! },
      });
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
    enabled: !!orgToken && !!orgId,
  });

  function handleAuthenticated(token: string, user: any) {
    localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setOrgUser(user);
    setShowOrgAuth(false);
  }

  function handleLogout() {
    logoutAllSessions(`/org/${slug}/portal`);
  }

  const backUrl = `/org/${slug}/athletic`;
  const homeUrl = `/org/${slug}`;

  if (orgLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <a href={homeUrl} className="flex items-center gap-2" data-testid="link-nav-home">
            {org?.logoUrl && <img src={org.logoUrl} alt={org?.name} className="h-8 rounded-md" />}
            <span className="font-semibold text-lg tracking-tight">{org?.name}</span>
          </a>
          <div className="flex items-center gap-2">
            {orgUser && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span data-testid="text-logged-in-user">{orgUser.name}</span>
              </div>
            )}
            <a href={`/org/${slug}/portal`} data-testid="link-portal">
              <Button variant="ghost" size="sm">
                <LayoutDashboard className="h-4 w-4 mr-1" /> Portal
              </Button>
            </a>
            <a href={backUrl}>
              <Button variant="ghost" size="sm" data-testid="link-back-schedule">
                <ArrowLeft className="h-4 w-4 mr-1" /> Schedule
              </Button>
            </a>
            {orgUser && (
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                <LogOut className="h-4 w-4 mr-1" /> Log Out
              </Button>
            )}
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-my-schedule-title">My Schedule</h1>
            <p className="text-muted-foreground mt-1">Your upcoming and past training sessions.</p>
          </div>

          {!orgToken && !showOrgAuth && (
            <Card className="p-10 text-center space-y-4" data-testid="card-login-prompt">
              <User className="h-12 w-12 text-muted-foreground mx-auto" />
              <div>
                <h2 className="text-lg font-semibold">Log in to view your schedule</h2>
                <p className="text-muted-foreground mt-1">
                  Sign in to your {org?.name} account to see your upcoming bookings and session history.
                </p>
              </div>
              <Button onClick={() => setShowOrgAuth(true)} data-testid="button-login-to-view">
                Log In / Sign Up
              </Button>
            </Card>
          )}

          {orgToken && scheduleLoading && (
            <p className="text-muted-foreground text-center py-8">Loading your schedule...</p>
          )}

          {orgToken && schedule && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4 space-y-1">
                  <p className="text-sm text-muted-foreground">Upcoming</p>
                  <p className="text-2xl font-bold text-primary" data-testid="text-upcoming-count">
                    {schedule.upcoming?.length ?? 0}
                  </p>
                </Card>
                <Card className="p-4 space-y-1">
                  <p className="text-sm text-muted-foreground">Past Sessions</p>
                  <p className="text-2xl font-bold" data-testid="text-past-count">
                    {schedule.past?.length ?? 0}
                  </p>
                </Card>
                <Card className="p-4 space-y-1">
                  <p className="text-sm text-muted-foreground">Total Booked</p>
                  <p className="text-2xl font-bold" data-testid="text-total-count">
                    {(schedule.upcoming?.length ?? 0) + (schedule.past?.length ?? 0)}
                  </p>
                </Card>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  Upcoming Sessions
                </h2>
                {schedule.upcoming?.length === 0 && (
                  <Card className="p-8 text-center">
                    <p className="text-muted-foreground" data-testid="text-no-upcoming">
                      No upcoming sessions. Book a time slot on the{" "}
                      <a href={backUrl} className="underline text-primary">schedule page</a>.
                    </p>
                  </Card>
                )}
                {schedule.upcoming?.map((b: any) => (
                  <BookingCard key={b.id} booking={b} isPast={false} />
                ))}
              </section>

              {schedule.past?.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <History className="h-5 w-5 text-muted-foreground" />
                    Past Sessions
                  </h2>
                  {schedule.past.map((b: any) => (
                    <BookingCard key={b.id} booking={b} isPast={true} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {showOrgAuth && org && (
        <OrgAuthModal
          orgId={orgId}
          programId=""
          programName={org.name}
          onAuthenticated={(token, user) => handleAuthenticated(token, user)}
          onClose={() => setShowOrgAuth(false)}
        />
      )}
    </div>
  );
}
