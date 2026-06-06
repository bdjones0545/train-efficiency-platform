import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import {
  Calendar, Clock, X, Users, MapPin, Dumbbell, ExternalLink,
  UserCheck, Zap, ChevronDown, ChevronRight, SlidersHorizontal,
  DollarSign, Target, Star, LayoutList, UsersRound,
} from "lucide-react";
import { format, parseISO, isPast, isWithinInterval, addDays, startOfDay } from "date-fns";
import { AddSessionDialog } from "@/components/add-session-dialog";
import type { BookingWithDetails, OpenSession } from "@/lib/types";
import type { UserProfile } from "@shared/schema";
import {
  PortalPageHero, PortalFadeUp, PortalSectionReveal,
  UpcomingSessionCard, SessionPulseDot,
} from "@/components/ClientPortalMotion";

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PENDING:   "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  CONFIRMED: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  NO_SHOW:   "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

const TYPE_LABELS: Record<string, string> = {
  "1_ON_1":      "1-on-1",
  GROUP:         "Group",
  SEMI_PRIVATE:  "Semi-Private",
  TEAM_TRAINING: "Team Training",
  ASSESSMENT:    "Assessment",
  RECOVERY:      "Recovery",
};

const TYPE_COLORS: Record<string, string> = {
  "1_ON_1":      "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  GROUP:         "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20",
  SEMI_PRIVATE:  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  TEAM_TRAINING: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
  ASSESSMENT:    "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  RECOVERY:      "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/20",
};

const TYPE_BORDER: Record<string, string> = {
  "1_ON_1":      "rgb(59 130 246)",
  GROUP:         "rgb(168 85 247)",
  SEMI_PRIVATE:  "rgb(99 102 241)",
  TEAM_TRAINING: "rgb(249 115 22)",
  ASSESSMENT:    "rgb(6 182 212)",
  RECOVERY:      "rgb(20 184 166)",
};

