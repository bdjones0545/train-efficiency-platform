import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { DashPageHeader, DashSectionReveal } from "@/components/DashboardMotion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/query-error-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { getAuthHeaders } from "@/lib/authToken";
import {
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
  DollarSign,
  ArrowLeftRight,
  MapPin,
  RefreshCw,
  Sunrise,
  Sun,
  Sunset,
  Clock,
  Zap,
  TrendingUp,
  Activity,
  CheckCircle2,
  Timer,
  UserCheck,
  UserX,
  Info,
  ChevronDown,
} from "lucide-react";
import {
  format,
  parseISO,
  isSameDay,
  addDays,
  subDays,
  getDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  isToday,
  isSameMonth,
  differenceInMinutes,
  isAfter,
  isBefore,
  isPast,
} from "date-fns";

import { AddSessionDialog } from "@/components/add-session-dialog";
import { EditSessionDialog } from "@/components/edit-session-dialog";
import { SubscriptionScheduleDialog } from "@/components/subscription-schedule-dialog";
import type { BookingWithDetails, ParticipantWithUser, RedemptionWithDetails, CoachWithUser } from "@/lib/types";
import type { AvailabilityBlock, Organization } from "@shared/schema";

const START_HOUR = 5;
const END_HOUR = 22;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
const SLOT_HEIGHT_PX = 60;
const PIXELS_PER_MINUTE = SLOT_HEIGHT_PX / 60;
const HALF_SLOT_HEIGHT = SLOT_HEIGHT_PX / 2;

