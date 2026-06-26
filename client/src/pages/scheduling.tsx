import { TrainLogo } from "@/components/train-logo";
import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/query-error-state";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  format,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  addWeeks, subWeeks,
  addDays, subDays,
  addMonths, subMonths,
  isSameDay, isToday, isSameMonth,
  differenceInMinutes, startOfDay,
  getHours, getMinutes,
  eachDayOfInterval,
  parseISO,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Calendar,
  Filter,
  X,
  Clock,
  User as UserIcon,
  MapPin,
  Bot,
  CalendarIcon,
  Lock,
  LayoutList,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  Users,
  DollarSign,
  BarChart3,
  AlignLeft,
  CheckCircle,
  XCircle,
  RefreshCcw,
  Eye,
} from "lucide-react";
import { Link } from "wouter";
import type { Booking, Service, CoachProfile, User } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";
import { ScheduleSessionForm, type ScheduleFormData } from "@/components/schedule-session-form";

type BookingWithDetails = Booking & {
  service?: Service;
  client?: User;
  coach?: CoachProfile & { user: User };
};

type CalendarView = "day" | "week" | "month" | "agenda";

// ─── Constants ───────────────────────────────────────────────────────────────

const HOUR_START = 5;  // 5 AM
const HOUR_END = 22;   // 10 PM
const HOUR_HEIGHT = 64; // px per hour
const TOTAL_HOURS = HOUR_END - HOUR_START;
const GRID_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  NO_SHOW: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  RESCHEDULED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

// Service type → calendar event color
const SERVICE_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  GROUP:         { bg: "bg-green-500",  text: "text-white", dot: "bg-green-500",  border: "border-green-600" },
  "1_ON_1":      { bg: "bg-blue-500",   text: "text-white", dot: "bg-blue-500",   border: "border-blue-600" },
  TEAM_TRAINING: { bg: "bg-purple-500", text: "text-white", dot: "bg-purple-500", border: "border-purple-600" },
  ASSESSMENT:    { bg: "bg-orange-500", text: "text-white", dot: "bg-orange-500", border: "border-orange-600" },
  RECOVERY:      { bg: "bg-teal-500",   text: "text-white", dot: "bg-teal-500",   border: "border-teal-600" },
  SEMI_PRIVATE:  { bg: "bg-indigo-500", text: "text-white", dot: "bg-indigo-500", border: "border-indigo-600" },
};
const CANCELLED_COLOR = { bg: "bg-red-400",  text: "text-white", dot: "bg-red-400",  border: "border-red-500" };
const DEFAULT_COLOR    = { bg: "bg-gray-400", text: "text-white", dot: "bg-gray-400", border: "border-gray-500" };

const SESSION_TYPE_LABELS: Record<string, string> = {
  "1_ON_1": "1-on-1",
  GROUP: "Group",
  SEMI_PRIVATE: "Semi-Private",
  TEAM_TRAINING: "Team Training",
  ASSESSMENT: "Assessment",
  RECOVERY: "Recovery",
};

const BOOKING_STATUSES = ["CONFIRMED", "PENDING", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];

function getEventColor(booking: BookingWithDetails) {
  if (booking.status === "CANCELLED") return CANCELLED_COLOR;
  const type = booking.service?.sessionType;
  return (type && SERVICE_TYPE_COLORS[type]) || DEFAULT_COLOR;
}

function getTopPct(date: Date): number {
  const h = getHours(date);
  const m = getMinutes(date);
  const minutesFromStart = (h - HOUR_START) * 60 + m;
  return (minutesFromStart / (TOTAL_HOURS * 60)) * GRID_HEIGHT;
}

function getHeightPx(start: Date, end: Date): number {
  const mins = Math.max(differenceInMinutes(end, start), 15);
  return (mins / 60) * HOUR_HEIGHT;
}

// ─── Color Legend ─────────────────────────────────────────────────────────────

