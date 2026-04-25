import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import {
  format,
  parseISO,
  isSameDay,
  addDays,
  subDays,
  getDay,
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

function GroupParticipants({ bookingId, max }: { bookingId: string; max: number }) {
  const { data: participants } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", bookingId, "participants"],
  });
  const count = participants?.length || 0;
  return (
    <span className="text-xs" data-testid={`group-participants-${bookingId}`}>
      {count}/{max} athletes
    </span>
  );
}

function BookingParticipantInfo({ booking }: { booking: BookingWithDetails }) {
  if (!booking.maxParticipants) return null;
  return (
    <>
      <div className="flex items-center gap-1 text-[11px] opacity-80">
        <Users className="h-3 w-3" />
        <GroupParticipants bookingId={booking.id} max={booking.maxParticipants} />
      </div>
      {booking.groupDescription && (
        <div className="text-[10px] opacity-70 truncate">{booking.groupDescription}</div>
      )}
    </>
  );
}

function BookingBlock({
  booking,
  redeemedIds,
  onStatusChange,
  onRedeem,
  onEdit,
  statusPending,
  redeemPending,
}: {
  booking: BookingWithDetails;
  redeemedIds: Set<string>;
  onStatusChange: (id: string, status: string) => void;
  onRedeem: (id: string) => void;
  onEdit: (booking: BookingWithDetails) => void;
  statusPending: boolean;
  redeemPending: boolean;
}) {
  const startDt = parseISO(booking.startAt as unknown as string);
  const endDt = parseISO(booking.endAt as unknown as string);
  const topMin = minutesSinceStart(startDt.getHours(), startDt.getMinutes());
  const endMin = minutesSinceStart(endDt.getHours(), endDt.getMinutes());
  const durationMin = Math.max(endMin - topMin, 15);

  const top = topMin * PIXELS_PER_MINUTE;
  const height = durationMin * PIXELS_PER_MINUTE;

  const colorClass = statusColors[booking.status] || statusColors.PENDING;
  const isActive = ["CONFIRMED", "PENDING"].includes(booking.status);
  const isCompleted = booking.status === "COMPLETED";
  const isRedeemed = redeemedIds.has(booking.id);

  return (
    <div
      className={`absolute left-16 right-2 rounded-md border px-3 py-1.5 overflow-hidden cursor-pointer ${colorClass}`}
      style={{ top: `${top}px`, height: `${height}px`, minHeight: "36px", zIndex: 10 }}
      onClick={() => onEdit(booking)}
      data-testid={`calendar-booking-${booking.id}`}
    >
      <div className="flex items-start justify-between gap-1 h-full">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate">
              {booking.service?.name || "Session"}
            </span>
            <Badge className={`text-[10px] px-1 py-0 ${statusColors[booking.status]}`}>
              {booking.status}
            </Badge>
          </div>
          <div className="text-[11px] opacity-80">
            {format(startDt, "h:mm a")} — {format(endDt, "h:mm a")}
          </div>
          {booking.client && !booking.maxParticipants && (
            <div className="text-[11px] opacity-80 truncate">
              {booking.client.firstName} {booking.client.lastName}
            </div>
          )}
          {booking.location && (
            <div className="text-[10px] opacity-70 truncate flex items-center gap-0.5" data-testid={`text-location-${booking.id}`}>
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              {booking.location}
            </div>
          )}
          <BookingParticipantInfo booking={booking} />
        </div>

        {height >= 30 && (
          <div className="flex flex-col gap-0.5 shrink-0">
            {isActive && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "COMPLETED"); }}
                  disabled={statusPending}
                  title="Mark Completed"
                  data-testid={`button-complete-${booking.id}`}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "NO_SHOW"); }}
                  disabled={statusPending}
                  title="No-Show"
                  data-testid={`button-noshow-${booking.id}`}
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(booking.id, "CANCELLED"); }}
                  disabled={statusPending}
                  title="Cancel"
                  data-testid={`button-cancel-${booking.id}`}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            {isCompleted && !isRedeemed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onRedeem(booking.id); }}
                disabled={redeemPending}
                title="Redeem"
                data-testid={`button-redeem-${booking.id}`}
              >
                <DollarSign className="h-3.5 w-3.5" />
              </Button>
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
    : "My Schedule";

  const { data: bookings, isLoading: bookingsLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/coach/bookings", activeCoachId],
    queryFn: () => fetchWithAuth(activeCoachId ? `/api/coach/bookings?coachId=${activeCoachId}` : "/api/coach/bookings"),
    enabled: !!activeCoachId,
  });

  const { data: availability } = useQuery<AvailabilityBlock[]>({
    queryKey: ["/api/coach/availability", activeCoachId],
    queryFn: () => fetchWithAuth(activeCoachId ? `/api/coach/availability?coachId=${activeCoachId}` : "/api/coach/availability"),
    enabled: !!activeCoachId,
  });

  const { data: redemptions } = useQuery<RedemptionWithDetails[]>({
    queryKey: ["/api/coach/redemptions", activeCoachId],
    queryFn: () => fetchWithAuth(activeCoachId ? `/api/coach/redemptions?coachId=${activeCoachId}` : "/api/coach/redemptions"),
    enabled: !!activeCoachId,
  });

  const redeemedIds = new Set(redemptions?.map((r) => r.bookingId) || []);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status Updated" });
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
      toast({ title: "Session Redeemed", description: "Payout is pending." });
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

  const dayBookings = (bookings || []).filter((b) =>
    isSameDay(parseISO(b.startAt as unknown as string), selectedDate)
  );

  const jsDow = getDay(selectedDate);
  const drizzleDow = jsDow === 0 ? 6 : jsDow - 1;
  const dayAvailability = (availability || []).filter((a) => a.dayOfWeek === drizzleDow);

  const dayStats = {
    total: dayBookings.length,
    confirmed: dayBookings.filter((b) => b.status === "CONFIRMED").length,
    completed: dayBookings.filter((b) => b.status === "COMPLETED").length,
    pending: dayBookings.filter((b) => b.status === "PENDING").length,
  };

  const scrollToHour = useCallback((hour: number) => {
    if (!calendarRef.current) return;
    const offset = minutesSinceStart(hour, 0) * PIXELS_PER_MINUTE;
    calendarRef.current.scrollTop = Math.max(0, offset - 20);
  }, []);

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

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[600px] w-full" />
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

  return (
    <div className="space-y-4">
      {/* Title + action buttons */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-coach-dashboard-title">
            Coach Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Daily calendar view</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {orgData?.subscriptionsEnabled && (
            <SubscriptionScheduleDialog
              coachId={activeCoachId}
              triggerButton={
                <Button variant="outline" className="w-full sm:w-auto" data-testid="button-schedule-subscription">
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Schedule Subscription
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
                <Plus className="h-4 w-4 mr-1" />
                Add Session
              </Button>
            }
          />
        </div>
      </div>

      {/* Coach selector */}
      {coaches && coaches.length > 1 && (
        <Card className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground shrink-0">View Coach:</span>
            <Select
              value={activeCoachId}
              onValueChange={(val) => setSelectedCoachId(val)}
            >
              <SelectTrigger className="w-full sm:w-64" data-testid="select-coach-toggle">
                <SelectValue placeholder="Select a coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.filter(c => c.isActive).map((coach) => (
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

      {/* Date navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSelectedDate(subDays(selectedDate, 1))}
          data-testid="button-prev-day"
        >
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
              onSelect={(date) => {
                if (date) setSelectedDate(date);
                setCalendarOpen(false);
              }}
              data-testid="calendar-day-picker"
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          data-testid="button-next-day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedDate(new Date())}
          data-testid="button-today"
        >
          Today
        </Button>
      </div>

      {/* Quick scroll controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">Jump to:</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => scrollToHour(6)}
          data-testid="button-scroll-morning"
        >
          <Sunrise className="h-3 w-3" />
          Morning
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => scrollToHour(12)}
          data-testid="button-scroll-afternoon"
        >
          <Sun className="h-3 w-3" />
          Afternoon
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => scrollToHour(16)}
          data-testid="button-scroll-evening"
        >
          <Sunset className="h-3 w-3" />
          Evening
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-primary" data-testid="text-day-total">{dayStats.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold" data-testid="text-day-confirmed">{dayStats.confirmed}</p>
          <p className="text-xs text-muted-foreground">Confirmed</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold" data-testid="text-day-pending">{dayStats.pending}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold" data-testid="text-day-completed">{dayStats.completed}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </Card>
      </div>

      {/* Calendar card */}
      <div className="relative">
        {/* Sticky mini header */}
        {showStickyHeader && (
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 py-2 bg-background/95 backdrop-blur-sm border-b rounded-t-lg">
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{format(selectedDate, "EEEE, MMM d")}</span>
              {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">· {selectedCoachName}</span>
              )}
            </div>
            <AddSessionDialog
              initialDate={selectedDate}
              initialTime={slotTime}
              coachId={activeCoachId}
              triggerButton={
                <Button size="sm" className="h-7 text-xs shrink-0" data-testid="button-add-session-sticky">
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              }
            />
          </div>
        )}

        <Card className="p-0 overflow-x-hidden overflow-y-auto" style={{ maxHeight: "70vh" }} ref={calendarRef}>
          <div
            className="relative"
            style={{ height: `${TOTAL_MINUTES * PIXELS_PER_MINUTE}px` }}
            data-testid="calendar-timeline"
          >
            {/* Availability background blocks */}
            {dayAvailability.map((block) => {
              const [sh, sm] = block.startTime.split(":").map(Number);
              const [eh, em] = block.endTime.split(":").map(Number);
              const topMin = minutesSinceStart(sh, sm);
              const endMin = minutesSinceStart(eh, em);
              const top = topMin * PIXELS_PER_MINUTE;
              const height = (endMin - topMin) * PIXELS_PER_MINUTE;
              return (
                <div
                  key={block.id}
                  className="absolute left-0 right-0 bg-primary/5 border-l-2 border-primary/20"
                  style={{ top: `${top}px`, height: `${height}px` }}
                  data-testid={`availability-block-${block.id}`}
                />
              );
            })}

            {/* 30-minute time slots */}
            {slots.map(({ hour, minute }) => {
              const topMin = minutesSinceStart(hour, minute);
              const top = topMin * PIXELS_PER_MINUTE;
              const isFullHour = minute === 0;
              const slotKey = `slot-${hour}-${minute}`;

              return (
                <div key={slotKey}>
                  {/* Divider line */}
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

                  {/* Clickable slot area */}
                  <div
                    className="absolute left-16 right-2 cursor-pointer rounded-sm transition-colors group hover:bg-primary/5 active:bg-primary/10"
                    style={{ top: `${top}px`, height: `${HALF_SLOT_HEIGHT}px`, zIndex: 1 }}
                    onClick={() => handleSlotClick(hour, minute)}
                    data-testid={`slot-${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
                  >
                    <div className="flex items-center justify-center h-full opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Bookings */}
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
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Quick time picker popover */}
      {quickPickerSlot && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setQuickPickerSlot(null)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 sm:bottom-auto sm:left-auto sm:right-auto"
            onClick={(e) => e.stopPropagation()}
            style={{
              bottom: 0,
            }}
          >
            <Card className="rounded-b-none sm:rounded-lg p-4 space-y-3 shadow-xl border sm:relative sm:bottom-auto sm:left-auto sm:right-auto sm:w-64 mx-auto max-w-sm w-full">
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

      {dayBookings.length === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            No sessions scheduled for {format(selectedDate, "EEEE, MMMM d")}. Tap a time slot or use "Add Session" to schedule one.
          </p>
        </div>
      )}

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
