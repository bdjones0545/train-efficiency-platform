import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import {
  CalendarPlus,
  CalendarCheck,
  Trophy,
  Users,
  LayoutGrid,
  User,
  LogOut,
  LayoutDashboard,
  ArrowRight,
  Clock,
  Dumbbell,
  TrendingUp,
  Settings2,
  ChevronRight,
  Star,
  ShieldCheck,
  Bell,
  MessageSquare,
  Megaphone,
  Send,
  Zap,
  Heart,
  AlertTriangle,
  CalendarDays,
  Activity,
  Leaf,
  GraduationCap,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { OrgMessageComposer } from "@/components/OrgMessageComposer";

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:00 ${suffix}`;
}

function parseTimeSlot(slot: string): number {
  return parseInt(slot.split(":")[0], 10);
}

function RoleBadge({ role }: { role: string }) {
  const config: Record<string, { label: string; className: string }> = {
    coach: { label: "Coach", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    athlete: { label: "Athlete", className: "bg-green-500/10 text-green-400 border-green-500/20" },
    owner: { label: "Owner", className: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
    parent: { label: "Parent", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  };
  const c = config[role] ?? config.athlete;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
      {c.label}
    </span>
  );
}

function ActionCard({
  icon,
  label,
  description,
  href,
  onClick,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  href?: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const cls = `group relative flex flex-col items-start gap-2 p-5 rounded-xl border cursor-pointer transition-all duration-150 ${
    accent
      ? "border-primary/40 bg-primary/10 hover:bg-primary/15 hover:border-primary/60"
      : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
  }`;

  const inner = (
    <div className={cls}>
      <div className={`rounded-lg p-2.5 ${accent ? "bg-primary/20" : "bg-muted"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm leading-tight">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{description}</p>}
      </div>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </div>
  );

  if (href) return <a href={href}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} className="text-left w-full">{inner}</button>;
  return inner;
}