function ColorLegend() {
  const [showLegend, setShowLegend] = useState(false);
  const items = [
    { label: "Group", color: "bg-green-500" },
    { label: "1-on-1", color: "bg-blue-500" },
    { label: "Team Training", color: "bg-purple-500" },
    { label: "Assessment", color: "bg-orange-500" },
    { label: "Semi-Private", color: "bg-indigo-500" },
    { label: "Recovery", color: "bg-teal-500" },
    { label: "Cancelled", color: "bg-red-400" },
  ];
  return (
    <div>
      {/* Mobile: collapsible toggle */}
      <button
        className="flex md:hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowLegend(v => !v)}
      >
        <Eye className="h-3 w-3" />
        Legend
        <ChevronDown className={`h-3 w-3 transition-transform ${showLegend ? "rotate-180" : ""}`} />
      </button>
      {/* Legend items — always on desktop, toggled on mobile */}
      <div className={`flex flex-wrap gap-x-4 gap-y-1.5 ${showLegend ? "mt-2" : "hidden"} md:flex md:mt-0`}>
        {items.map(i => (
          <div key={i.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2.5 h-2.5 rounded-full ${i.color} shrink-0`} />
            {i.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Metrics Dashboard ────────────────────────────────────────────────────────

function MetricsDashboard({ bookings }: { bookings: BookingWithDetails[] }) {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

  const todaySessions = useMemo(() =>
    bookings.filter(b => isToday(new Date(b.startAt)) && b.status !== "CANCELLED").length,
    [bookings]
  );
  const weekSessions = useMemo(() =>
    bookings.filter(b => {
      const d = new Date(b.startAt);
      return d >= weekStart && d <= weekEnd && b.status !== "CANCELLED";
    }).length,
    [bookings, weekStart, weekEnd]
  );
  const revenueScheduled = useMemo(() =>
    bookings
      .filter(b => {
        const d = new Date(b.startAt);
        return d >= weekStart && d <= weekEnd && b.status !== "CANCELLED";
      })
      .reduce((sum, b) => sum + (b.service?.priceCents ?? 0), 0) / 100,
    [bookings, weekStart, weekEnd]
  );
  const confirmedCount = useMemo(() =>
    bookings.filter(b => b.status === "CONFIRMED" && new Date(b.startAt) >= now).length,
    [bookings, now]
  );

  const metrics = [
    {
      label: "Today's Sessions",
      value: todaySessions,
      icon: CalendarDays,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      testId: "metric-today-sessions",
    },
    {
      label: "This Week",
      value: weekSessions,
      icon: CalendarRange,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/30",
      testId: "metric-week-sessions",
    },
    {
      label: "Confirmed",
      value: confirmedCount,
      icon: CheckCircle,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950/30",
      testId: "metric-confirmed",
    },
    {
      label: "Week Revenue",
      value: `$${revenueScheduled.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      icon: DollarSign,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      testId: "metric-revenue",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map(m => (
        <Card key={m.label} className="border-0 shadow-sm" data-testid={m.testId}>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={`p-1.5 sm:p-2 rounded-lg ${m.bg} shrink-0`}>
                <m.icon className={`h-4 w-4 ${m.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground leading-tight">{m.label}</p>
                <p className={`text-lg sm:text-xl font-bold ${m.color} leading-tight`} data-testid={`${m.testId}-value`}>{m.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Event Quick-Action Dialog ────────────────────────────────────────────────

function EventDetailDialog({
  booking,
  onClose,
  onCancel,
  onReschedule,
  onComplete,
  onNoShow,
  isRedeemed,
}: {
  booking: BookingWithDetails | null;
  onClose: () => void;
  onCancel: (b: BookingWithDetails) => void;
  onReschedule: (b: BookingWithDetails) => void;
  onComplete: (b: BookingWithDetails) => void;
  onNoShow: (b: BookingWithDetails) => void;
  isRedeemed?: boolean;
}) {
  if (!booking) return null;
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  const isPast = end < new Date();
  const isActive = booking.status === "CONFIRMED" || booking.status === "PENDING";
  const color = getEventColor(booking);

  return (
    <Dialog open={!!booking} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-3 h-3 rounded-full ${color.bg} shrink-0`} />
            <DialogTitle className="text-base" data-testid="text-event-detail-title">
              {booking.service?.name || "Session"}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className={STATUS_COLORS[booking.status] || ""}>
              {booking.status}
            </Badge>
            {booking.service?.sessionType && (
              <Badge variant="outline">
                {SESSION_TYPE_LABELS[booking.service.sessionType] || booking.service.sessionType}
              </Badge>
            )}
            {isRedeemed && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200">
                <Lock className="h-2.5 w-2.5 mr-1" />Redeemed
              </Badge>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>{format(start, "EEEE, MMM d")}</span>
            </div>
            <div className="flex items-center gap-2 pl-5">
              <span>{format(start, "h:mm a")} – {format(end, "h:mm a")}</span>
            </div>
            {booking.client && (
              <div className="flex items-center gap-2">
                <UserIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{booking.client.firstName} {booking.client.lastName}</span>
              </div>
            )}
            {booking.coach?.user && (
              <div className="flex items-center gap-2">
                <TrainLogo className="h-3.5 w-3.5 shrink-0" />
                <span>{booking.coach.user.firstName} {booking.coach.user.lastName}</span>
              </div>
            )}
            {booking.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{booking.location}</span>
              </div>
            )}
          </div>

          {booking.notes && (
            <p className="text-xs text-muted-foreground italic">{booking.notes}</p>
          )}

          {isActive && (
            <div className="flex flex-wrap gap-2 pt-1">
              {!isPast && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs flex-1"
                  onClick={() => { onReschedule(booking); onClose(); }}
                  data-testid={`button-event-reschedule-${booking.id}`}
                >
                  <RefreshCcw className="h-3 w-3 mr-1" />
                  Reschedule
                </Button>
              )}
              {isPast && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs flex-1"
                    onClick={() => { onComplete(booking); onClose(); }}
                    data-testid={`button-event-complete-${booking.id}`}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs text-orange-600 border-orange-200 hover:bg-orange-50 dark:text-orange-400 flex-1"
                    onClick={() => { onNoShow(booking); onClose(); }}
                    data-testid={`button-event-noshow-${booking.id}`}
                  >
                    No Show
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 flex-1"
                onClick={() => { onCancel(booking); onClose(); }}
                data-testid={`button-event-cancel-${booking.id}`}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Time Grid (shared by Day + Week) ─────────────────────────────────────────

function TimeLabels() {
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);
  return (
    <div className="w-14 shrink-0 relative" style={{ height: GRID_HEIGHT }}>
      {hours.map(h => (
        <div
          key={h}
          className="absolute right-2 text-[10px] text-muted-foreground leading-none"
          style={{ top: (h - HOUR_START) * HOUR_HEIGHT - 6 }}
        >
          {format(new Date().setHours(h, 0), "h a")}
        </div>
      ))}
    </div>
  );
}

function HourLines() {
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);
  return (
    <>
      {hours.map(i => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-border/40"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}
    </>
  );
}

function NowLine({ day }: { day: Date }) {
  if (!isToday(day)) return null;
  const now = new Date();
  const top = getTopPct(now);
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top }}
    >
      <div className="relative">
        <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500" />
        <div className="h-0.5 bg-red-500" />
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({
  bookings,
  currentDay,
  onEventClick,
}: {
  bookings: BookingWithDetails[];
  currentDay: Date;
  onEventClick: (b: BookingWithDetails) => void;
}) {
  const dayBookings = useMemo(
    () => bookings.filter(b => isSameDay(new Date(b.startAt), currentDay)),
    [bookings, currentDay]
  );

  return (
    <div className="flex" style={{ height: GRID_HEIGHT }}>
      <TimeLabels />
      <div className="flex-1 relative border-l border-border/40">
        <HourLines />
        <NowLine day={currentDay} />
        {dayBookings.map(b => {
          const start = new Date(b.startAt);
          const end = new Date(b.endAt);
          const top = getTopPct(start);
          const height = Math.max(getHeightPx(start, end), 24);
          const color = getEventColor(b);
          if (top < 0 || top > GRID_HEIGHT) return null;
          return (
            <div
              key={b.id}
              className={`absolute left-1 right-1 rounded-md px-2 py-1 cursor-pointer hover:opacity-90 transition-opacity border ${color.bg} ${color.text} ${color.border} shadow-sm`}
              style={{ top, height, zIndex: 10 }}
              onClick={() => onEventClick(b)}
              data-testid={`day-event-${b.id}`}
            >
              <div className="text-xs font-semibold truncate leading-tight">{format(start, "h:mm a")}</div>
              <div className="text-xs truncate opacity-90 leading-tight">{b.service?.name}</div>
              {height > 40 && (
                <div className="text-xs truncate opacity-75 leading-tight">
                  {b.client?.firstName} {b.client?.lastName}
                </div>
              )}
            </div>
          );
        })}
        {dayBookings.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No sessions scheduled
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mobile Week View (stacked day cards) ────────────────────────────────────

function MobileWeekView({
  bookings,
  currentWeek,
  onEventClick,
  onAddSession,
}: {
  bookings: BookingWithDetails[];
  currentWeek: Date;
  onEventClick: (b: BookingWithDetails) => void;
  onAddSession: () => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentWeek]);

  return (
    <div className="space-y-2">
      {days.map(day => {
        const dayBookings = bookings
          .filter(b => isSameDay(new Date(b.startAt), day))
          .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
        const confirmed = dayBookings.filter(b => b.status === "CONFIRMED").length;
        const pending = dayBookings.filter(b => b.status === "PENDING").length;
        const isCurrent = isToday(day);

        return (
          <div
            key={day.toISOString()}
            className={`rounded-lg border overflow-hidden ${isCurrent ? "border-primary/50" : "border-border"}`}
            data-testid={`mobile-week-day-${format(day, "yyyy-MM-dd")}`}
          >
            {/* Day header */}
            <div className={`flex items-center justify-between px-3 py-2 ${isCurrent ? "bg-primary/10" : "bg-muted/40"}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold tracking-wide ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                  {format(day, "EEE").toUpperCase()}
                </span>
                <span className={`text-sm font-semibold ${isCurrent ? "text-primary" : "text-foreground"}`}>
                  {format(day, "MMM d")}
                </span>
                {isCurrent && (
                  <Badge className="text-[10px] h-4 px-1.5 bg-primary text-primary-foreground leading-none">Today</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs">
                {dayBookings.length === 0 ? (
                  <span className="text-muted-foreground/60">No sessions</span>
                ) : (
                  <>
                    <span className="text-muted-foreground">{dayBookings.length} session{dayBookings.length !== 1 ? "s" : ""}</span>
                    {confirmed > 0 && <span className="text-green-600 dark:text-green-400 font-medium">· {confirmed} confirmed</span>}
                    {pending > 0 && <span className="text-yellow-600 dark:text-yellow-400 font-medium">· {pending} pending</span>}
                  </>
                )}
              </div>
            </div>

            {/* Sessions list */}
            <div className="px-3 py-2 space-y-1">
              {dayBookings.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 italic py-0.5">No sessions scheduled</p>
              ) : (
                dayBookings.map(b => {
                  const start = new Date(b.startAt);
                  const color = getEventColor(b);
                  return (
                    <button
                      key={b.id}
                      className="w-full flex items-center gap-2 text-left hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors -mx-2"
                      onClick={() => onEventClick(b)}
                      data-testid={`mobile-week-event-${b.id}`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${color.bg}`} />
                      <span className="text-xs text-muted-foreground shrink-0 w-[52px]">{format(start, "h:mm a")}</span>
                      <span className="text-sm font-medium truncate flex-1 min-w-0">{b.service?.name || "Session"}</span>
                      {b.client && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[120px]">
                          {b.client.firstName} {b.client.lastName}
                        </span>
                      )}
                      <Badge
                        variant="secondary"
                        className={`text-[10px] h-4 px-1 leading-none shrink-0 ${STATUS_COLORS[b.status] || ""}`}
                      >
                        {b.status}
                      </Badge>
                    </button>
                  );
                })
              )}
              <Button
                size="sm"
                variant="ghost"
                className="w-full h-7 mt-1 text-xs text-muted-foreground border border-dashed border-border/60 hover:border-primary/40 hover:text-primary"
                onClick={onAddSession}
                data-testid={`button-mobile-add-session-${format(day, "yyyy-MM-dd")}`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Session
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({
  bookings,
  currentWeek,
  onEventClick,
}: {
  bookings: BookingWithDetails[];
  currentWeek: Date;
  onEventClick: (b: BookingWithDetails) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentWeek]);

  return (
    <div className="overflow-x-auto">
      {/* Day headers */}
      <div className="flex min-w-[600px]">
        <div className="w-14 shrink-0" />
        {days.map(day => {
          const isCurrentDay = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 text-center py-2 border-l border-border/40"
            >
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                {format(day, "EEE")}
              </div>
              <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold mx-auto mt-0.5 ${
                isCurrentDay ? "bg-primary text-primary-foreground" : "text-foreground"
              }`}>
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="flex min-w-[600px]" style={{ height: GRID_HEIGHT }}>
        <TimeLabels />
        {days.map(day => {
          const dayBookings = bookings.filter(b => isSameDay(new Date(b.startAt), day));
          return (
            <div key={day.toISOString()} className="flex-1 relative border-l border-border/40">
              <HourLines />
              <NowLine day={day} />
              {isToday(day) && (
                <div className="absolute inset-0 bg-blue-50/20 dark:bg-blue-950/10 pointer-events-none" />
              )}
              {dayBookings.map(b => {
                const start = new Date(b.startAt);
                const end = new Date(b.endAt);
                const top = getTopPct(start);
                const height = Math.max(getHeightPx(start, end), 20);
                const color = getEventColor(b);
                if (top < 0 || top > GRID_HEIGHT) return null;
                return (
                  <div
                    key={b.id}
                    className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 cursor-pointer hover:opacity-80 transition-opacity border-l-2 ${color.bg} ${color.text} ${color.border} shadow-sm overflow-hidden`}
                    style={{ top, height, zIndex: 10 }}
                    onClick={() => onEventClick(b)}
                    data-testid={`week-event-${b.id}`}
                    title={`${b.service?.name} — ${b.client?.firstName} ${b.client?.lastName} — ${format(start, "h:mm a")}`}
                  >
                    <div className="text-[10px] font-semibold leading-tight truncate">{format(start, "h:mm a")}</div>
                    {height > 28 && (
                      <div className="text-[10px] leading-tight truncate opacity-90">{b.service?.name}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  bookings,
  currentMonth,
  onEventClick,
}: {
  bookings: BookingWithDetails[];
  currentMonth: Date;
  onEventClick: (b: BookingWithDetails) => void;
}) {
  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start, end });
    const result: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }
    return result;
  }, [currentMonth]);

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border/40">
        {DAY_LABELS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>
      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-border/40 last:border-0">
          {week.map(day => {
            const dayBookings = bookings
              .filter(b => isSameDay(new Date(b.startAt), day))
              .sort((a, b2) => new Date(a.startAt).getTime() - new Date(b2.startAt).getTime());
            const inMonth = isSameMonth(day, currentMonth);
            const isCurrent = isToday(day);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[90px] p-1 border-l border-border/40 first:border-l-0 ${
                  inMonth ? "" : "bg-muted/20"
                }`}
              >
                <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1 ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : inMonth
                    ? "text-foreground"
                    : "text-muted-foreground/50"
                }`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayBookings.slice(0, 3).map(b => {
                    const color = getEventColor(b);
                    return (
                      <div
                        key={b.id}
                        className={`text-[10px] leading-tight px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${color.bg} ${color.text} truncate`}
                        onClick={() => onEventClick(b)}
                        data-testid={`month-event-${b.id}`}
                        title={`${b.service?.name} — ${format(new Date(b.startAt), "h:mm a")}`}
                      >
                        {format(new Date(b.startAt), "h:mm a")} {b.service?.name}
                      </div>
                    );
                  })}
                  {dayBookings.length > 3 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      +{dayBookings.length - 3} more
                    </div>
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

// ─── Agenda View (Grouped List) ────────────────────────────────────────────────

function AgendaView({
  bookings,
  redeemedBookingIds,
  onCancel,
  onReschedule,
  onComplete,
  onNoShow,
}: {
  bookings: BookingWithDetails[];
  redeemedBookingIds: Set<string>;
  onCancel: (b: BookingWithDetails) => void;
  onReschedule: (b: BookingWithDetails) => void;
  onComplete: (b: BookingWithDetails) => void;
  onNoShow: (b: BookingWithDetails) => void;
}) {
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const sorted = [...bookings].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    const map = new Map<string, BookingWithDetails[]>();
    for (const b of sorted) {
      const key = format(new Date(b.startAt), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      date: parseISO(key),
      items,
    }));
  }, [bookings]);

  const toggleDay = (key: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (grouped.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
        No bookings found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {grouped.map(({ key, date, items }) => {
        const isCollapsed = collapsedDays.has(key);
        const isCurrent = isToday(date);
        return (
          <Collapsible key={key} open={!isCollapsed} onOpenChange={() => toggleDay(key)}>
            <CollapsibleTrigger asChild>
              <button
                className={`w-full flex items-center justify-between px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isCurrent
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "bg-muted/50 hover:bg-muted text-foreground"
                }`}
                data-testid={`button-toggle-day-${key}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                    {isCurrent ? "TODAY" : format(date, "EEE").toUpperCase()}
                  </span>
                  <span>{format(date, "MMMM d, yyyy")}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="text-xs">{items.length} session{items.length !== 1 ? "s" : ""}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 ml-2 space-y-1.5 pl-2 border-l-2 border-border/40">
                {items.map(b => {
                  const start = new Date(b.startAt);
                  const end = new Date(b.endAt);
                  const isPast = end < new Date();
                  const isActive = b.status === "CONFIRMED" || b.status === "PENDING";
                  const color = getEventColor(b);
                  const isRedeemed = redeemedBookingIds.has(b.id);
                  return (
                    <div
                      key={b.id}
                      className="bg-card border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow"
                      data-testid={`agenda-booking-${b.id}`}
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${color.bg}`} />
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm" data-testid={`text-agenda-service-${b.id}`}>
                                {b.service?.name || "Session"}
                              </span>
                              <Badge variant="secondary" className={`text-xs ${STATUS_COLORS[b.status] || ""}`}>
                                {b.status}
                              </Badge>
                              {b.service?.sessionType && (
                                <Badge variant="outline" className="text-xs">
                                  {SESSION_TYPE_LABELS[b.service.sessionType] || b.service.sessionType}
                                </Badge>
                              )}
                              {isRedeemed && (
                                <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30">
                                  <Lock className="h-2.5 w-2.5 mr-1" />Redeemed
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(start, "h:mm a")} – {format(end, "h:mm a")}
                              </span>
                              {b.coach?.user && (
                                <span className="flex items-center gap-1">
                                  <TrainLogo className="h-3 w-3" />
                                  {b.coach.user.firstName} {b.coach.user.lastName}
                                </span>
                              )}
                              {b.client && (
                                <span className="flex items-center gap-1">
                                  <UserIcon className="h-3 w-3" />
                                  {b.client.firstName} {b.client.lastName}
                                </span>
                              )}
                              {b.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {b.location}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isActive && (
                          <div className="flex gap-1.5 flex-wrap shrink-0">
                            {!isPast && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReschedule(b)} data-testid={`button-agenda-reschedule-${b.id}`}>
                                Reschedule
                              </Button>
                            )}
                            {isPast && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onComplete(b)} data-testid={`button-agenda-complete-${b.id}`}>
                                  Complete
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => onNoShow(b)} data-testid={`button-agenda-noshow-${b.id}`}>
                                  No Show
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onCancel(b)} data-testid={`button-agenda-cancel-${b.id}`}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const { toast } = useToast();
  const [view, setView] = useState<CalendarView>("week");
  const [currentDate, setCurrentDate] = useState(new Date());

  const [filterCoach, setFilterCoach] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSessionType, setFilterSessionType] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [cancelBooking, setCancelBooking] = useState<BookingWithDetails | null>(null);
  const [rescheduleBooking, setRescheduleBooking] = useState<BookingWithDetails | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BookingWithDetails | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);

  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleStartTime, setRescheduleStartTime] = useState("09:00");
  const [rescheduleCalendarOpen, setRescheduleCalendarOpen] = useState(false);

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: bookings = [], isLoading, isError, refetch } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/scheduling/bookings"],
  });

  const { data: redemptions = [] } = useQuery<{ id: string; bookingId: string; redeemedAt: string | null; amountCents: number }[]>({
    queryKey: ["/api/coach/redemptions"],
  });
  const redeemedBookingIds = useMemo(() => new Set(redemptions.map(r => r.bookingId)), [redemptions]);

  const { data: coaches = [] } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/coaches?organizationId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
  });
  const { data: services = [] } = useQuery<Service[]>({ queryKey: ["/api/services"] });
  const { data: locations = [] } = useQuery<any[]>({ queryKey: ["/api/locations"] });

  // ── Mutations ──
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/scheduling/bookings/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({ title: "Booking updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, startAt, endAt }: { id: string; startAt: string; endAt: string }) =>
      apiRequest("PATCH", `/api/scheduling/bookings/${id}`, { startAt, endAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      setRescheduleBooking(null);
      setRescheduleDate(undefined);
      setRescheduleStartTime("09:00");
      toast({ title: "Booking rescheduled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/scheduling/bookings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      setCreateOpen(false);
      setCreateFormKey(k => k + 1);
      toast({ title: "Session scheduled", description: "The session has been added to the schedule." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleCreateSubmit = (data: ScheduleFormData) => {
    createMutation.mutate({
      clientId: data.clientId,
      coachId: data.coachId,
      serviceId: data.serviceId,
      startAt: data.startAt.toISOString(),
      endAt: data.endAt.toISOString(),
      location: data.location,
      notes: data.notes,
    });
  };

  const handleRescheduleSubmit = () => {
    if (!rescheduleBooking || !rescheduleDate || !rescheduleStartTime) return;
    const [hours, minutes] = rescheduleStartTime.split(":").map(Number);
    const startAt = new Date(rescheduleDate);
    startAt.setHours(hours, minutes, 0, 0);
    const durationMin = rescheduleBooking.service?.durationMin || 60;
    const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);
    rescheduleMutation.mutate({ id: rescheduleBooking.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
  };

  // ── Filters ──
  const filtered = useMemo(() => {
    return bookings.filter(b => {
      if (filterCoach !== "all" && b.coachId !== filterCoach) return false;
      if (filterStatus !== "all" && b.status !== filterStatus) return false;
      if (filterSessionType !== "all" && b.service?.sessionType !== filterSessionType) return false;
      if (filterLocation !== "all") {
        const locName = locations.find(l => l.id === filterLocation)?.name;
        if (locName && b.location !== locName) return false;
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const clientName = `${b.client?.firstName} ${b.client?.lastName}`.toLowerCase();
        const coachName = `${b.coach?.user?.firstName} ${b.coach?.user?.lastName}`.toLowerCase();
        const svcName = (b.service?.name || "").toLowerCase();
        if (!clientName.includes(q) && !coachName.includes(q) && !svcName.includes(q)) return false;
      }
      return true;
    });
  }, [bookings, filterCoach, filterStatus, filterSessionType, filterLocation, searchTerm, locations]);

  const uniqueSessionTypes = useMemo(() => {
    const types = new Set(bookings.map(b => b.service?.sessionType).filter(Boolean));
    return Array.from(types) as string[];
  }, [bookings]);

  const hasFilters = filterCoach !== "all" || filterStatus !== "all" || filterSessionType !== "all" || filterLocation !== "all" || searchTerm;

  const clearFilters = () => {
    setFilterCoach("all");
    setFilterStatus("all");
    setFilterSessionType("all");
    setFilterLocation("all");
    setSearchTerm("");
  };

  // ── Navigation ──
  const navigatePrev = () => {
    if (view === "day") setCurrentDate(d => subDays(d, 1));
    else if (view === "week") setCurrentDate(d => subWeeks(d, 1));
    else if (view === "month") setCurrentDate(d => subMonths(d, 1));
  };
  const navigateNext = () => {
    if (view === "day") setCurrentDate(d => addDays(d, 1));
    else if (view === "week") setCurrentDate(d => addWeeks(d, 1));
    else if (view === "month") setCurrentDate(d => addMonths(d, 1));
  };
  const navigateToday = () => setCurrentDate(new Date());

  const dateRangeLabel = useMemo(() => {
    if (view === "day") return format(currentDate, "EEEE, MMMM d, yyyy");
    if (view === "week") {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
    }
    if (view === "month") return format(currentDate, "MMMM yyyy");
    return "All Bookings";
  }, [view, currentDate]);

  // Filter bookings relevant to the current view window
  const viewBookings = useMemo(() => {
    if (view === "agenda") return filtered;
    if (view === "day") return filtered.filter(b => isSameDay(new Date(b.startAt), currentDate));
    if (view === "week") {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = endOfWeek(currentDate, { weekStartsOn: 0 });
      return filtered.filter(b => {
        const d = new Date(b.startAt);
        return d >= s && d <= e;
      });
    }
    if (view === "month") {
      const s = startOfMonth(currentDate);
      const e = endOfMonth(currentDate);
      return filtered.filter(b => {
        const d = new Date(b.startAt);
        return d >= s && d <= e;
      });
    }
    return filtered;
  }, [view, filtered, currentDate]);

  const VIEW_TABS = [
    { key: "day" as CalendarView, label: "Day", icon: CalendarDays },
    { key: "week" as CalendarView, label: "Week", icon: CalendarRange },
    { key: "month" as CalendarView, label: "Month", icon: Calendar },
    { key: "agenda" as CalendarView, label: "Agenda", icon: LayoutList },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-scheduling-title">Scheduling</h1>
          <p className="text-sm text-muted-foreground">Your scheduling operating system</p>
        </div>
        <div className="flex gap-2">
          <Link href="/scheduling/agent">
            <Button variant="outline" size="sm" data-testid="button-open-agent">
              <Bot className="h-4 w-4 mr-2" />
              Agent
            </Button>
          </Link>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-booking">
            <Plus className="h-4 w-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

      {/* ── Metrics Dashboard ── */}
      {isError ? (
        <QueryErrorState
          title="Unable to load bookings"
          message="There was a problem fetching your schedule. Please try again."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <MetricsDashboard bookings={bookings} />
      )}

      {/* ── Calendar Toolbar ── */}
      <Card className="shadow-sm">
        <CardContent className="p-3">
          <div className="flex flex-col gap-3">
            {/* Top row: view tabs + nav */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* View tabs */}
              <div className="flex gap-1 bg-muted rounded-lg p-1">
                {VIEW_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setView(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      view === tab.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-view-${tab.key}`}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Navigation */}
              {view !== "agenda" && (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={navigatePrev} data-testid="button-nav-prev">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs px-3" onClick={navigateToday} data-testid="button-nav-today">
                    Today
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={navigateNext} data-testid="button-nav-next">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-semibold ml-2 text-foreground min-w-0" data-testid="text-date-range">
                    {dateRangeLabel}
                  </span>
                </div>
              )}

              {/* Filter toggle */}
              <div className="flex items-center gap-1 ml-auto">
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={clearFilters} data-testid="button-clear-filters">
                    <X className="h-3 w-3 mr-1" />Clear
                  </Button>
                )}
                <Button
                  variant={showFilters ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setShowFilters(v => !v)}
                  data-testid="button-toggle-filters"
                >
                  <Filter className="h-3 w-3 mr-1" />
                  Filters
                  {hasFilters && <span className="ml-1 text-primary font-bold">•</span>}
                </Button>
              </div>
            </div>

            {/* Filters row (collapsible) */}
            {showFilters && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40">
                <Input
                  placeholder="Search client, coach, service..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="h-8 w-full sm:w-48 text-sm"
                  data-testid="input-search-bookings"
                />
                <Select value={filterCoach} onValueChange={setFilterCoach}>
                  <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-coach">
                    <SelectValue placeholder="All Coaches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Coaches</SelectItem>
                    {coaches.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.user.firstName} {c.user.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-status">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {BOOKING_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterSessionType} onValueChange={setFilterSessionType}>
                  <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-filter-type">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {uniqueSessionTypes.map(t => (
                      <SelectItem key={t} value={t}>{SESSION_TYPE_LABELS[t] || t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {locations.length > 0 && (
                  <Select value={filterLocation} onValueChange={setFilterLocation}>
                    <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-location">
                      <SelectValue placeholder="All Locations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Color legend */}
            <div className="border-t border-border/40 pt-2">
              <ColorLegend />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Calendar Body ── */}
      {isLoading ? (
        <Card><CardContent className="p-6">
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </CardContent></Card>
      ) : view === "day" ? (
        <Card className="shadow-sm">
          <CardContent className="p-4 overflow-y-auto" style={{ maxHeight: 700 }}>
            <DayView
              bookings={filtered}
              currentDay={currentDate}
              onEventClick={setSelectedEvent}
            />
          </CardContent>
        </Card>
      ) : view === "week" ? (
        <Card className="shadow-sm">
          {/* Mobile: stacked day cards */}
          <CardContent className="p-3 md:hidden pb-20">
            <MobileWeekView
              bookings={filtered}
              currentWeek={currentDate}
              onEventClick={setSelectedEvent}
              onAddSession={() => setCreateOpen(true)}
            />
          </CardContent>
          {/* Desktop: time grid */}
          <CardContent className="hidden md:block p-4 overflow-y-auto" style={{ maxHeight: 700 }}>
            <WeekView
              bookings={filtered}
              currentWeek={currentDate}
              onEventClick={setSelectedEvent}
            />
          </CardContent>
        </Card>
      ) : view === "month" ? (
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <MonthView
              bookings={filtered}
              currentMonth={currentDate}
              onEventClick={setSelectedEvent}
            />
          </CardContent>
        </Card>
      ) : (
        <AgendaView
          bookings={filtered}
          redeemedBookingIds={redeemedBookingIds}
          onCancel={setCancelBooking}
          onReschedule={b => { setRescheduleBooking(b); setRescheduleDate(new Date(b.startAt)); setRescheduleStartTime(format(new Date(b.startAt), "HH:mm")); }}
          onComplete={b => updateStatusMutation.mutate({ id: b.id, status: "COMPLETED" })}
          onNoShow={b => updateStatusMutation.mutate({ id: b.id, status: "NO_SHOW" })}
        />
      )}

      {/* ── Event Detail Dialog ── */}
      <EventDetailDialog
        booking={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onCancel={b => { setSelectedEvent(null); setCancelBooking(b); }}
        onReschedule={b => { setSelectedEvent(null); setRescheduleBooking(b); setRescheduleDate(new Date(b.startAt)); setRescheduleStartTime(format(new Date(b.startAt), "HH:mm")); }}
        onComplete={b => { updateStatusMutation.mutate({ id: b.id, status: "COMPLETED" }); setSelectedEvent(null); }}
        onNoShow={b => { updateStatusMutation.mutate({ id: b.id, status: "NO_SHOW" }); setSelectedEvent(null); }}
        isRedeemed={selectedEvent ? redeemedBookingIds.has(selectedEvent.id) : false}
      />

      {/* ── Cancel Dialog ── */}
      <AlertDialog open={!!cancelBooking} onOpenChange={() => setCancelBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-cancel-dialog-title">Cancel Booking?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the booking for{" "}
              <strong>{cancelBooking?.client?.firstName} {cancelBooking?.client?.lastName}</strong>
              {" "}on{" "}
              <strong>{cancelBooking && format(new Date(cancelBooking.startAt), "MMM d 'at' h:mm a")}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog-close">Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelBooking) {
                  updateStatusMutation.mutate({ id: cancelBooking.id, status: "CANCELLED" });
                  setCancelBooking(null);
                }
              }}
              data-testid="button-cancel-confirm"
            >
              Cancel Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reschedule Dialog ── */}
      <Dialog
        open={!!rescheduleBooking}
        onOpenChange={v => {
          if (!v) { setRescheduleBooking(null); setRescheduleDate(undefined); setRescheduleStartTime("09:00"); }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="text-reschedule-dialog-title">Reschedule Booking</DialogTitle>
          </DialogHeader>
          {rescheduleBooking && (
            <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground mb-1">
              {rescheduleBooking.service?.name} · {format(new Date(rescheduleBooking.startAt), "MMM d 'at' h:mm a")}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>New Date</Label>
              <Popover open={rescheduleCalendarOpen} onOpenChange={setRescheduleCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="button-reschedule-select-date">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {rescheduleDate ? format(rescheduleDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarWidget
                    mode="single"
                    selected={rescheduleDate}
                    onSelect={date => { setRescheduleDate(date); setRescheduleCalendarOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>New Start Time</Label>
                {rescheduleDate && rescheduleStartTime && rescheduleBooking && (
                  <span className="text-xs text-muted-foreground" data-testid="text-reschedule-end-time">
                    {(() => {
                      const [h, m] = rescheduleStartTime.split(":").map(Number);
                      const dur = rescheduleBooking.service?.durationMin || 60;
                      const end = new Date();
                      end.setHours(h, m + dur);
                      return `ends ${format(end, "h:mm a")} · ${dur} min`;
                    })()}
                  </span>
                )}
              </div>
              <Select value={rescheduleStartTime} onValueChange={setRescheduleStartTime}>
                <SelectTrigger data-testid="select-reschedule-time">
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {(() => {
                    const opts: string[] = [];
                    for (let h = 5; h < 22; h++) {
                      for (let m = 0; m < 60; m += 15) {
                        opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
                      }
                    }
                    return opts.map(t => {
                      const [hh, mm] = t.split(":").map(Number);
                      const d = new Date(); d.setHours(hh, mm);
                      return <SelectItem key={t} value={t}>{format(d, "h:mm a")}</SelectItem>;
                    });
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleBooking(null)}>Cancel</Button>
            <Button onClick={handleRescheduleSubmit} disabled={rescheduleMutation.isPending || !rescheduleDate} data-testid="button-reschedule-confirm">
              {rescheduleMutation.isPending ? "Saving..." : "Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Session Dialog ── */}
      <Dialog open={createOpen} onOpenChange={v => { setCreateOpen(v); if (!v) setCreateFormKey(k => k + 1); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-create-dialog-title">Schedule a Session</DialogTitle>
          </DialogHeader>
          <ScheduleSessionForm
            key={createFormKey}
            services={services}
            coaches={coaches}
            locations={locations}
            showCoachSelector={true}
            submitLabel={createMutation.isPending ? "Scheduling..." : "Schedule Session"}
            isSubmitting={createMutation.isPending}
            onSubmit={handleCreateSubmit}
            onCancel={() => { setCreateOpen(false); setCreateFormKey(k => k + 1); }}
            onValidationError={msg => toast({ title: "Missing required fields", description: msg, variant: "destructive" })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