const FILTER_TYPES = [
  { value: "all",          label: "All" },
  { value: "1_ON_1",       label: "1-on-1" },
  { value: "SEMI_PRIVATE", label: "Semi-Private" },
  { value: "GROUP",        label: "Group" },
  { value: "TEAM_TRAINING",label: "Team Training" },
  { value: "ASSESSMENT",   label: "Assessment" },
  { value: "RECOVERY",     label: "Recovery" },
  { value: "CANCELLED",    label: "Cancelled" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrichedBooking = BookingWithDetails & {
  participantCount?: number;
  spotsRemaining?: number | null;
  userIsParticipant?: boolean;
  sessionType?: string;
  priceCents?: number;
  isFree?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coachName(b: EnrichedBooking): string {
  if (!b.coach?.user) return "Unassigned";
  return `Coach ${b.coach.user.firstName} ${b.coach.user.lastName}`;
}

function coachInitials(b: EnrichedBooking): string {
  const u = b.coach?.user;
  if (!u) return "?";
  return `${u.firstName?.[0] || ""}${u.lastName?.[0] || ""}`.toUpperCase();
}

// ─── Compact Booking Card ─────────────────────────────────────────────────────

function CompactBookingCard({
  booking, onViewDetails, onCancel, cancelling, showCancel,
}: {
  booking: EnrichedBooking;
  onViewDetails: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  showCancel?: boolean;
}) {
  const startDate = parseISO(booking.startAt as unknown as string);
  const endDate   = parseISO(booking.endAt   as unknown as string);
  const type      = booking.sessionType || "1_ON_1";
  const borderColor = TYPE_BORDER[type] || "rgb(156 163 175)";

  return (
    <Card
      className="overflow-hidden border-l-4 hover:shadow-sm transition-shadow"
      style={{ borderLeftColor: borderColor }}
      data-testid={`card-booking-${booking.id}`}
    >
      <div className="p-3 sm:p-4 space-y-2">
        {/* Row 1: type badge + status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${TYPE_COLORS[type] || "bg-secondary text-secondary-foreground"}`}>
            {type === "1_ON_1" ? <UserCheck className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
            {TYPE_LABELS[type] || type}
          </Badge>
          <Badge className={`text-xs ${STATUS_COLORS[booking.status] || ""}`}>
            {booking.status}
          </Badge>
          {booking.isFree && (
            <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20">FREE</Badge>
          )}
        </div>

        {/* Session name */}
        <p className="font-semibold text-sm leading-tight">{booking.service?.name || "Session"}</p>

        {/* Date + time */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {format(startDate, "EEE, MMM d")}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {format(startDate, "h:mm a")} – {format(endDate, "h:mm a")}
          </span>
        </div>

        {/* Coach */}
        {booking.coach?.user && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Avatar className="h-4 w-4 shrink-0">
              <AvatarImage src={booking.coach.photoUrl || booking.coach.user.profileImageUrl || undefined} />
              <AvatarFallback className="text-[8px] bg-primary/10 text-primary">{coachInitials(booking)}</AvatarFallback>
            </Avatar>
            {coachName(booking)}
          </p>
        )}

        {/* Location — wraps, no truncation */}
        {booking.location && (
          <p className="text-sm text-muted-foreground flex items-start gap-1.5" data-testid={`text-location-${booking.id}`}>
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{booking.location}</span>
          </p>
        )}

        {/* Sport · Skill chips */}
        {(booking.sport || booking.skillLevel || booking.ageRange) && (
          <div className="flex flex-wrap gap-1.5">
            {booking.sport && (
              <Badge variant="outline" className="text-xs py-0">
                <Dumbbell className="h-3 w-3 mr-1" />{booking.sport}
              </Badge>
            )}
            {booking.skillLevel && (
              <Badge variant="outline" className="text-xs py-0">{booking.skillLevel}</Badge>
            )}
            {booking.ageRange && (
              <Badge variant="outline" className="text-xs py-0">Ages {booking.ageRange}</Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onViewDetails}
            data-testid={`button-view-booking-${booking.id}`}
          >
            <ChevronRight className="h-3.5 w-3.5 mr-1" />
            View Details
          </Button>
          {showCancel && onCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
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
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid={`button-keep-booking-${booking.id}`}>Keep Booking</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground"
                    data-testid={`button-confirm-cancel-${booking.id}`}
                    onClick={onCancel}
                  >
                    Yes, Cancel
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Booking Detail Drawer ────────────────────────────────────────────────────

function BookingDetailDrawer({
  booking, onClose, onCancel, cancelling,
}: {
  booking: EnrichedBooking | null;
  onClose: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const [showDescription, setShowDescription] = useState(false);
  if (!booking) return null;

  const startDate  = parseISO(booking.startAt as unknown as string);
  const endDate    = parseISO(booking.endAt   as unknown as string);
  const type       = booking.sessionType || "1_ON_1";
  const count      = booking.participantCount ?? 0;
  const max        = booking.maxParticipants ?? 0;
  const spotsLeft  = max > 0 ? max - count : null;
  const fillPct    = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
  const canCancel  = booking.status === "CONFIRMED" || booking.status === "PENDING";

  return (
    <Dialog open={!!booking} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90dvh] flex flex-col p-0 gap-0 sm:rounded-lg rounded-t-2xl fixed bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 translate-y-0 sm:translate-x-[-50%] left-0 sm:left-1/2"
        data-testid="drawer-booking-detail"
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4 border-b">
          <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mb-4 sm:hidden" />
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge className={`text-xs ${TYPE_COLORS[type] || "bg-secondary"}`}>
                {TYPE_LABELS[type] || type}
              </Badge>
              <Badge className={`text-xs ${STATUS_COLORS[booking.status] || ""}`}>
                {booking.status}
              </Badge>
              {booking.isFree && (
                <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400">FREE</Badge>
              )}
            </div>
            <DialogTitle className="text-lg font-bold leading-tight">
              {booking.service?.name || "Session"}
            </DialogTitle>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3" style={{ WebkitOverflowScrolling: "touch" }}>
          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2 text-sm">
              <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="font-medium">{format(startDate, "EEE, MMM d")}</p>
                <p className="text-xs text-muted-foreground">{format(startDate, "yyyy")}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="font-medium">{format(startDate, "h:mm a")} – {format(endDate, "h:mm a")}</p>
              </div>
            </div>
          </div>

          {/* Location */}
          {booking.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <p className="break-words min-w-0">{booking.location}</p>
            </div>
          )}

          {/* Coach */}
          {booking.coach?.user && (
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src={booking.coach.photoUrl || booking.coach.user.profileImageUrl || undefined} />
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{coachInitials(booking)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{coachName(booking)}</p>
                <p className="text-xs text-muted-foreground">Lead Coach</p>
              </div>
            </div>
          )}

          {/* Sport / Skill / Age chips */}
          {(booking.sport || booking.skillLevel || booking.ageRange) && (
            <div className="flex flex-wrap gap-2">
              {booking.sport && (
                <Badge variant="outline" className="text-xs">
                  <Dumbbell className="h-3 w-3 mr-1" />{booking.sport}
                </Badge>
              )}
              {booking.skillLevel && <Badge variant="outline" className="text-xs">{booking.skillLevel}</Badge>}
              {booking.ageRange && <Badge variant="outline" className="text-xs">Ages {booking.ageRange}</Badge>}
            </div>
          )}

          {/* Capacity bar (group sessions) */}
          {max > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    {count} / {max} Athletes
                  </span>
                  {spotsLeft !== null && (
                    <span className={`text-xs font-semibold ${spotsLeft === 0 ? "text-orange-600 dark:text-orange-400" : spotsLeft <= 2 ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}>
                      {spotsLeft === 0 ? "FULL" : `${spotsLeft} Spot${spotsLeft !== 1 ? "s" : ""} Left`}
                    </span>
                  )}
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${fillPct >= 100 ? "bg-orange-500" : fillPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Price */}
          {booking.priceCents !== undefined && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Price</span>
                <span className="font-semibold text-primary">
                  {booking.priceCents === 0 ? "FREE" : `$${(booking.priceCents / 100).toFixed(2)} per session`}
                </span>
              </div>
            </>
          )}

          {/* Description — collapsed */}
          {(booking as any).groupDescription && (
            <>
              <Separator />
              <div>
                <button
                  onClick={() => setShowDescription(v => !v)}
                  className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                  data-testid="button-toggle-description"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDescription ? "rotate-90" : ""}`} />
                  {showDescription ? "Hide Description" : "Show Description"}
                </button>
                {showDescription && (
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {(booking as any).groupDescription}
                  </p>
                )}
              </div>
            </>
          )}
          <div className="h-2" />
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 px-5 py-4 border-t space-y-2 bg-background">
          {canCancel && onCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full border-destructive/30 text-destructive hover:bg-destructive/5"
                  disabled={cancelling}
                  data-testid="button-cancel-booking-drawer"
                >
                  <X className="h-4 w-4 mr-1.5" />
                  {cancelling ? "Cancelling…" : "Cancel Booking"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground"
                    onClick={() => { onCancel(); onClose(); }}
                  >
                    Yes, Cancel
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="ghost" className="w-full" onClick={onClose} data-testid="button-close-drawer">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Coach Group (group-by-coach view) ────────────────────────────────────────

function CoachGroup({
  coachLabel, coachPhoto, coachInitialsStr, bookings, onViewDetails, onCancel, cancellingId,
}: {
  coachLabel: string;
  coachPhoto?: string;
  coachInitialsStr: string;
  bookings: EnrichedBooking[];
  onViewDetails: (b: EnrichedBooking) => void;
  onCancel: (id: string) => void;
  cancellingId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const next = bookings[0];
  const nextStart = next ? parseISO(next.startAt as unknown as string) : null;

  return (
    <div className="rounded-lg border overflow-hidden" data-testid={`coach-group-${coachLabel.replace(/\s/g, "-").toLowerCase()}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setCollapsed(v => !v)}
      >
        <Avatar className="h-8 w-8 shrink-0">
          {coachPhoto && <AvatarImage src={coachPhoto} />}
          <AvatarFallback className="text-xs bg-primary/10 text-primary">{coachInitialsStr}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{coachLabel}</p>
          <p className="text-xs text-muted-foreground">
            {bookings.length} session{bookings.length !== 1 ? "s" : ""}
            {nextStart && ` · Next: ${format(nextStart, "EEE MMM d")}`}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/40">
          {bookings.map(b => {
            const startDate = parseISO(b.startAt as unknown as string);
            const canCancel = b.status === "CONFIRMED" || b.status === "PENDING";
            return (
              <div key={b.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/20">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{b.service?.name || "Session"}</span>
                    <Badge className={`text-xs shrink-0 ${STATUS_COLORS[b.status] || ""}`}>{b.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(startDate, "EEE, MMM d · h:mm a")}
                    {b.location && ` · ${b.location}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onViewDetails(b)} data-testid={`button-view-coach-booking-${b.id}`}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  {canCancel && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" disabled={cancellingId === b.id} data-testid={`button-cancel-coach-booking-${b.id}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => onCancel(b.id)}>
                            Yes, Cancel
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Available Session Card ───────────────────────────────────────────────────

function AvailableSessionCard({ session, onJoin, joining }: {
  session: OpenSession; onJoin: () => void; joining: boolean;
}) {
  const filled = session.participantCount ?? 0;
  const max    = session.maxParticipants ?? 0;
  const isFull = max > 0 && filled >= max;

  return (
    <Card className="p-3 sm:p-4 border-l-4" style={{ borderLeftColor: "rgb(168 85 247)" }} data-testid={`card-available-${session.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge className={`text-xs ${isFull ? "bg-orange-500/15 text-orange-700 dark:text-orange-400" : "bg-green-500/15 text-green-700 dark:text-green-400"}`}>
              {isFull ? "Full" : "Open"}
            </Badge>
            <Badge className="text-xs bg-purple-500/15 text-purple-700 dark:text-purple-400">Group</Badge>
          </div>
          <p className="font-semibold text-sm">{session.sport || session.service?.name || "Open Session"}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              {format(parseISO(session.startAt as unknown as string), "EEE, MMM d")}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {format(parseISO(session.startAt as unknown as string), "h:mm a")}
            </span>
          </div>
          {session.coach?.user && (
            <p className="text-sm text-muted-foreground">
              Coach {session.coach.user.firstName} {session.coach.user.lastName}
            </p>
          )}
          {session.location && (
            <p className="text-sm text-muted-foreground flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{session.location}</span>
            </p>
          )}
          {max > 0 && (
            <p className="text-xs text-muted-foreground">{filled}/{max} spots filled</p>
          )}
        </div>
        <Button size="sm" disabled={isFull || joining} onClick={onJoin} data-testid={`button-join-session-${session.id}`} className="shrink-0">
          <Zap className="h-3.5 w-3.5 mr-1" />
          {isFull ? "Full" : joining ? "Joining…" : "Join"}
        </Button>
      </div>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyBookingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [cancellingId, setCancellingId]       = useState<string | null>(null);
  const [joiningId, setJoiningId]             = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBooking | null>(null);
  const [typeFilter, setTypeFilter]           = useState("all");
  const [groupBy, setGroupBy]                 = useState<"date" | "coach">("date");

  const { data: bookings, isLoading } = useQuery<EnrichedBooking[]>({ queryKey: ["/api/bookings"] });
  const { data: openSessions, isLoading: loadingOpen } = useQuery<OpenSession[]>({ queryKey: ["/api/sessions/open"] });
  const { data: profile } = useQuery<UserProfile>({ queryKey: ["/api/profile"] });
  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";

  // ── Cancel mutation ──
  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status: "CANCELLED" });
      return res.json();
    },
    onSuccess: () => {
      setCancellingId(null);
      setSelectedBooking(null);
      toast({ title: "Booking Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
    },
    onError: (error: Error) => {
      setCancellingId(null);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
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
        toast({ title: "Unauthorized", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ── Derived lists ──
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const allUpcoming = useMemo(() =>
    (bookings || [])
      .filter(b => ["CONFIRMED", "PENDING"].includes(b.status) && !isPast(parseISO(b.startAt as unknown as string)))
      .sort((a, b) => parseISO(a.startAt as unknown as string).getTime() - parseISO(b.startAt as unknown as string).getTime()),
    [bookings]
  );

  const allPast = useMemo(() =>
    (bookings || [])
      .filter(b => !["CONFIRMED", "PENDING"].includes(b.status) || isPast(parseISO(b.startAt as unknown as string)))
      .sort((a, b) => parseISO(b.startAt as unknown as string).getTime() - parseISO(a.startAt as unknown as string).getTime()),
    [bookings]
  );

  const thisWeekCount = allUpcoming.filter(b =>
    parseISO(b.startAt as unknown as string) <= weekEnd
  ).length;

  // Apply type filter
  const applyTypeFilter = (list: EnrichedBooking[]) => {
    if (typeFilter === "all") return list;
    if (typeFilter === "CANCELLED") return list.filter(b => b.status === "CANCELLED");
    return list.filter(b => b.sessionType === typeFilter);
  };

  const upcoming  = applyTypeFilter(allUpcoming);
  const past      = applyTypeFilter(allPast);

  // Group by coach
  const groupedByCoach = useMemo(() => {
    const map = new Map<string, EnrichedBooking[]>();
    upcoming.forEach(b => {
      const key = b.coach?.user
        ? `${b.coach.user.firstName} ${b.coach.user.lastName}`
        : "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [upcoming]);

  // Available sessions (not already booked)
  const bookedIds = useMemo(() => new Set((bookings || []).map(b => b.id)), [bookings]);
  const availableSessions = useMemo(() =>
    (openSessions || []).filter(s => !bookedIds.has(s.id) && !isPast(parseISO(s.startAt as unknown as string))),
    [openSessions, bookedIds]
  );

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <PortalPageHero className="rounded-xl px-5 py-5 border border-border/40 bg-card/50">
        <PortalFadeUp>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-serif font-bold" data-testid="text-bookings-title">My Bookings</h1>
              {/* Phase 8 — Summary strip */}
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{allUpcoming.length}</span> Upcoming
                {thisWeekCount > 0 && <> · <span className="font-medium text-primary">{thisWeekCount}</span> This Week</>}
                {" · "}<span className="font-medium text-foreground">{allPast.length}</span> Past
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isCoach && <AddSessionDialog />}
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/open-sessions")}
                data-testid="button-browse-all-sessions"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Browse Sessions
              </Button>
            </div>
          </div>
        </PortalFadeUp>
      </PortalPageHero>

      <PortalSectionReveal delay={0.05}>
        {/* Phase 3 — Filter chips */}
        <div className="flex flex-wrap gap-2 px-0.5" data-testid="type-filter-chips">
          {FILTER_TYPES.map(ft => (
            <button
              key={ft.value}
              onClick={() => setTypeFilter(ft.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${typeFilter === ft.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
              data-testid={`chip-type-${ft.value}`}
            >
              {ft.label}
            </button>
          ))}
        </div>

        {/* Phase 2 — Group-by toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant={groupBy === "date" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setGroupBy("date")}
            data-testid="button-group-date"
          >
            <LayoutList className="h-3.5 w-3.5" />
            By Date
          </Button>
          <Button
            variant={groupBy === "coach" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setGroupBy("coach")}
            data-testid="button-group-coach"
          >
            <UsersRound className="h-3.5 w-3.5" />
            By Coach
          </Button>
        </div>

        <Tabs defaultValue="upcoming">
          <TabsList>
            <TabsTrigger value="upcoming" data-testid="tab-upcoming">
              <span className="flex items-center gap-2">
                {allUpcoming.length > 0 && <SessionPulseDot />}
                Upcoming ({upcoming.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="past" data-testid="tab-past">
              Past ({past.length})
            </TabsTrigger>
            <TabsTrigger value="available" data-testid="tab-available">
              <span className="flex items-center gap-2">
                {availableSessions.length > 0 && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                Available ({availableSessions.length})
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Upcoming ── */}
          <TabsContent value="upcoming" className="space-y-3 mt-4">
            {upcoming.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">
                  {typeFilter !== "all" ? `No ${FILTER_TYPES.find(f => f.value === typeFilter)?.label || typeFilter} sessions upcoming.` : "No upcoming sessions."}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/coaches")} data-testid="button-browse-coaches">
                  Browse Coaches
                </Button>
              </div>
            ) : groupBy === "coach" ? (
              <div className="space-y-3">
                {groupedByCoach.map(([label, bookingsForCoach]) => {
                  const first = bookingsForCoach[0];
                  const photo = first?.coach?.photoUrl || first?.coach?.user?.profileImageUrl || undefined;
                  const initials = first ? coachInitials(first) : "?";
                  return (
                    <CoachGroup
                      key={label}
                      coachLabel={`Coach ${label}`}
                      coachPhoto={photo}
                      coachInitialsStr={initials}
                      bookings={bookingsForCoach}
                      onViewDetails={setSelectedBooking}
                      onCancel={(id) => { setCancellingId(id); cancelMutation.mutate(id); }}
                      cancellingId={cancellingId}
                    />
                  );
                })}
              </div>
            ) : (
              upcoming.map(b => (
                <UpcomingSessionCard key={b.id}>
                  <CompactBookingCard
                    booking={b}
                    onViewDetails={() => setSelectedBooking(b)}
                    showCancel={b.status === "CONFIRMED"}
                    cancelling={cancelMutation.isPending && cancellingId === b.id}
                    onCancel={() => { setCancellingId(b.id); cancelMutation.mutate(b.id); }}
                  />
                </UpcomingSessionCard>
              ))
            )}
          </TabsContent>

          {/* ── Past ── */}
          <TabsContent value="past" className="space-y-3 mt-4">
            {past.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <p className="text-sm">
                  {typeFilter !== "all" ? `No ${FILTER_TYPES.find(f => f.value === typeFilter)?.label || typeFilter} past sessions.` : "No past sessions."}
                </p>
              </div>
            ) : (
              past.map(b => (
                <CompactBookingCard
                  key={b.id}
                  booking={b}
                  onViewDetails={() => setSelectedBooking(b)}
                />
              ))
            )}
          </TabsContent>

          {/* ── Available Sessions ── */}
          <TabsContent value="available" className="space-y-3 mt-4">
            {loadingOpen ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)
            ) : availableSessions.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No open sessions available right now.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/open-sessions")} data-testid="button-browse-sessions">
                  Browse All Sessions
                </Button>
              </div>
            ) : (
              availableSessions.map(s => (
                <AvailableSessionCard
                  key={s.id}
                  session={s}
                  joining={joinMutation.isPending && joiningId === s.id}
                  onJoin={() => { setJoiningId(s.id); joinMutation.mutate(s.id); }}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </PortalSectionReveal>

      {/* Booking Details Drawer */}
      <BookingDetailDrawer
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        cancelling={cancelMutation.isPending && cancellingId === selectedBooking?.id}
        onCancel={selectedBooking ? () => { setCancellingId(selectedBooking.id); cancelMutation.mutate(selectedBooking.id); } : undefined}
      />
    </div>
  );
}