function minutesSinceStart(hours: number, minutes: number) {
  return (hours - START_HOUR) * 60 + minutes;
}
function formatHour(hour: number) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12} ${ampm}`;
}
function formatSlotLabel(hour: number, minute: number) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}
function timeStr(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  CONFIRMED: "bg-primary/10 text-primary border-primary/30",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  NO_SHOW: "bg-muted text-muted-foreground border-muted-foreground/20",
};

function detectConflicts(bookings: BookingWithDetails[]): Set<string> {
  const conflictIds = new Set<string>();
  const active = bookings.filter((b) => ["CONFIRMED", "PENDING"].includes(b.status));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const aStart = new Date(a.startAt as unknown as string).getTime();
      const aEnd = new Date(a.endAt as unknown as string).getTime();
      const bStart = new Date(b.startAt as unknown as string).getTime();
      const bEnd = new Date(b.endAt as unknown as string).getTime();
      if (aStart < bEnd && aEnd > bStart) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return conflictIds;
}

function getNextSession(bookings: BookingWithDetails[]): BookingWithDetails | null {
  const now = new Date();
  return (
    bookings
      .filter(
        (b) =>
          ["CONFIRMED", "PENDING"].includes(b.status) &&
          isAfter(parseISO(b.startAt as unknown as string), now)
      )
      .sort(
        (a, b) =>
          new Date(a.startAt as unknown as string).getTime() -
          new Date(b.startAt as unknown as string).getTime()
      )[0] || null
  );
}

function getTimeOfDayLabel(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatCountdown(target: Date): string {
  const mins = differenceInMinutes(target, new Date());
  if (mins <= 0) return "Starting now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

// ─── Group Participants ──────────────────────────────────────────────────────
function GroupParticipants({ bookingId, max }: { bookingId: string; max: number }) {
  const { data: participants } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", bookingId, "participants"],
  });
  const count = participants?.length || 0;
  const pct = max > 0 ? count / max : 0;
  const fillColor =
    pct >= 1 ? "bg-red-500" : pct >= 0.8 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="flex items-center gap-1.5" data-testid={`group-participants-${bookingId}`}>
      <Users className="h-3 w-3 shrink-0" />
      <span className="text-xs">
        {count}/{max}
      </span>
      <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${fillColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
      </div>
      {pct < 0.5 && max > 1 && (
        <span className="text-[10px] text-yellow-600 dark:text-yellow-400">underfilled</span>
      )}
      {pct >= 1 && (
        <span className="text-[10px] text-red-600 dark:text-red-400">full</span>
      )}
    </div>
  );
}

// ─── Today's Cockpit ────────────────────────────────────────────────────────
function TodayCockpit({
  dayBookings,
  conflictIds,
  coachName,
}: {
  dayBookings: BookingWithDetails[];
  conflictIds: Set<string>;
  coachName: string;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const nextSession = getNextSession(dayBookings);
  const inProgressSession = dayBookings.find((b) => {
    const s = parseISO(b.startAt as unknown as string);
    const e = parseISO(b.endAt as unknown as string);
    return ["CONFIRMED", "PENDING"].includes(b.status) && !isAfter(s, now) && isAfter(e, now);
  });

  const pendingCount = dayBookings.filter((b) => b.status === "PENDING").length;
  const conflictCount = conflictIds.size > 0 ? Math.ceil(conflictIds.size / 2) : 0;
  const completedCount = dayBookings.filter((b) => b.status === "COMPLETED").length;
  const totalActive = dayBookings.filter((b) => ["CONFIRMED", "PENDING"].includes(b.status)).length;
  const attentionCount = pendingCount + conflictCount;

  return (
    <Card className="border border-border/60 bg-gradient-to-br from-background to-muted/20 overflow-hidden" data-testid="today-cockpit">
      <div className="p-4 space-y-4">
        {/* Greeting row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{getTimeOfDayLabel()}</p>
            <h2 className="text-lg font-semibold mt-0.5 leading-tight">{coachName}</h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1.5">
            <Clock className="h-3.5 w-3.5" />
            {format(now, "h:mm a")}
          </div>
        </div>

        {/* Active / next session highlight */}
        {inProgressSession ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2.5" data-testid="in-progress-session">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-primary">Session in progress</p>
              <p className="text-sm font-medium truncate">
                {inProgressSession.service?.name || "Session"}
                {inProgressSession.client
                  ? ` · ${inProgressSession.client.firstName} ${inProgressSession.client.lastName}`
                  : ""}
              </p>
            </div>
            <p className="text-xs text-muted-foreground shrink-0">
              ends {format(parseISO(inProgressSession.endAt as unknown as string), "h:mm a")}
            </p>
          </div>
        ) : nextSession ? (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5" data-testid="next-session">
            <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Next session</p>
              <p className="text-sm font-medium truncate">
                {nextSession.service?.name || "Session"}
                {nextSession.client
                  ? ` · ${nextSession.client.firstName} ${nextSession.client.lastName}`
                  : ""}
              </p>
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs shrink-0">
              {formatCountdown(parseISO(nextSession.startAt as unknown as string))}
            </Badge>
          </div>
        ) : dayBookings.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/50 px-3.5 py-2.5 text-muted-foreground" data-testid="no-sessions-today">
            <Calendar className="h-4 w-4 shrink-0" />
            <p className="text-sm">No sessions scheduled today</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5" data-testid="sessions-done-today">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">All sessions complete for today</p>
          </div>
        )}

        {/* Quick metrics row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center rounded-md bg-muted/40 px-2 py-2">
            <p className="text-lg font-bold">{dayBookings.length}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Total</p>
          </div>
          <div className="text-center rounded-md bg-muted/40 px-2 py-2">
            <p className={`text-lg font-bold ${totalActive > 0 ? "text-primary" : ""}`}>{totalActive}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Active</p>
          </div>
          <div className="text-center rounded-md bg-muted/40 px-2 py-2">
            <p className={`text-lg font-bold ${completedCount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{completedCount}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Done</p>
          </div>
          <div className={`text-center rounded-md px-2 py-2 ${attentionCount > 0 ? "bg-yellow-500/10" : "bg-muted/40"}`}>
            <p className={`text-lg font-bold ${attentionCount > 0 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>{attentionCount}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Needs Attn</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Attention Strip ─────────────────────────────────────────────────────────
function AttentionStrip({
  dayBookings,
  conflictIds,
  onEdit,
}: {
  dayBookings: BookingWithDetails[];
  conflictIds: Set<string>;
  onEdit: (b: BookingWithDetails) => void;
}) {
  const pendingBookings = dayBookings.filter((b) => b.status === "PENDING");
  const conflictBookings = dayBookings.filter((b) => conflictIds.has(b.id) && ["CONFIRMED", "PENDING"].includes(b.status));

  const items: { type: "conflict" | "pending"; label: string; sub: string; booking?: BookingWithDetails }[] = [];

  if (conflictIds.size > 0) {
    const pairs = Math.ceil(conflictIds.size / 2);
    items.push({
      type: "conflict",
      label: `${pairs} schedule conflict${pairs !== 1 ? "s" : ""} detected`,
      sub: conflictBookings
        .slice(0, 2)
        .map((b) => b.service?.name || "Session")
        .join(" & "),
    });
  }

  pendingBookings.forEach((b) => {
    items.push({
      type: "pending",
      label: `Pending confirmation`,
      sub: `${b.service?.name || "Session"}${b.client ? ` · ${b.client.firstName} ${b.client.lastName}` : ""} at ${format(parseISO(b.startAt as unknown as string), "h:mm a")}`,
      booking: b,
    });
  });

  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="attention-strip">
      {items.map((item, idx) => (
        <button
          key={idx}
          className={`w-full flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors hover:opacity-90 ${
            item.type === "conflict"
              ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
              : "border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10"
          }`}
          onClick={() => item.booking && onEdit(item.booking)}
          data-testid={`attention-item-${item.type}-${idx}`}
        >
          {item.type === "conflict" ? (
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold ${item.type === "conflict" ? "text-red-700 dark:text-red-400" : "text-yellow-700 dark:text-yellow-400"}`}>
              {item.label}
            </p>
            <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
          </div>
          {item.booking && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        </button>
      ))}
    </div>
  );
}

// ─── Now Indicator ───────────────────────────────────────────────────────────
function NowIndicator() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const topMin = minutesSinceStart(now.getHours(), now.getMinutes());
  if (topMin < 0 || topMin > TOTAL_MINUTES) return null;
  return (
    <div
      className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
      style={{ top: `${topMin * PIXELS_PER_MINUTE}px` }}
      data-testid="now-indicator"
    >
      <div className="w-14 flex justify-end pr-1.5">
        <div className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-background" />
      </div>
      <div className="flex-1 border-t-2 border-red-500/80" />
    </div>
  );
}

