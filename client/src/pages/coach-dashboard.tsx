import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
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
import type { BookingWithDetails, ParticipantWithUser, RedemptionWithDetails } from "@/lib/types";
import type { AvailabilityBlock } from "@shared/schema";

const START_HOUR = 5;
const END_HOUR = 22;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
const SLOT_HEIGHT_PX = 60;
const PIXELS_PER_MINUTE = SLOT_HEIGHT_PX / 60;

function minutesSinceStart(hours: number, minutes: number) {
  return (hours - START_HOUR) * 60 + minutes;
}

function formatHour(hour: number) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12} ${ampm}`;
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
  statusPending,
  redeemPending,
}: {
  booking: BookingWithDetails;
  redeemedIds: Set<string>;
  onStatusChange: (id: string, status: string) => void;
  onRedeem: (id: string) => void;
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
      className={`absolute left-16 right-2 rounded-md border px-3 py-1.5 overflow-hidden ${colorClass}`}
      style={{ top: `${top}px`, height: `${height}px`, minHeight: "36px", zIndex: 10 }}
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
          <BookingParticipantInfo booking={booking} />
        </div>

        {height >= 50 && (
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

export default function CoachDashboardPage() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [slotTime, setSlotTime] = useState("09:00");
  const addSessionRef = useRef<HTMLButtonElement>(null);

  const { data: bookings, isLoading: bookingsLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/coach/bookings"],
  });

  const { data: availability } = useQuery<AvailabilityBlock[]>({
    queryKey: ["/api/coach/availability"],
  });

  const { data: redemptions } = useQuery<RedemptionWithDetails[]>({
    queryKey: ["/api/coach/redemptions"],
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

  const handleSlotClick = useCallback((hour: number) => {
    const timeStr = `${String(hour).padStart(2, "0")}:00`;
    setSlotTime(timeStr);
    setTimeout(() => addSessionRef.current?.click(), 0);
  }, []);

  if (bookingsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  const hours = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    hours.push(h);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-coach-dashboard-title">
            Coach Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Daily calendar view</p>
        </div>
        <AddSessionDialog
          initialDate={selectedDate}
          initialTime={slotTime}
          triggerButton={
            <Button ref={addSessionRef} data-testid="button-add-session">
              <Plus className="h-4 w-4 mr-1" />
              Add Session
            </Button>
          }
        />
      </div>

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
            <Button variant="outline" data-testid="button-date-picker">
              <Calendar className="h-4 w-4 mr-2" />
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
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

      <Card className="p-0 overflow-x-hidden overflow-y-auto" style={{ maxHeight: "70vh" }}>
        <div
          className="relative"
          style={{ height: `${TOTAL_MINUTES * PIXELS_PER_MINUTE}px` }}
          data-testid="calendar-timeline"
        >
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

          {hours.map((hour) => {
            const top = minutesSinceStart(hour, 0) * PIXELS_PER_MINUTE;
            return (
              <div key={hour}>
                <div className="absolute left-0 right-0 flex items-start" style={{ top: `${top}px` }}>
                  <span className="w-14 text-right pr-2 text-[11px] text-muted-foreground -mt-1.5 select-none shrink-0">
                    {formatHour(hour)}
                  </span>
                  <div className="flex-1 border-t border-border/40" />
                </div>
                <div
                  className="absolute left-16 right-2 cursor-pointer rounded-sm transition-colors hover:bg-primary/5"
                  style={{ top: `${top}px`, height: `${SLOT_HEIGHT_PX}px`, zIndex: 1 }}
                  onClick={() => handleSlotClick(hour)}
                  data-testid={`slot-${String(hour).padStart(2, "0")}:00`}
                >
                  <div className="flex items-center justify-center h-full opacity-0 hover:opacity-100 transition-opacity">
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </div>
            );
          })}

          {dayBookings.map((booking) => (
            <BookingBlock
              key={booking.id}
              booking={booking}
              redeemedIds={redeemedIds}
              onStatusChange={(id, status) => updateStatusMutation.mutate({ bookingId: id, status })}
              onRedeem={(id) => redeemMutation.mutate(id)}
              statusPending={updateStatusMutation.isPending}
              redeemPending={redeemMutation.isPending}
            />
          ))}
        </div>
      </Card>

      {dayBookings.length === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            No sessions scheduled for {format(selectedDate, "EEEE, MMMM d")}. Click a time slot or use "Add Session" to schedule one.
          </p>
        </div>
      )}
    </div>
  );
}
