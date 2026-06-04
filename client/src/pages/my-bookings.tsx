import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import {
  Calendar, Clock, X, Users, MapPin, Dumbbell, ChevronRight,
  Target, Star, DollarSign, ExternalLink, UserCheck, Zap,
} from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { AddSessionDialog } from "@/components/add-session-dialog";
import type { BookingWithDetails, OpenSession } from "@/lib/types";
import type { UserProfile } from "@shared/schema";
import {
  PortalPageHero,
  PortalFadeUp,
  PortalSectionReveal,
  UpcomingSessionCard,
  SessionPulseDot,
} from "@/components/ClientPortalMotion";

// ─── Status colours ───────────────────────────────────────────────────────────
const statusColors: Record<string, string> = {
  PENDING:   "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  CONFIRMED: "bg-green-500/15 text-green-700 dark:text-green-400",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  NO_SHOW:   "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

// ─── Session-type label / colour map ─────────────────────────────────────────
const sessionTypeLabel: Record<string, string> = {
  "1_ON_1":         "1-on-1",
  GROUP:            "Group",
  SEMI_PRIVATE:     "Semi-Private",
  TEAM_TRAINING:    "Team Training",
  ASSESSMENT:       "Assessment",
  RECOVERY:         "Recovery",
};

const sessionTypeBadge: Record<string, string> = {
  "1_ON_1":         "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  GROUP:            "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  SEMI_PRIVATE:     "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  TEAM_TRAINING:    "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  ASSESSMENT:       "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  RECOVERY:         "bg-teal-500/15 text-teal-700 dark:text-teal-400",
};

// ─── Capacity bar ─────────────────────────────────────────────────────────────
function CapacityBar({ filled, max }: { filled: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((filled / max) * 100)) : 0;
  const color = pct >= 100 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{filled} of {max} spots filled</span>
        <span>{max - filled} remaining</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Session-type badge ───────────────────────────────────────────────────────
function SessionTypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  const label = sessionTypeLabel[type] || type;
  const cls   = sessionTypeBadge[type] || "bg-secondary text-secondary-foreground";
  return (
    <Badge className={`text-xs ${cls}`}>
      {type === "1_ON_1" ? <UserCheck className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
      {label}
    </Badge>
  );
}

// ─── Enriched booking type (from updated API) ────────────────────────────────
type EnrichedBooking = BookingWithDetails & {
  participantCount?: number;
  spotsRemaining?: number | null;
  userIsParticipant?: boolean;
  sessionType?: string;
  priceCents?: number;
  isFree?: boolean;
};

// ─── Single booking card (shared between Upcoming / Past) ────────────────────
function BookingCard({
  booking,
  onCancel,
  cancelling,
  showCancel,
}: {
  booking: EnrichedBooking;
  onCancel?: () => void;
  cancelling?: boolean;
  showCancel?: boolean;
}) {
  const isGroup = !!booking.maxParticipants;
  const filled  = booking.participantCount ?? 0;
  const max     = booking.maxParticipants ?? 0;

  return (
    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
      <div className="space-y-1.5 flex-1">
        {/* Title + badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">{booking.service?.name || "Session"}</h3>
          <Badge className={`text-xs ${statusColors[booking.status] || ""}`}>
            {booking.status}
          </Badge>
          <SessionTypeBadge type={booking.sessionType} />
          {booking.isFree ? (
            <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400">Free</Badge>
          ) : booking.priceCents && booking.priceCents > 0 ? (
            <Badge variant="outline" className="text-xs">
              <DollarSign className="h-3 w-3 mr-0.5" />
              {(booking.priceCents / 100).toFixed(0)}
            </Badge>
          ) : null}
          {booking.userIsParticipant && !booking.service && (
            <Badge variant="secondary" className="text-xs">Joined as participant</Badge>
          )}
        </div>

        {/* Date / time */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          {format(parseISO(booking.startAt as unknown as string), "EEEE, MMM d, yyyy")}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {format(parseISO(booking.startAt as unknown as string), "h:mm a")} —{" "}
          {format(parseISO(booking.endAt as unknown as string), "h:mm a")}
        </div>

        {/* Coach */}
        {booking.coach?.user && (
          <p className="text-sm text-muted-foreground">
            Coach: {booking.coach.user.firstName} {booking.coach.user.lastName}
          </p>
        )}

        {/* Location */}
        {booking.location && (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid={`text-location-${booking.id}`}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {booking.location}
          </div>
        )}

        {/* Sport / age / skill — in a row */}
        {(booking.sport || booking.ageRange || booking.skillLevel) && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {booking.sport && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Dumbbell className="h-3 w-3" />{booking.sport}
              </span>
            )}
            {booking.ageRange && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Target className="h-3 w-3" />Ages {booking.ageRange}
              </span>
            )}
            {booking.skillLevel && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Star className="h-3 w-3" />{booking.skillLevel}
              </span>
            )}
          </div>
        )}

        {/* Capacity bar for group sessions */}
        {isGroup && max > 0 && (
          <div className="pt-1">
            <CapacityBar filled={filled} max={max} />
          </div>
        )}

        {/* Group description */}
        {isGroup && booking.groupDescription && (
          <p className="text-sm text-muted-foreground">{booking.groupDescription}</p>
        )}
      </div>

      {/* Cancel button */}
      {showCancel && onCancel && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={cancelling}
              data-testid={`button-cancel-booking-${booking.id}`}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. Your session will be cancelled.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`button-keep-booking-${booking.id}`}>
                Keep Booking
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid={`button-confirm-cancel-${booking.id}`}
                onClick={onCancel}
              >
                Yes, Cancel Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ─── Available session card (joinable) ────────────────────────────────────────
function AvailableSessionCard({ session, onJoin, joining }: {
  session: OpenSession;
  onJoin: () => void;
  joining: boolean;
}) {
  const filled  = session.participantCount ?? 0;
  const max     = session.maxParticipants ?? 0;
  const isFull  = max > 0 && filled >= max;
  const svcType = (session.service as any)?.sessionType as string | undefined;

  return (
    <Card className="p-4 border border-border/70 bg-card" data-testid={`card-available-${session.id}`}>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          {/* Title + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{session.service?.name || "Open Session"}</h3>
            {isFull ? (
              <Badge className="text-xs bg-orange-500/15 text-orange-700 dark:text-orange-400">Full</Badge>
            ) : (
              <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400">Open</Badge>
            )}
            <SessionTypeBadge type={svcType || "GROUP"} />
            {(session.service as any)?.priceCents === 0 || !(session.service as any)?.priceCents ? (
              <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400">Free</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                <DollarSign className="h-3 w-3 mr-0.5" />
                {((session.service as any).priceCents / 100).toFixed(0)}
              </Badge>
            )}
          </div>

          {/* Date / time */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {format(parseISO(session.startAt as unknown as string), "EEEE, MMM d, yyyy")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {format(parseISO(session.startAt as unknown as string), "h:mm a")} —{" "}
            {format(parseISO(session.endAt as unknown as string), "h:mm a")}
          </div>

          {/* Coach */}
          {session.coach?.user && (
            <p className="text-sm text-muted-foreground">
              Coach: {session.coach.user.firstName} {session.coach.user.lastName}
            </p>
          )}

          {/* Location */}
          {session.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {session.location}
            </div>
          )}

          {/* Sport / age / skill */}
          {(session.sport || session.ageRange || session.skillLevel) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {session.sport && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Dumbbell className="h-3 w-3" />{session.sport}
                </span>
              )}
              {session.ageRange && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Target className="h-3 w-3" />Ages {session.ageRange}
                </span>
              )}
              {session.skillLevel && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Star className="h-3 w-3" />{session.skillLevel}
                </span>
              )}
            </div>
          )}

          {/* Capacity */}
          {max > 0 && (
            <div className="pt-1">
              <CapacityBar filled={filled} max={max} />
            </div>
          )}
        </div>

        {/* Join button */}
        <Button
          size="sm"
          disabled={isFull || joining}
          onClick={onJoin}
          data-testid={`button-join-session-${session.id}`}
        >
          <Zap className="h-3.5 w-3.5 mr-1" />
          {isFull ? "Full" : joining ? "Joining…" : "Join Session"}
        </Button>
      </div>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MyBookingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { data: bookings, isLoading } = useQuery<EnrichedBooking[]>({
    queryKey: ["/api/bookings"],
  });

  const { data: openSessions, isLoading: loadingOpen } = useQuery<OpenSession[]>({
    queryKey: ["/api/sessions/open"],
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";

  // ── Cancel mutation ──
  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, {
        status: "CANCELLED",
      });
      return res.json();
    },
    onSuccess: () => {
      setCancellingId(null);
      toast({ title: "Booking Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
    },
    onError: (error: Error) => {
      setCancellingId(null);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again…", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ── Join mutation ──
  const joinMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("POST", `/api/bookings/${bookingId}/join`, {});
      return res.json();
    },
    onSuccess: () => {
      setJoiningId(null);
      toast({ title: "Joined!", description: "You've been added to the session." });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
    },
    onError: (error: Error) => {
      setJoiningId(null);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again…", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ── Splits ──
  const upcoming = (
    bookings?.filter(
      (b) =>
        ["CONFIRMED", "PENDING"].includes(b.status) &&
        !isPast(parseISO(b.startAt as unknown as string))
    ) || []
  ).sort(
    (a, b) =>
      parseISO(a.startAt as unknown as string).getTime() -
      parseISO(b.startAt as unknown as string).getTime()
  );

  const past = (
    bookings?.filter(
      (b) =>
        !["CONFIRMED", "PENDING"].includes(b.status) ||
        isPast(parseISO(b.startAt as unknown as string))
    ) || []
  ).sort(
    (a, b) =>
      parseISO(b.startAt as unknown as string).getTime() -
      parseISO(a.startAt as unknown as string).getTime()
  );

  // Filter out sessions user already joined from available list
  const bookedIds = new Set(bookings?.map((b) => b.id) ?? []);
  const availableSessions = (openSessions ?? []).filter(
    (s) => !bookedIds.has(s.id) && !isPast(parseISO(s.startAt as unknown as string))
  );

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PortalPageHero className="rounded-xl px-5 py-6 border border-border/40 bg-card/50">
        <PortalFadeUp>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1
                className="text-2xl font-serif font-bold"
                data-testid="text-bookings-title"
              >
                My Bookings
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage your training sessions
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isCoach && <AddSessionDialog />}
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/open-sessions")}
                data-testid="button-browse-all-sessions"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Browse All Sessions
              </Button>
            </div>
          </div>
        </PortalFadeUp>
      </PortalPageHero>

      <PortalSectionReveal delay={0.05}>
        <Tabs defaultValue="upcoming">
          <TabsList>
            <TabsTrigger value="upcoming" data-testid="tab-upcoming">
              <span className="flex items-center gap-2">
                {upcoming.length > 0 && <SessionPulseDot />}
                Upcoming ({upcoming.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="past" data-testid="tab-past">
              Past ({past.length})
            </TabsTrigger>
            <TabsTrigger value="available" data-testid="tab-available">
              <span className="flex items-center gap-2">
                {availableSessions.length > 0 && (
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
                Available ({availableSessions.length})
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Upcoming ── */}
          <TabsContent value="upcoming" className="space-y-3 mt-4">
            {upcoming.length === 0 ? (
              <Card className="p-8 text-center">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No upcoming sessions</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => navigate("/coaches")}
                  data-testid="button-browse-coaches"
                >
                  Browse Coaches
                </Button>
              </Card>
            ) : (
              upcoming.map((b) => (
                <UpcomingSessionCard key={b.id}>
                  <Card
                    className="p-4 border border-border/70 bg-card"
                    data-testid={`card-booking-${b.id}`}
                  >
                    <BookingCard
                      booking={b}
                      showCancel={b.status === "CONFIRMED"}
                      cancelling={cancelMutation.isPending && cancellingId === b.id}
                      onCancel={() => {
                        setCancellingId(b.id);
                        cancelMutation.mutate(b.id);
                      }}
                    />
                  </Card>
                </UpcomingSessionCard>
              ))
            )}
          </TabsContent>

          {/* ── Past ── */}
          <TabsContent value="past" className="space-y-3 mt-4">
            {past.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">No past sessions</p>
              </Card>
            ) : (
              past.map((b) => (
                <Card
                  key={b.id}
                  className="p-4"
                  data-testid={`card-booking-${b.id}`}
                >
                  <BookingCard booking={b} />
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── Available Sessions ── */}
          <TabsContent value="available" className="space-y-3 mt-4">
            {loadingOpen ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)
            ) : availableSessions.length === 0 ? (
              <Card className="p-8 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No open sessions available right now</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Check back later or browse all sessions
                </p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => navigate("/open-sessions")}
                  data-testid="button-view-open-sessions"
                >
                  View Open Sessions
                </Button>
              </Card>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Sessions you can join right now — group, semi-private, team training, and more.
                </p>
                {availableSessions.map((s) => (
                  <AvailableSessionCard
                    key={s.id}
                    session={s}
                    joining={joinMutation.isPending && joiningId === s.id}
                    onJoin={() => {
                      setJoiningId(s.id);
                      joinMutation.mutate(s.id);
                    }}
                  />
                ))}
                <div className="pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => navigate("/open-sessions")}
                    data-testid="button-see-all-open"
                  >
                    See all open sessions
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PortalSectionReveal>
    </div>
  );
}