// ─── Booking Block ───────────────────────────────────────────────────────────
function BookingBlock({
  booking,
  redeemedIds,
  onStatusChange,
  onRedeem,
  onEdit,
  statusPending,
  redeemPending,
  isConflict,
}: {
  booking: BookingWithDetails;
  redeemedIds: Set<string>;
  onStatusChange: (id: string, status: string) => void;
  onRedeem: (id: string) => void;
  onEdit: (booking: BookingWithDetails) => void;
  statusPending: boolean;
  redeemPending: boolean;
  isConflict: boolean;
}) {
  const startDt = parseISO(booking.startAt as unknown as string);
  const endDt = parseISO(booking.endAt as unknown as string);
  const topMin = minutesSinceStart(startDt.getHours(), startDt.getMinutes());
  const endMin = minutesSinceStart(endDt.getHours(), endDt.getMinutes());
  const durationMin = Math.max(endMin - topMin, 15);

  const top = topMin * PIXELS_PER_MINUTE;
  const height = durationMin * PIXELS_PER_MINUTE;

  const colorClass = isConflict
    ? "bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/40"
    : statusColors[booking.status] || statusColors.PENDING;
  const isActive = ["CONFIRMED", "PENDING"].includes(booking.status);
  const isCompleted = booking.status === "COMPLETED";
  const isRedeemed = redeemedIds.has(booking.id);

  return (
    <TooltipProvider>
      <div
        className={`absolute left-16 right-2 rounded-md border px-2.5 py-1.5 overflow-hidden cursor-pointer transition-all hover:shadow-md hover:brightness-95 dark:hover:brightness-110 ${colorClass} ${isConflict ? "ring-1 ring-red-400/50" : ""}`}
        style={{ top: `${top}px`, height: `${height}px`, minHeight: "36px", zIndex: 10 }}
        onClick={() => onEdit(booking)}
        data-testid={`calendar-booking-${booking.id}`}
      >
        <div className="flex items-start justify-between gap-1 h-full">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isConflict && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>Schedule conflict detected</TooltipContent>
                </Tooltip>
              )}
              <span className="text-xs font-semibold truncate">
                {booking.service?.name || "Session"}
              </span>
              <Badge className={`text-[10px] px-1 py-0 border ${statusColors[booking.status]}`}>
                {booking.status}
              </Badge>
            </div>
            <div className="text-[11px] opacity-80">
              {format(startDt, "h:mm")}–{format(endDt, "h:mm a")}
            </div>
            {booking.client && !booking.maxParticipants && (
              <div className="text-[11px] opacity-80 truncate flex items-center gap-1">
                <UserCheck className="h-2.5 w-2.5 shrink-0" />
                {booking.client.firstName} {booking.client.lastName}
              </div>
            )}
            {booking.location && (
              <div className="text-[10px] opacity-70 truncate flex items-center gap-0.5" data-testid={`text-location-${booking.id}`}>
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                {booking.location}
              </div>
            )}
            {booking.maxParticipants && (
              <GroupParticipants bookingId={booking.id} max={booking.maxParticipants} />
            )}
          </div>

          {height >= 36 && (
            <div className="flex flex-col gap-0.5 shrink-0 items-end">
              {isActive && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "COMPLETED"); }}
                        disabled={statusPending}
                        data-testid={`button-complete-${booking.id}`}
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Mark Completed</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "NO_SHOW"); }}
                        disabled={statusPending}
                        data-testid={`button-noshow-${booking.id}`}
                      >
                        <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>No-Show</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "CANCELLED"); }}
                        disabled={statusPending}
                        data-testid={`button-cancel-${booking.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel</TooltipContent>
                  </Tooltip>
                </>
              )}
              {isCompleted && !isRedeemed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => { e.stopPropagation(); onRedeem(booking.id); }}
                      disabled={redeemPending}
                      data-testid={`button-redeem-${booking.id}`}
                    >
                      <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Redeem Session</TooltipContent>
                </Tooltip>
              )}
              {isCompleted && isRedeemed && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0">
                  Redeemed
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function fetchWithAuth(url: string) {
  return fetch(url, {
    credentials: "include",
    headers: { ...getAuthHeaders(), "Cache-Control": "no-cache" },
  }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    return res.json();
  });
}

type CalendarView = "day" | "week" | "month";

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({
  value,
  label,
  accent,
  icon: Icon,
  testId,
}: {
  value: number;
  label: string;
  accent?: string;
  icon: React.ElementType;
  testId: string;
}) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${accent || "bg-muted"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-bold leading-tight" data-testid={testId}>{value}</p>
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
      </div>
    </Card>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({
  weekDays,
  bookings,
  onDaySelect,
  onBookingEdit,
}: {
  weekDays: Date[];
  bookings: BookingWithDetails[];
  onDaySelect: (d: Date) => void;
  onBookingEdit: (b: BookingWithDetails) => void;
}) {
  return (
    <div className="space-y-2" data-testid="week-view">
      {weekDays.map((day) => {
        const dayBkgs = bookings.filter((b) =>
          isSameDay(parseISO(b.startAt as unknown as string), day)
        );
        const confirmed = dayBkgs.filter((b) => b.status === "CONFIRMED").length;
        const pending = dayBkgs.filter((b) => b.status === "PENDING").length;
        const isToday_ = isToday(day);
        const conflicts = detectConflicts(dayBkgs);

        return (
          <Card
            key={day.toISOString()}
            className={`p-3 transition-colors ${isToday_ ? "border-primary/40 bg-primary/5" : ""}`}
            data-testid={`week-day-card-${format(day, "yyyy-MM-dd")}`}
          >
            <button
              className="w-full flex items-center justify-between mb-1.5"
              onClick={() => onDaySelect(day)}
              data-testid={`button-week-day-${format(day, "yyyy-MM-dd")}`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                    isToday_ ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {format(day, "d")}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold leading-tight">{format(day, "EEEE")}</p>
                  <p className="text-xs text-muted-foreground">{format(day, "MMM d")}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {conflicts.size > 0 && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-red-500/15 text-red-600 border-red-500/30">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                    conflict
                  </Badge>
                )}
                {dayBkgs.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {dayBkgs.length} session{dayBkgs.length !== 1 ? "s" : ""}
                  </Badge>
                )}
                {confirmed > 0 && <span className="w-2 h-2 rounded-full bg-primary" />}
                {pending > 0 && <span className="w-2 h-2 rounded-full bg-yellow-500" />}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </button>

            {dayBkgs.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-10">No sessions</p>
            ) : (
              <div className="pl-10 space-y-1">
                {dayBkgs
                  .sort(
                    (a, b) =>
                      new Date(a.startAt as unknown as string).getTime() -
                      new Date(b.startAt as unknown as string).getTime()
                  )
                  .map((b) => (
                    <button
                      key={b.id}
                      className={`w-full flex items-center gap-2 text-left px-2 py-1 rounded-md hover:bg-muted transition-colors ${
                        conflicts.has(b.id) ? "bg-red-500/5 border border-red-500/20" : ""
                      }`}
                      onClick={() => onBookingEdit(b)}
                      data-testid={`week-session-${b.id}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          b.status === "CONFIRMED"
                            ? "bg-primary"
                            : b.status === "PENDING"
                            ? "bg-yellow-500"
                            : b.status === "COMPLETED"
                            ? "bg-emerald-500"
                            : "bg-red-400"
                        }`}
                      />
                      <span className="text-xs font-medium shrink-0">
                        {format(parseISO(b.startAt as unknown as string), "h:mm a")}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {b.service?.name || "Session"}
                        {b.client ? ` · ${b.client.firstName} ${b.client.lastName}` : ""}
                      </span>
                      {conflicts.has(b.id) && (
                        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 ml-auto" />
                      )}
                      <Badge
                        className={`text-[9px] px-1 py-0 ml-auto border ${statusColors[b.status] || statusColors.PENDING} ${conflicts.has(b.id) ? "ml-0" : ""}`}
                      >
                        {b.status}
                      </Badge>
                    </button>
                  ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────
function MonthView({
  selectedDate,
  bookings,
  onDaySelect,
}: {
  selectedDate: Date;
  bookings: BookingWithDetails[];
  onDaySelect: (d: Date) => void;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const dayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <Card className="p-3" data-testid="month-view">
      <div className="grid grid-cols-7 mb-1">
        {dayHeaders.map((h) => (
          <div key={h} className="text-[10px] font-semibold text-muted-foreground text-center py-1">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {calDays.map((day) => {
          const inMonth = isSameMonth(day, selectedDate);
          const isToday_ = isToday(day);
          const isSelected = isSameDay(day, selectedDate);
          const dayBkgs = bookings.filter((b) =>
            isSameDay(parseISO(b.startAt as unknown as string), day)
          );
          const count = dayBkgs.length;
          const hasConflict = detectConflicts(dayBkgs).size > 0;
          const hasConfirmed = dayBkgs.some((b) => b.status === "CONFIRMED");
          const hasPending = dayBkgs.some((b) => b.status === "PENDING");
          const hasCompleted = dayBkgs.some((b) => b.status === "COMPLETED");

          return (
            <button
              key={day.toISOString()}
              onClick={() => { if (inMonth) onDaySelect(day); }}
              disabled={!inMonth}
              className={`flex flex-col items-center justify-start py-1.5 px-0.5 rounded-md transition-colors min-h-[44px] ${
                !inMonth ? "opacity-25 cursor-default" : "hover:bg-muted cursor-pointer"
              } ${isSelected && inMonth ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
              data-testid={`month-cell-${format(day, "yyyy-MM-dd")}`}
            >
              <span
                className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday_ ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {format(day, "d")}
              </span>
              {count > 0 && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  <span className="text-[9px] text-muted-foreground font-medium">{count}</span>
                  {hasConflict && <span className="w-1 h-1 rounded-full bg-red-500" />}
                  {hasConfirmed && !hasConflict && <span className="w-1 h-1 rounded-full bg-primary" />}
                  {hasPending && <span className="w-1 h-1 rounded-full bg-yellow-500" />}
                  {hasCompleted && !hasConfirmed && !hasPending && (
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground border-t border-border/40 pt-2 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" /> Confirmed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" /> Pending
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Completed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> Conflict
        </span>
      </div>
    </Card>
  );
}

// ─── Day Session List (compact, below timeline) ──────────────────────────────
function DaySessionList({
  bookings,
  conflictIds,
  onEdit,
  onStatusChange,
  onRedeem,
  redeemedIds,
  statusPending,
  redeemPending,
}: {
  bookings: BookingWithDetails[];
  conflictIds: Set<string>;
  onEdit: (b: BookingWithDetails) => void;
  onStatusChange: (id: string, status: string) => void;
  onRedeem: (id: string) => void;
  redeemedIds: Set<string>;
  statusPending: boolean;
  redeemPending: boolean;
}) {
  const sorted = [...bookings].sort(
    (a, b) =>
      new Date(a.startAt as unknown as string).getTime() -
      new Date(b.startAt as unknown as string).getTime()
  );

  if (sorted.length === 0) return null;

  return (
    <div data-testid="day-session-list">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Today's Sessions
      </p>
      <div className="space-y-1.5">
        {sorted.map((b) => {
          const start = parseISO(b.startAt as unknown as string);
          const end = parseISO(b.endAt as unknown as string);
          const isActive = ["CONFIRMED", "PENDING"].includes(b.status);
          const isCompleted = b.status === "COMPLETED";
          const isRedeemed = redeemedIds.has(b.id);
          const isConflict = conflictIds.has(b.id);

          return (
            <div
              key={b.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                isConflict
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-border/60 hover:bg-muted/30"
              }`}
              data-testid={`day-list-session-${b.id}`}
            >
              <div
                className={`w-1.5 self-stretch rounded-full shrink-0 ${
                  b.status === "CONFIRMED"
                    ? "bg-primary"
                    : b.status === "PENDING"
                    ? "bg-yellow-500"
                    : b.status === "COMPLETED"
                    ? "bg-emerald-500"
                    : b.status === "CANCELLED"
                    ? "bg-red-400"
                    : "bg-muted-foreground/30"
                }`}
              />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => onEdit(b)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {isConflict && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                  <span className="text-sm font-medium truncate">
                    {b.service?.name || "Session"}
                  </span>
                  <Badge className={`text-[9px] px-1.5 py-0 border ${statusColors[b.status] || statusColors.PENDING}`}>
                    {b.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {format(start, "h:mm")}–{format(end, "h:mm a")}
                  </span>
                  {b.client && (
                    <span className="text-xs text-muted-foreground truncate">
                      · {b.client.firstName} {b.client.lastName}
                    </span>
                  )}
                  {b.location && (
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />{b.location}
                    </span>
                  )}
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {isActive && (
                  <>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => onStatusChange(b.id, "COMPLETED")}
                            disabled={statusPending}
                            data-testid={`list-complete-${b.id}`}
                          >
                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Mark Completed</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => onStatusChange(b.id, "NO_SHOW")}
                            disabled={statusPending}
                            data-testid={`list-noshow-${b.id}`}
                          >
                            <UserX className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No-Show</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                )}
                {isCompleted && !isRedeemed && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => onRedeem(b.id)}
                          disabled={redeemPending}
                          data-testid={`list-redeem-${b.id}`}
                        >
                          <DollarSign className="h-4 w-4 text-emerald-600" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Redeem</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {isCompleted && isRedeemed && (
                  <Badge variant="secondary" className="text-[10px]">Redeemed</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CoachDashboardPage() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [slotTime, setSlotTime] = useState("09:00");
  const addSessionRef = useRef<HTMLButtonElement>(null);
  const [editBooking, setEditBooking] = useState<BookingWithDetails | null>(null);
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");
  const calendarRef = useRef<HTMLDivElement>(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [quickPickerSlot, setQuickPickerSlot] = useState<{ hour: number; minute: number } | null>(null);
  const [viewMode, setViewMode] = useState<CalendarView>("day");

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: orgData } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
  });

  const { data: myCoachProfile } = useQuery<{ id: string }>({
    queryKey: ["/api/coach/profile"],
    queryFn: () => fetchWithAuth("/api/coach/profile"),
  });

  const activeCoachId = selectedCoachId || myCoachProfile?.id || "";

  const selectedCoach = coaches?.find((c) => c.id === activeCoachId);
  const selectedCoachName = selectedCoach
    ? `${selectedCoach.user?.firstName || ""} ${selectedCoach.user?.lastName || ""}`.trim()
    : myCoachProfile
    ? "My Schedule"
    : "Coach";

  const {
    data: bookings,
    isLoading: bookingsLoading,
    isError: bookingsError,
    refetch: refetchBookings,
  } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/coach/bookings", activeCoachId],
    queryFn: () =>
      fetchWithAuth(
        activeCoachId ? `/api/coach/bookings?coachId=${activeCoachId}` : "/api/coach/bookings"
      ),
    enabled: !!activeCoachId,
  });

  const { data: availability } = useQuery<AvailabilityBlock[]>({
    queryKey: ["/api/coach/availability", activeCoachId],
    queryFn: () =>
      fetchWithAuth(
        activeCoachId
          ? `/api/coach/availability?coachId=${activeCoachId}`
          : "/api/coach/availability"
      ),
    enabled: !!activeCoachId,
  });

  const { data: redemptions } = useQuery<RedemptionWithDetails[]>({
    queryKey: ["/api/coach/redemptions", activeCoachId],
    queryFn: () =>
      fetchWithAuth(
        activeCoachId
          ? `/api/coach/redemptions?coachId=${activeCoachId}`
          : "/api/coach/redemptions"
      ),
    enabled: !!activeCoachId,
  });

  const redeemedIds = useMemo(
    () => new Set(redemptions?.map((r) => r.bookingId) || []),
    [redemptions]
  );

  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings/completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("POST", "/api/redemptions", { bookingId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session redeemed", description: "Payout is pending." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings/completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/redemptions"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ─── Derived data ─────────────────────────────────────────────────────────
  const dayBookings = useMemo(
    () =>
      (bookings || []).filter((b) =>
        isSameDay(parseISO(b.startAt as unknown as string), selectedDate)
      ),
    [bookings, selectedDate]
  );

  const dayConflictIds = useMemo(() => detectConflicts(dayBookings), [dayBookings]);

  const jsDow = getDay(selectedDate);
  const drizzleDow = jsDow === 0 ? 6 : jsDow - 1;
  const dayAvailability = useMemo(
    () => (availability || []).filter((a) => a.dayOfWeek === drizzleDow),
    [availability, drizzleDow]
  );

  const dayStats = useMemo(() => ({
    total: dayBookings.length,
    confirmed: dayBookings.filter((b) => b.status === "CONFIRMED").length,
    completed: dayBookings.filter((b) => b.status === "COMPLETED").length,
    pending: dayBookings.filter((b) => b.status === "PENDING").length,
  }), [dayBookings]);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const weekBookings = useMemo(
    () =>
      (bookings || []).filter((b) => {
        const d = parseISO(b.startAt as unknown as string);
        return d >= weekStart && d <= weekEnd;
      }),
    [bookings, weekStart, weekEnd]
  );

  const monthBookings = useMemo(
    () =>
      (bookings || []).filter((b) =>
        isSameMonth(parseISO(b.startAt as unknown as string), selectedDate)
      ),
    [bookings, selectedDate]
  );

  const weekStats = useMemo(() => ({
    total: weekBookings.length,
    confirmed: weekBookings.filter((b) => b.status === "CONFIRMED").length,
    completed: weekBookings.filter((b) => b.status === "COMPLETED").length,
    pending: weekBookings.filter((b) => b.status === "PENDING").length,
  }), [weekBookings]);

  const monthStats = useMemo(() => ({
    total: monthBookings.length,
    confirmed: monthBookings.filter((b) => b.status === "CONFIRMED").length,
    completed: monthBookings.filter((b) => b.status === "COMPLETED").length,
    pending: monthBookings.filter((b) => b.status === "PENDING").length,
  }), [monthBookings]);

  const activeStats =
    viewMode === "day" ? dayStats : viewMode === "week" ? weekStats : monthStats;

  const viewingToday = isToday(selectedDate);

  // ─── Scroll to current hour on load ──────────────────────────────────────
  const scrollToHour = useCallback((hour: number) => {
    if (!calendarRef.current) return;
    const offset = minutesSinceStart(hour, 0) * PIXELS_PER_MINUTE;
    calendarRef.current.scrollTop = Math.max(0, offset - 20);
  }, []);

  useEffect(() => {
    if (viewMode === "day" && viewingToday && calendarRef.current) {
      const now = new Date();
      scrollToHour(Math.max(now.getHours() - 1, START_HOUR));
    }
  }, [viewMode, viewingToday, scrollToHour]);

  const handleCalendarScroll = useCallback(() => {
    if (!calendarRef.current) return;
    setShowStickyHeader(calendarRef.current.scrollTop > 40);
  }, []);

  useEffect(() => {
    const el = calendarRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleCalendarScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleCalendarScroll);
  }, [handleCalendarScroll]);

  const handleSlotClick = useCallback((hour: number, minute: number) => {
    setQuickPickerSlot({ hour, minute });
  }, []);

  const handlePickerSelect = useCallback((time: string) => {
    setSlotTime(time);
    setQuickPickerSlot(null);
    setTimeout(() => addSessionRef.current?.click(), 0);
  }, []);

  const isInitialLoading = (!myCoachProfile && !coaches) || (bookingsLoading && !bookings);
  const showBookingsError = bookingsError && !bookingsLoading;

  // ─── Loading skeleton ─────────────────────────────────────────────────────
  if (isInitialLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[120px] w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[500px] w-full rounded-xl" />
      </div>
    );
  }

  const slots: { hour: number; minute: number }[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push({ hour: h, minute: 0 });
    slots.push({ hour: h, minute: 30 });
  }

  const quickPickerOptions: { label: string; value: string }[] = quickPickerSlot
    ? (() => {
        const opts: { label: string; value: string }[] = [];
        for (let i = 0; i < 4; i++) {
          const totalMin = quickPickerSlot.hour * 60 + quickPickerSlot.minute + i * 15;
          const h = Math.floor(totalMin / 60);
          const m = totalMin % 60;
          if (h >= END_HOUR) break;
          opts.push({ label: formatSlotLabel(h, m), value: timeStr(h, m) });
        }
        return opts;
      })()
    : [];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {showBookingsError && (
        <QueryErrorState
          title="Unable to load schedule"
          message="There was a problem fetching your bookings. Please try again."
          onRetry={() => refetchBookings()}
        />
      )}

      {/* ── Header ── */}
      <DashPageHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-serif font-bold" data-testid="text-coach-dashboard-title">
              Coach Dashboard
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {viewingToday
                ? `Today · ${format(selectedDate, "MMMM d, yyyy")}`
                : format(selectedDate, "EEEE, MMMM d, yyyy")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            {orgData?.subscriptionsEnabled && (
              <SubscriptionScheduleDialog
                coachId={activeCoachId}
                triggerButton={
                  <Button variant="outline" className="w-full sm:w-auto" data-testid="button-schedule-subscription">
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    Subscription
                  </Button>
                }
              />
            )}
            <AddSessionDialog
              initialDate={selectedDate}
              initialTime={slotTime}
              coachId={activeCoachId}
              triggerButton={
                <Button ref={addSessionRef} className="w-full sm:w-auto" data-testid="button-add-session">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Session
                </Button>
              }
            />
          </div>
        </div>
      </DashPageHeader>

      {/* ── Today's Cockpit (only when viewing today) ── */}
      {viewingToday && viewMode === "day" && (
        <TodayCockpit
          dayBookings={dayBookings}
          conflictIds={dayConflictIds}
          coachName={selectedCoachName}
        />
      )}

      {/* ── Attention Strip (today conflicts & pending) ── */}
      {viewingToday && viewMode === "day" && (dayConflictIds.size > 0 || dayBookings.some(b => b.status === "PENDING")) && (
        <AttentionStrip
          dayBookings={dayBookings}
          conflictIds={dayConflictIds}
          onEdit={(b) => setEditBooking(b)}
        />
      )}

      {/* ── Coach Selector ── */}
      {coaches && coaches.length > 1 && (
        <Card className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground shrink-0">Viewing:</span>
            <Select value={activeCoachId} onValueChange={(val) => setSelectedCoachId(val)}>
              <SelectTrigger className="w-full sm:w-64" data-testid="select-coach-toggle">
                <SelectValue placeholder="Select a coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.filter((c) => c.isActive).map((coach) => (
                  <SelectItem key={coach.id} value={coach.id} data-testid={`option-coach-${coach.id}`}>
                    {coach.user?.firstName} {coach.user?.lastName}
                    {coach.id === myCoachProfile?.id ? " (You)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
              <Badge variant="secondary" className="text-xs">
                Viewing {selectedCoachName}
              </Badge>
            )}
          </div>
        </Card>
      )}

      {/* ── View switcher + Date navigation ── */}
      <DashSectionReveal>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {/* View tabs */}
          <div
            className="flex rounded-lg border border-border overflow-hidden shrink-0"
            data-testid="view-switcher"
          >
            {(["day", "week", "month"] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`flex-1 px-4 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  viewMode === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
                data-testid={`button-view-${v}`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {/* Day nav */}
          {viewMode === "day" && (
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(subDays(selectedDate, 1))} data-testid="button-prev-day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 sm:flex-none min-w-0 truncate" data-testid="button-date-picker">
                    <Calendar className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate hidden sm:inline">{format(selectedDate, "EEEE, MMMM d, yyyy")}</span>
                    <span className="truncate sm:hidden">{format(selectedDate, "EEE, MMM d")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarWidget
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => { if (date) setSelectedDate(date); setCalendarOpen(false); }}
                    data-testid="calendar-day-picker"
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, 1))} data-testid="button-next-day">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!viewingToday && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())} data-testid="button-today">
                  Today
                </Button>
              )}
            </div>
          )}

          {/* Week nav */}
          {viewMode === "week" && (
            <div className="flex items-center gap-2 flex-1">
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(subWeeks(selectedDate, 1))} data-testid="button-prev-week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="flex-1 sm:flex-none text-sm font-medium pointer-events-none" data-testid="button-week-range">
                <Calendar className="h-4 w-4 mr-2 shrink-0" />
                {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
              </Button>
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(addWeeks(selectedDate, 1))} data-testid="button-next-week">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())} data-testid="button-today-week">Today</Button>
            </div>
          )}

          {/* Month nav */}
          {viewMode === "month" && (
            <div className="flex items-center gap-2 flex-1">
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(subMonths(selectedDate, 1))} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="flex-1 sm:flex-none text-sm font-medium pointer-events-none" data-testid="button-month-label">
                <Calendar className="h-4 w-4 mr-2 shrink-0" />
                {format(selectedDate, "MMMM yyyy")}
              </Button>
              <Button variant="outline" size="icon" onClick={() => setSelectedDate(addMonths(selectedDate, 1))} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())} data-testid="button-today-month">Today</Button>
            </div>
          )}
        </div>
      </DashSectionReveal>

      {/* ── Quick scroll (day view only) ── */}
      {viewMode === "day" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">Jump to:</span>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={() => scrollToHour(6)} data-testid="button-scroll-morning">
            <Sunrise className="h-3 w-3" /> Morning
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={() => scrollToHour(12)} data-testid="button-scroll-afternoon">
            <Sun className="h-3 w-3" /> Noon
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={() => scrollToHour(16)} data-testid="button-scroll-evening">
            <Sunset className="h-3 w-3" /> Evening
          </Button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          value={activeStats.total}
          label={`Total · ${viewMode}`}
          icon={Activity}
          accent="bg-muted"
          testId="text-stat-total"
        />
        <StatCard
          value={activeStats.confirmed}
          label="Confirmed"
          icon={CheckCircle2}
          accent="bg-primary/10 text-primary"
          testId="text-stat-confirmed"
        />
        <StatCard
          value={activeStats.pending}
          label="Pending"
          icon={AlertCircle}
          accent={activeStats.pending > 0 ? "bg-yellow-500/10 text-yellow-600" : "bg-muted"}
          testId="text-stat-pending"
        />
        <StatCard
          value={activeStats.completed}
          label="Completed"
          icon={CheckCircle}
          accent={activeStats.completed > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-muted"}
          testId="text-stat-completed"
        />
      </div>

      {/* ── Calendar / Schedule area ── */}
      {viewMode === "day" && (
        <>
          <div className="relative">
            {/* Sticky mini-header */}
            {showStickyHeader && (
              <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 py-2 bg-background/95 backdrop-blur-sm border-b rounded-t-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{format(selectedDate, "EEEE, MMM d")}</span>
                  {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
                    <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                      · {selectedCoachName}
                    </span>
                  )}
                </div>
                <AddSessionDialog
                  initialDate={selectedDate}
                  initialTime={slotTime}
                  coachId={activeCoachId}
                  triggerButton={
                    <Button size="sm" className="h-7 text-xs shrink-0" data-testid="button-add-session-sticky">
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  }
                />
              </div>
            )}

            {/* Timeline */}
            <Card className="p-0 overflow-x-hidden overflow-y-auto" style={{ maxHeight: "70vh" }} ref={calendarRef}>
              <div
                className="relative"
                style={{ height: `${TOTAL_MINUTES * PIXELS_PER_MINUTE}px` }}
                data-testid="calendar-timeline"
              >
                {/* Now indicator */}
                {viewingToday && <NowIndicator />}

                {/* Availability blocks */}
                {dayAvailability.map((block) => {
                  const [sh, sm] = block.startTime.split(":").map(Number);
                  const [eh, em] = block.endTime.split(":").map(Number);
                  const topMin = minutesSinceStart(sh, sm);
                  const endMin = minutesSinceStart(eh, em);
                  return (
                    <div
                      key={block.id}
                      className="absolute left-0 right-0 bg-primary/5 border-l-2 border-primary/20"
                      style={{
                        top: `${topMin * PIXELS_PER_MINUTE}px`,
                        height: `${(endMin - topMin) * PIXELS_PER_MINUTE}px`,
                      }}
                      data-testid={`availability-block-${block.id}`}
                    />
                  );
                })}

                {/* Time slots */}
                {slots.map(({ hour, minute }) => {
                  const topMin = minutesSinceStart(hour, minute);
                  const top = topMin * PIXELS_PER_MINUTE;
                  const isFullHour = minute === 0;
                  return (
                    <div key={`slot-${hour}-${minute}`}>
                      <div
                        className="absolute left-0 right-0 flex items-start pointer-events-none"
                        style={{ top: `${top}px` }}
                      >
                        {isFullHour ? (
                          <>
                            <span className="w-14 text-right pr-2 text-[11px] text-muted-foreground -mt-1.5 select-none shrink-0">
                              {formatHour(hour)}
                            </span>
                            <div className="flex-1 border-t border-border/50" />
                          </>
                        ) : (
                          <>
                            <span className="w-14 text-right pr-2 text-[10px] text-muted-foreground/50 -mt-1 select-none shrink-0">
                              :30
                            </span>
                            <div className="flex-1 border-t border-dashed border-border/25" />
                          </>
                        )}
                      </div>
                      <div
                        className="absolute left-16 right-2 cursor-pointer rounded-sm transition-colors group hover:bg-primary/5 active:bg-primary/10"
                        style={{ top: `${top}px`, height: `${HALF_SLOT_HEIGHT}px`, zIndex: 1 }}
                        onClick={() => handleSlotClick(hour, minute)}
                        data-testid={`slot-${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
                      >
                        <div className="flex items-center justify-center h-full opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Booking blocks */}
                {dayBookings.map((booking) => (
                  <BookingBlock
                    key={booking.id}
                    booking={booking}
                    redeemedIds={redeemedIds}
                    onStatusChange={(id, status) => updateStatusMutation.mutate({ bookingId: id, status })}
                    onRedeem={(id) => redeemMutation.mutate(id)}
                    onEdit={(b) => setEditBooking(b)}
                    statusPending={updateStatusMutation.isPending}
                    redeemPending={redeemMutation.isPending}
                    isConflict={dayConflictIds.has(booking.id)}
                  />
                ))}
              </div>
            </Card>
          </div>

          {/* Quick time picker popover */}
          {quickPickerSlot && (
            <div className="fixed inset-0 z-40" onClick={() => setQuickPickerSlot(null)}>
              <div
                className="absolute bottom-0 left-0 right-0 sm:bottom-auto sm:left-auto sm:right-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <Card className="rounded-b-none sm:rounded-lg p-4 space-y-3 shadow-xl border sm:w-64 mx-auto max-w-sm w-full">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Choose start time</p>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-xs"
                      onClick={() => setQuickPickerSlot(null)}
                      data-testid="button-close-time-picker"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quickPickerOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="flex-1 min-w-[80px] py-2 px-3 rounded-md border text-sm font-medium bg-background hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                        onClick={() => handlePickerSelect(opt.value)}
                        data-testid={`time-chip-${opt.value}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* Day session list */}
          {dayBookings.length > 0 ? (
            <DaySessionList
              bookings={dayBookings}
              conflictIds={dayConflictIds}
              onEdit={(b) => setEditBooking(b)}
              onStatusChange={(id, status) => updateStatusMutation.mutate({ bookingId: id, status })}
              onRedeem={(id) => redeemMutation.mutate(id)}
              redeemedIds={redeemedIds}
              statusPending={updateStatusMutation.isPending}
              redeemPending={redeemMutation.isPending}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3" data-testid="text-empty-day">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No sessions on {format(selectedDate, "MMMM d")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tap a time slot in the timeline or use "Add Session" to get started.
                </p>
              </div>
              <AddSessionDialog
                initialDate={selectedDate}
                initialTime="09:00"
                coachId={activeCoachId}
                triggerButton={
                  <Button variant="outline" size="sm" data-testid="button-empty-add-session">
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Session
                  </Button>
                }
              />
            </div>
          )}
        </>
      )}

      {viewMode === "week" && (
        <>
          {weekBookings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3" data-testid="text-empty-week">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No sessions this week</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
                </p>
              </div>
            </div>
          )}
          <WeekView
            weekDays={weekDays}
            bookings={bookings || []}
            onDaySelect={(d) => { setSelectedDate(d); setViewMode("day"); }}
            onBookingEdit={(b) => setEditBooking(b)}
          />
        </>
      )}

      {viewMode === "month" && (
        <>
          {monthBookings.length === 0 && (
            <div className="text-center py-4" data-testid="text-empty-month">
              <p className="text-sm text-muted-foreground">No sessions scheduled in {format(selectedDate, "MMMM yyyy")}.</p>
            </div>
          )}
          <MonthView
            selectedDate={selectedDate}
            bookings={bookings || []}
            onDaySelect={(d) => { setSelectedDate(d); setViewMode("day"); }}
          />
        </>
      )}

      {/* Edit Session Dialog */}
      {editBooking && (
        <EditSessionDialog
          booking={editBooking}
          open={!!editBooking}
          onOpenChange={(open) => { if (!open) setEditBooking(null); }}
        />
      )}
    </div>
  );
}