function PortalSkeleton() {
  return (
    <div className="space-y-6 pt-6 px-4 max-w-2xl mx-auto">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function GuestPreview({
  org,
  orgId,
  onAuthenticated,
}: {
  org: any;
  orgId: string;
  onAuthenticated: (token: string, user: any, membership: any) => void;
}) {
  const [showAuth, setShowAuth] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center space-y-6">
        {org?.logoUrl && (
          <img src={org.logoUrl} alt={org.name} className="h-16 w-auto rounded-xl shadow-lg" />
        )}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{org?.name}</h1>
          <p className="text-muted-foreground text-lg">{org?.tagline || "Your Training Hub"}</p>
        </div>
        <div className="max-w-sm space-y-2 text-sm text-muted-foreground">
          <p>Log in to access your schedule, PR records, team, and all training tools — in one place.</p>
        </div>
        <Button size="lg" className="px-10" onClick={() => setShowAuth(true)} data-testid="button-guest-login">
          <User className="h-4 w-4 mr-2" />
          Log In / Sign Up
        </Button>
      </div>

      {/* Feature preview */}
      <div className="border-t bg-card/50 px-6 py-8">
        <p className="text-xs text-muted-foreground text-center uppercase tracking-widest mb-6">What's inside</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-xl mx-auto">
          {[
            { icon: <CalendarCheck className="h-4 w-4" />, label: "My Schedule" },
            { icon: <Trophy className="h-4 w-4" />, label: "PR Tracker" },
            { icon: <Users className="h-4 w-4" />, label: "Teams" },
            { icon: <CalendarPlus className="h-4 w-4" />, label: "Book Sessions" },
            { icon: <TrendingUp className="h-4 w-4" />, label: "Progress" },
            { icon: <User className="h-4 w-4" />, label: "Profile" },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-muted-foreground text-sm">
              {f.icon}
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {showAuth && (
        <OrgAuthModal
          orgId={orgId}
          programName={org?.name || "Portal"}
          onAuthenticated={onAuthenticated}
          onClose={() => setShowAuth(false)}
        />
      )}
    </div>
  );
}

function PortalHome({
  data,
  slug,
  orgId,
  orgToken,
  onLogout,
}: {
  data: any;
  slug: string;
  orgId: string;
  orgToken: string;
  onLogout: () => void;
}) {
  const { org, user, membership, upcomingBookings, pastBookingCount, schedulingPrograms, prTrackerPrograms, workoutBuilderPrograms, hasPrTracker, userTeams, recentPrEntries, bestPrs } = data;

  // Notification count
  const { data: notifData } = useQuery<any>({
    queryKey: ["/api/org/notifications", "unread"],
    queryFn: () =>
      fetch("/api/org/notifications?unreadOnly=true", { headers: { "X-Org-Auth-Token": orgToken } })
        .then((r) => r.json()),
    refetchInterval: 30000,
  });
  const unreadCount: number = notifData?.unreadCount ?? 0;

  // Today's activity events
  const { data: todayEventsData } = useQuery<any>({
    queryKey: ["/api/org/activity/calendar", "today", slug],
    queryFn: () =>
      fetch("/api/org/activity/calendar?view=today", { headers: { "X-Org-Auth-Token": orgToken } })
        .then((r) => r.json()),
    refetchInterval: 60000,
  });
  const todayEvents: any[] = todayEventsData?.events ?? [];

  // Nutrition progress (athletes)
  const { data: nutritionData } = useQuery<any>({
    queryKey: ["/api/org/nutrition/modules", slug],
    queryFn: () =>
      fetch("/api/org/nutrition/modules", { headers: { "X-Org-Auth-Token": orgToken } })
        .then((r) => r.json()),
    refetchInterval: 120000,
  });
  const nutritionStats = nutritionData?.stats;

  // Unread messages
  const { data: messagesData } = useQuery<any[]>({
    queryKey: ["/api/org/messages"],
    queryFn: () =>
      fetch("/api/org/messages", { headers: { "X-Org-Auth-Token": orgToken } })
        .then((r) => r.json()),
    refetchInterval: 60000,
  });
  const unreadMessages = (messagesData ?? []).filter((m: any) => !m.isRead);

  const isCoach = membership?.role === "coach" || membership?.role === "owner";
  const prTrackerUrl = prTrackerPrograms?.[0] ? `/org/${slug}/programs/${prTrackerPrograms[0].slug}` : null;
  const scheduleUrl = `/org/${slug}/athletic`;
  const myScheduleUrl = `/org/${slug}/my-schedule`;
  const nextBooking = upcomingBookings?.[0];

  let nextBookingDateLabel = "";
  if (nextBooking) {
    try { nextBookingDateLabel = format(parseISO(nextBooking.date), "EEE, MMM d"); } catch {}
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-7 w-auto rounded-md" />}
            <span className="font-semibold text-sm" data-testid="text-portal-org-name">{org?.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground hidden sm:block" data-testid="text-portal-user-name">{user?.name}</span>
            {/* Notification Bell */}
            <a href={`/org/${slug}/notifications`} className="relative" data-testid="link-notifications-bell">
              <Button size="sm" variant="ghost" title="Notifications">
                <Bell className="h-4 w-4" />
                {(unreadCount + unreadMessages.length) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {Math.min(unreadCount + unreadMessages.length, 99)}
                  </span>
                )}
              </Button>
            </a>
            <a href={`/org/${slug}/profile`} data-testid="link-profile-nav">
              <Button size="sm" variant="ghost" title="My Profile">
                <div className="h-6 w-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center">
                  {user?.name?.split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              </Button>
            </a>
            <Button size="sm" variant="ghost" onClick={onLogout} data-testid="button-portal-logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 space-y-6 pt-6">

        {/* Welcome */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-welcome-heading">
              Welcome back, {user?.name?.split(" ")[0]}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <RoleBadge role={membership?.role || "athlete"} />
              <span className="text-sm text-muted-foreground">{org?.name}</span>
            </div>
          </div>
          <LayoutDashboard className="h-8 w-8 text-primary/30 mt-1" />
        </div>

        {/* Quick Actions */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <ActionCard
              icon={<CalendarPlus className="h-5 w-5 text-primary" />}
              label="Book Session"
              description="Reserve a training slot"
              href={scheduleUrl}
              accent
            />
            <ActionCard
              icon={<CalendarCheck className="h-5 w-5 text-primary" />}
              label="My Schedule"
              description="Upcoming bookings"
              href={myScheduleUrl}
            />
            {hasPrTracker && prTrackerUrl && (
              <ActionCard
                icon={<Trophy className="h-5 w-5 text-amber-400" />}
                label="My PRs"
                description="Personal records"
                href={prTrackerUrl}
              />
            )}
            <ActionCard
              icon={<CalendarDays className="h-5 w-5 text-violet-400" />}
              label="My Calendar"
              description="Events & activity"
              href={`/org/${slug}/calendar`}
            />
            <ActionCard
              icon={<GraduationCap className="h-5 w-5 text-primary" />}
              label="Education"
              description="Pathways & learning modules"
              href={`/org/${slug}/education`}
            />
            <ActionCard
              icon={<ShieldCheck className="h-5 w-5 text-violet-400" />}
              label="Guardian Portal"
              description="Family progress view"
              href={`/org/${slug}/guardian`}
            />
            {userTeams?.length === 0 ? (
              <ActionCard
                icon={<Users className="h-5 w-5 text-blue-400" />}
                label="Join a Team"
                description="Enter your join code"
                href={prTrackerUrl || scheduleUrl}
              />
            ) : (
              <ActionCard
                icon={<Users className="h-5 w-5 text-blue-400" />}
                label="My Team"
                description={userTeams[0]?.teamName || "Team"}
                href={prTrackerUrl || scheduleUrl}
              />
            )}
            <ActionCard
              icon={<LayoutGrid className="h-5 w-5 text-violet-400" />}
              label="Programs"
              description="All available tools"
              href="#programs"
            />
            <ActionCard
              icon={<User className="h-5 w-5 text-muted-foreground" />}
              label="Profile"
              description="Account & settings"
              href={`/org/${slug}/profile`}
            />
          </div>
        </section>

        {/* Notices & Messages */}
        {(unreadMessages.length > 0 || (notifData?.notifications?.length ?? 0) > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" /> Notices
                {(unreadCount + unreadMessages.length) > 0 && (
                  <Badge className="text-[10px] h-4 px-1.5 bg-primary text-primary-foreground">{unreadCount + unreadMessages.length}</Badge>
                )}
              </h2>
              <a href={`/org/${slug}/notifications`} className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-view-all-notifications">
                View all <ArrowRight className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-2">
              {unreadMessages.slice(0, 2).map((msg: any) => (
                <a key={msg.id} href={`/org/${slug}/notifications`} data-testid={`card-notice-msg-${msg.id}`}>
                  <Card className="p-3 flex items-start gap-3 border-primary/20 bg-primary/[0.02] hover:border-primary/30 transition-colors">
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${msg.messageType === "team_announcement" ? "bg-violet-500/15 text-violet-400" : "bg-blue-500/15 text-blue-400"}`}>
                      {msg.messageType === "team_announcement" ? <Megaphone className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{msg.subject ?? (msg.messageType === "team_announcement" ? "Team Announcement" : "Message from Coach")}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{msg.body}</p>
                    </div>
                    <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                  </Card>
                </a>
              ))}
              {(notifData?.notifications ?? []).filter((n: any) => !n.isRead).slice(0, 2).map((n: any) => (
                <a key={n.id} href={`/org/${slug}/notifications`} data-testid={`card-notice-notif-${n.id}`}>
                  <Card className="p-3 flex items-start gap-3 border-primary/20 bg-primary/[0.02] hover:border-primary/30 transition-colors">
                    <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      <Bell className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{n.message}</p>
                    </div>
                    <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                  </Card>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ─── Today's Events Preview ───────────────────────────────────────────── */}
        {todayEvents.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-violet-400" /> Today's Events
                <Badge className="text-[10px] h-4 px-1.5 bg-violet-400/20 text-violet-400 border-violet-400/30">
                  {todayEvents.length}
                </Badge>
              </h2>
              <a href={`/org/${slug}/calendar`} className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-calendar-view-all">
                Calendar <ArrowRight className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-2">
              {todayEvents.slice(0, 3).map((ev: any) => {
                const colorMap: Record<string, string> = {
                  booking: "text-blue-400 bg-blue-400/10",
                  workout: "text-green-400 bg-green-400/10",
                  readiness: "text-rose-400 bg-rose-400/10",
                  pr: "text-amber-400 bg-amber-400/10",
                  alert: "text-orange-400 bg-orange-400/10",
                  message: "text-violet-400 bg-violet-400/10",
                  intelligence: "text-cyan-400 bg-cyan-400/10",
                };
                const IconMap: Record<string, any> = {
                  booking: CalendarDays, workout: Dumbbell, readiness: Heart,
                  pr: Trophy, alert: Zap, message: MessageSquare,
                  intelligence: TrendingUp,
                };
                const colorClass = colorMap[ev.sourceType] ?? "text-muted-foreground bg-muted/30";
                const Icon = IconMap[ev.sourceType] ?? Bell;
                return (
                  <a key={ev.id} href={`/org/${slug}/calendar`} data-testid={`card-today-event-${ev.id}`}>
                    <Card className="p-3 flex items-center gap-3 hover:border-primary/20 transition-colors">
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass.split(" ")[1]}`}>
                        <Icon className={`h-3.5 w-3.5 ${colorClass.split(" ")[0]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">{ev.title}</p>
                        {ev.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{ev.description}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </Card>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Nutrition Education Progress Card ──────────────────────────────── */}
        {!isCoach && nutritionStats && nutritionStats.completed < nutritionStats.total && (
          <section>
            <a href={`/org/${slug}/education`} data-testid="card-nutrition-progress">
              <Card className="p-4 border-emerald-500/20 bg-emerald-500/[0.02] hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-400/10 flex items-center justify-center">
                    <Leaf className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Nutrition Education</p>
                    <p className="text-xs text-muted-foreground">
                      {nutritionStats.completed} of {nutritionStats.total} modules complete
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
                    {nutritionStats.percentComplete}%
                  </Badge>
                </div>
                <div className="w-full bg-muted/30 rounded-full h-1.5">
                  <div
                    className="bg-emerald-400 h-1.5 rounded-full transition-all"
                    style={{ width: `${nutritionStats.percentComplete}%` }}
                  />
                </div>
                <p className="text-xs text-emerald-400 mt-2">
                  {nutritionStats.completed === 0
                    ? "Start Module 1 →"
                    : `Continue — Module ${nutritionStats.completed + 1} next →`}
                </p>
              </Card>
            </a>
          </section>
        )}

        {!isCoach && nutritionStats && nutritionStats.completed === nutritionStats.total && nutritionStats.total > 0 && (
          <section>
            <Card className="p-3 border-emerald-500/20 bg-emerald-500/[0.03] flex items-center gap-3">
              <Trophy className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-400">Nutrition Pathway Complete! 🎉</p>
                <p className="text-xs text-muted-foreground">All 6 fueling modules finished</p>
              </div>
            </Card>
          </section>
        )}

        {/* Upcoming Sessions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">My Schedule</h2>
            <a href={myScheduleUrl} className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </a>
          </div>
          {nextBooking ? (
            <Card className="p-4 border-primary/20 bg-primary/5 space-y-3" data-testid="card-next-booking">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-primary/20 p-2">
                    <CalendarCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm" data-testid="text-next-booking-team">{nextBooking.teamName}</p>
                    <p className="text-xs text-muted-foreground" data-testid="text-next-booking-date">
                      {nextBookingDateLabel} · {formatHour(parseTimeSlot(nextBooking.timeSlot))}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="flex-shrink-0" data-testid="badge-next-booking-type">
                  {nextBooking.trainingType}
                </Badge>
              </div>
              {upcomingBookings.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  +{upcomingBookings.length - 1} more upcoming · {pastBookingCount} past sessions
                </p>
              )}
              <div className="flex gap-2">
                <a href={myScheduleUrl} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">View My Schedule</Button>
                </a>
                <a href={scheduleUrl} className="flex-1">
                  <Button size="sm" className="w-full">Book Session</Button>
                </a>
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-center space-y-3" data-testid="card-no-bookings">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
              <div>
                <p className="font-medium text-sm">No upcoming sessions</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pastBookingCount > 0
                    ? `You've completed ${pastBookingCount} past session${pastBookingCount === 1 ? "" : "s"}.`
                    : "Book your first training slot to get started."}
                </p>
              </div>
              <a href={scheduleUrl}>
                <Button size="sm">
                  <CalendarPlus className="h-4 w-4 mr-1.5" /> Book a Session
                </Button>
              </a>
            </Card>
          )}
        </section>

        {/* PR Tracker Preview */}
        {hasPrTracker && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">PR Tracker</h2>
              {prTrackerUrl && (
                <a href={prTrackerUrl} className="text-xs text-primary hover:underline flex items-center gap-1">
                  Open <ArrowRight className="h-3 w-3" />
                </a>
              )}
            </div>
            <Card className="p-4 space-y-3" data-testid="card-pr-preview">
              {bestPrs && bestPrs.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Trophy className="h-4 w-4 text-amber-400" />
                    <span>Your Best Lifts</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {bestPrs.slice(0, 4).map((pr: any) => (
                      <div key={pr.liftTypeId} className="rounded-lg bg-muted/50 p-2.5 space-y-0.5" data-testid={`card-pr-${pr.liftTypeId}`}>
                        <p className="text-xs text-muted-foreground truncate">{pr.liftTypeName}</p>
                        <p className="text-lg font-bold leading-tight" data-testid={`text-pr-value-${pr.liftTypeId}`}>
                          {pr.value} <span className="text-xs font-normal text-muted-foreground">{pr.unit}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                  {prTrackerUrl && (
                    <a href={prTrackerUrl}>
                      <Button variant="outline" size="sm" className="w-full">
                        <TrendingUp className="h-4 w-4 mr-1.5" /> View All PRs & Log New
                      </Button>
                    </a>
                  )}
                </>
              ) : (
                <div className="text-center py-4 space-y-2">
                  <Trophy className="h-8 w-8 text-muted-foreground mx-auto" />
                  <div>
                    <p className="text-sm font-medium">No PRs logged yet</p>
                    <p className="text-xs text-muted-foreground">Start tracking your personal records.</p>
                  </div>
                  {prTrackerUrl && (
                    <a href={prTrackerUrl}>
                      <Button size="sm">Open PR Tracker</Button>
                    </a>
                  )}
                </div>
              )}
            </Card>
          </section>
        )}

        {/* Teams */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {isCoach ? "Teams" : "My Team"}
            </h2>
            {isCoach && prTrackerUrl && (
              <a href={prTrackerUrl} className="text-xs text-primary hover:underline flex items-center gap-1">
                Manage <ArrowRight className="h-3 w-3" />
              </a>
            )}
          </div>
          {userTeams && userTeams.length > 0 ? (
            <div className="space-y-2">
              {userTeams.map((team: any) => (
                <Card key={team.teamId} className="p-4 flex items-center gap-3" data-testid={`card-team-${team.teamId}`}>
                  <div className="rounded-lg bg-blue-500/10 p-2">
                    <Users className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" data-testid={`text-team-name-${team.teamId}`}>{team.teamName}</p>
                    <p className="text-xs text-muted-foreground">{team.sport}{team.season ? ` · ${team.season}` : ""}</p>
                  </div>
                  <Badge variant="outline" className="flex-shrink-0 text-xs">{team.memberRole}</Badge>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-5 text-center space-y-3" data-testid="card-no-teams">
              <Users className="h-8 w-8 text-muted-foreground mx-auto" />
              <div>
                <p className="text-sm font-medium">{isCoach ? "No teams created yet" : "You're not on a team"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isCoach ? "Create teams in the PR Tracker." : "Ask your coach for a join code."}
                </p>
              </div>
              {prTrackerUrl && (
                <a href={prTrackerUrl}>
                  <Button size="sm" variant="outline">
                    {isCoach ? "Create Team" : "Join a Team"}
                  </Button>
                </a>
              )}
            </Card>
          )}
        </section>

        {/* Programs */}
        <section id="programs">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Programs & Tools</h2>
          <div className="space-y-2">
            {schedulingPrograms?.map((p: any) => (
              <a key={p.id} href={`/org/${slug}/athletic/${p.slug}`} data-testid={`link-program-${p.id}`}>
                <Card className="p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <CalendarPlus className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{formatHour(p.startHour)} – {formatHour(p.endHour)}</p>
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0">Schedule</Badge>
                </Card>
              </a>
            ))}
            {prTrackerPrograms?.map((p: any) => (
              <a key={p.id} href={`/org/${slug}/programs/${p.slug}`} data-testid={`link-pr-program-${p.id}`}>
                <Card className="p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
                  <div className="rounded-lg bg-amber-500/10 p-2">
                    <Trophy className="h-5 w-5 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">Log and track personal records</p>
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0">PR Tracker</Badge>
                </Card>
              </a>
            ))}
            {workoutBuilderPrograms?.map((p: any) => (
              <a key={p.id} href={`/org/${slug}/programs/${p.slug}`} data-testid={`link-workout-program-${p.id}`}>
                <Card className="p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Dumbbell className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{isCoach ? "Generate and assign workouts" : "View assigned workouts"}</p>
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0">Workout Builder</Badge>
                </Card>
              </a>
            ))}
          </div>
        </section>

        {/* ─── Coach: Athlete Alerts Panel ─────────────────────────────────── */}
        {isCoach && (() => {
          const coachAlerts = (notifData?.notifications ?? []).filter((n: any) => n.type === "coach_alert" && !n.isRead);
          if (coachAlerts.length === 0) return null;
          const prSpikes    = coachAlerts.filter((n: any) => (n.metadata as any)?.severity === "positive").length;
          const missed      = coachAlerts.filter((n: any) => (n.title ?? "").includes("missed")).length;
          const lowReady    = coachAlerts.filter((n: any) => (n.title ?? "").toLowerCase().includes("readiness")).length;
          const highFatigue = coachAlerts.filter((n: any) => (n.title ?? "").toLowerCase().includes("fatigue")).length;
          return (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-orange-400" /> Athlete Alerts
                  <Badge className="text-[10px] h-4 px-1.5 bg-orange-400/20 text-orange-400 border-orange-400/30">
                    {coachAlerts.length}
                  </Badge>
                </h2>
                <a href={`/org/${slug}/notifications`} className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-coach-view-all-alerts">
                  View all <ArrowRight className="h-3 w-3" />
                </a>
              </div>

              {/* Digest summary row */}
              {(prSpikes + missed + lowReady + highFatigue) > 0 && (
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {prSpikes > 0 && (
                    <Card className="p-2.5 text-center border-emerald-500/20 bg-emerald-500/[0.03]">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400 mx-auto mb-0.5" />
                      <p className="text-sm font-bold">{prSpikes}</p>
                      <p className="text-[10px] text-muted-foreground">PR Spike{prSpikes !== 1 ? "s" : ""}</p>
                    </Card>
                  )}
                  {missed > 0 && (
                    <Card className="p-2.5 text-center border-red-500/20 bg-red-500/[0.03]">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400 mx-auto mb-0.5" />
                      <p className="text-sm font-bold">{missed}</p>
                      <p className="text-[10px] text-muted-foreground">Missed</p>
                    </Card>
                  )}
                  {lowReady > 0 && (
                    <Card className="p-2.5 text-center border-rose-500/20 bg-rose-500/[0.03]">
                      <Heart className="h-3.5 w-3.5 text-rose-400 mx-auto mb-0.5" />
                      <p className="text-sm font-bold">{lowReady}</p>
                      <p className="text-[10px] text-muted-foreground">Low Ready</p>
                    </Card>
                  )}
                  {highFatigue > 0 && (
                    <Card className="p-2.5 text-center border-orange-500/20 bg-orange-500/[0.03]">
                      <Zap className="h-3.5 w-3.5 text-orange-400 mx-auto mb-0.5" />
                      <p className="text-sm font-bold">{highFatigue}</p>
                      <p className="text-[10px] text-muted-foreground">Fatigue</p>
                    </Card>
                  )}
                </div>
              )}

              {/* Top 3 alerts */}
              <div className="space-y-2">
                {coachAlerts.slice(0, 3).map((n: any) => {
                  const meta = (n.metadata as any) ?? {};
                  const isPositive = meta.severity === "positive";
                  const isHigh     = meta.severity === "high";
                  return (
                    <a key={n.id} href={`/org/${slug}/notifications`} data-testid={`card-coach-alert-${n.id}`}>
                      <Card className={`p-3 flex items-start gap-3 transition-colors hover:border-primary/20
                        ${isPositive ? "border-emerald-500/20 bg-emerald-500/[0.02]" : ""}
                        ${isHigh ? "border-red-500/20 bg-red-500/[0.02]" : ""}
                        ${!isPositive && !isHigh ? "border-orange-500/20 bg-orange-500/[0.02]" : ""}
                      `}>
                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0
                          ${isPositive ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400"}
                        `}>
                          {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">{n.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{n.message}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                      </Card>
                    </a>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* ─── Athlete: Today's Reminders & Celebrations ────────────────────── */}
        {!isCoach && (() => {
          const todayItems = (notifData?.notifications ?? []).filter((n: any) => {
            if (n.isRead) return false;
            const hrs = (Date.now() - new Date(n.createdAt).getTime()) / 3600000;
            return hrs < 24 && ["pr_celebration", "workout_assigned", "readiness_followup"].includes(n.type);
          });
          if (todayItems.length === 0) return null;
          return (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-amber-400" /> Today's Highlights
                </h2>
                <a href={`/org/${slug}/notifications`} className="text-xs text-primary hover:underline flex items-center gap-1">
                  See all <ArrowRight className="h-3 w-3" />
                </a>
              </div>
              <div className="space-y-2">
                {todayItems.slice(0, 3).map((n: any) => {
                  const isPr = n.type === "pr_celebration";
                  return (
                    <a key={n.id} href={`/org/${slug}/notifications`} data-testid={`card-today-highlight-${n.id}`}>
                      <Card className={`p-3 flex items-start gap-3 hover:border-primary/20 transition-colors
                        ${isPr ? "border-amber-400/20 bg-amber-400/[0.03]" : "border-primary/20 bg-primary/[0.02]"}
                      `}>
                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0
                          ${isPr ? "bg-amber-400/15 text-amber-400" : "bg-primary/10 text-primary"}
                        `}>
                          {isPr ? <Trophy className="h-3.5 w-3.5" /> : <Dumbbell className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">{n.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{n.message}</p>
                        </div>
                      </Card>
                    </a>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Coach Admin Section */}
        {isCoach && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Coach Admin</h2>
            <div className="grid grid-cols-2 gap-3">
              <ActionCard
                icon={<CalendarCheck className="h-5 w-5 text-primary" />}
                label="Coach Schedule"
                description="All team bookings"
                href={myScheduleUrl}
              />
              <ActionCard
                icon={<Users className="h-5 w-5 text-blue-400" />}
                label="Team Reports"
                description="Rosters & player cards"
                href={`/org/${slug}/coach/teams`}
              />
              {prTrackerUrl && (
                <ActionCard
                  icon={<Users className="h-5 w-5 text-blue-400" />}
                  label="Manage Athletes"
                  description="PR tracker teams"
                  href={prTrackerUrl}
                />
              )}
              <ActionCard
                icon={<Activity className="h-5 w-5 text-cyan-400" />}
                label="Team Timeline"
                description="Org-wide activity feed"
                href={`/org/${slug}/coach/timeline`}
              />
              <ActionCard
                icon={<GraduationCap className="h-5 w-5 text-primary" />}
                label="Education Builder"
                description="Build & manage pathways"
                href={`/org/${slug}/coach/education-builder`}
              />
              <ActionCard
                icon={<ShieldCheck className="h-5 w-5 text-violet-400" />}
                label="Guardian Management"
                description="Family access & invites"
                href={`/org/${slug}/coach/guardians`}
              />
              <ActionCard
                icon={<CalendarDays className="h-5 w-5 text-violet-400" />}
                label="Org Calendar"
                description="All events at a glance"
                href={`/org/${slug}/calendar`}
              />
              <ActionCard
                icon={<Settings2 className="h-5 w-5 text-muted-foreground" />}
                label="Booking Settings"
                description="Login & guest rules"
                href={`/org/${slug}/athletic`}
              />
              {prTrackerUrl && (
                <ActionCard
                  icon={<Trophy className="h-5 w-5 text-amber-400" />}
                  label="PR Admin"
                  description="Manage & review PRs"
                  href={prTrackerUrl}
                />
              )}
            </div>
            {data.totalAthletes !== undefined && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <Card className="p-3 text-center">
                  <p className="text-lg font-bold" data-testid="text-total-athletes">{data.totalAthletes}</p>
                  <p className="text-xs text-muted-foreground">Athletes</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-lg font-bold" data-testid="text-total-teams">{data.totalTeams}</p>
                  <p className="text-xs text-muted-foreground">Teams</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-lg font-bold" data-testid="text-total-bookings">{data.totalBookings}</p>
                  <p className="text-xs text-muted-foreground">Bookings</p>
                </Card>
              </div>
            )}
          </section>
        )}

        {/* Profile */}
        <section id="profile">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Profile</h2>
          <Card className="p-4 space-y-3" data-testid="card-profile">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-3">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold" data-testid="text-profile-name">{user?.name}</p>
                <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{user?.email}</p>
              </div>
              <div className="ml-auto">
                <RoleBadge role={membership?.role || "athlete"} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground border-t pt-3">
              <div>
                <p className="font-medium text-foreground">Organization</p>
                <p>{org?.name}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Member Since</p>
                <p>{membership?.createdAt ? format(new Date(membership.createdAt), "MMM yyyy") : "—"}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout} className="w-full" data-testid="button-profile-logout">
              <LogOut className="h-4 w-4 mr-1.5" /> Log Out
            </Button>
          </Card>
        </section>

      </div>
    </div>
  );
}

export default function OrgPortalPage() {
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
  const [, setOrgUser] = useState<any>(null);

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

  const { data: portalData, isLoading: portalLoading } = useQuery<any>({
    queryKey: ["/api/org/portal/bootstrap", orgId, orgToken],
    queryFn: async () => {
      const res = await fetch(`/api/org/portal/bootstrap?orgId=${orgId}`, {
        headers: { "X-Org-Auth-Token": orgToken! },
      });
      if (!res.ok) throw new Error("Failed to load portal");
      return res.json();
    },
    enabled: !!orgToken && !!orgId,
  });

  function handleAuthenticated(token: string, user: any) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setOrgUser(user);
  }

  function handleLogout() {
    if (orgId) localStorage.removeItem(`orgToken_${orgId}`);
    setOrgToken(null);
    setOrgUser(null);
  }

  if (orgLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!orgToken) {
    return (
      <GuestPreview
        org={org}
        orgId={orgId || ""}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (portalLoading || !portalData) {
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
            {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-7 w-auto rounded-md mr-2" />}
            <span className="font-semibold text-sm">{org?.name}</span>
          </div>
        </div>
        <PortalSkeleton />
      </div>
    );
  }

  return (
    <PortalHome
      data={portalData}
      slug={slug}
      orgId={orgId}
      orgToken={orgToken!}
      onLogout={handleLogout}
    />
  );
}
