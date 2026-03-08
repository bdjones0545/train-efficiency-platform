import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
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
import { ChevronLeft, ChevronRight, Clock, Users, Trophy, ArrowLeft, Zap, Dumbbell, X, AlertTriangle } from "lucide-react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, addDays, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AthleticBooking } from "@shared/schema";

const SLOT_HEIGHT_PX = 120;
const MAX_TEAMS_PER_SLOT = 2;

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

export default function AthleticSchedulingPage() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug || "efficiencystrength";

  const { data: org, isLoading: orgLoading } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;
  const programName = org?.athleticProgramName || "Athletic Scheduling";

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ id: string; label: string; hour: number } | null>(null);
  const [teamName, setTeamName] = useState("");
  const [trainingType, setTrainingType] = useState<"speed" | "strength">("strength");
  const { toast } = useToast();

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data: config } = useQuery<{ startHour: number; endHour: number }>({
    queryKey: ["/api/athletic/config", orgId, dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/config?date=${dateStr}&orgId=${orgId}`);
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    enabled: !!orgId,
  });

  const startHour = config?.startHour ?? 16;
  const endHour = config?.endHour ?? 20;
  const timeSlots = buildTimeSlots(startHour, endHour);

  const { data: bookings, isLoading } = useQuery<AthleticBooking[]>({
    queryKey: ["/api/athletic/bookings", orgId, dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/bookings?date=${dateStr}&orgId=${orgId}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
    enabled: !!orgId,
  });

  const bookMutation = useMutation({
    mutationFn: async (data: { date: string; timeSlot: string; teamName: string; trainingType: string; organizationId: string }) => {
      const res = await apiRequest("POST", "/api/athletic/bookings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", orgId, dateStr] });
      setScheduleDialogOpen(false);
      setTeamName("");
      setTrainingType("strength");
      setSelectedSlot(null);
      toast({ title: "Scheduled!", description: "Your team has been booked for this time slot." });
    },
    onError: (error: any) => {
      toast({ title: "Could not schedule", description: error.message || "This slot may be full.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("DELETE", `/api/athletic/bookings/${bookingId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", orgId, dateStr] });
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
    if (slotBookings.length >= MAX_TEAMS_PER_SLOT) return;
    setSelectedSlot(slot);
    setTeamName("");
    setTrainingType("strength");
    setScheduleDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !teamName.trim() || !orgId) return;
    bookMutation.mutate({
      date: dateStr,
      timeSlot: selectedSlot.id,
      teamName: teamName.trim(),
      trainingType,
      organizationId: orgId,
    });
  };

  const totalBooked = bookings?.length || 0;
  const slotsAvailable = timeSlots.filter(s => getSlotBookings(s.id).length < MAX_TEAMS_PER_SLOT).length;
  const backUrl = slug ? `/org/${slug}` : "/";

  if (orgLoading) {
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
          <div className="flex items-center gap-3">
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
              <p className="text-2xl font-bold" data-testid="text-max-per-slot">{MAX_TEAMS_PER_SLOT}</p>
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
                const isFull = slotBookings.length >= MAX_TEAMS_PER_SLOT;
                const top = i * SLOT_HEIGHT_PX;

                return (
                  <div key={slot.id}>
                    <div
                      className="absolute left-0 right-0 border-b border-border/50"
                      style={{ top: `${top}px` }}
                    >
                      <span className="absolute left-2 top-1 text-xs text-muted-foreground font-medium" data-testid={`text-hour-${slot.id}`}>
                        {formatHour(slot.hour)}
                      </span>
                    </div>

                    <div
                      className={`absolute left-0 right-0 ${isFull ? "bg-destructive/5" : "bg-primary/5"}`}
                      style={{ top: `${top}px`, height: `${SLOT_HEIGHT_PX}px` }}
                    />

                    {slotBookings.map((booking, j) => (
                      <div
                        key={booking.id}
                        className="absolute left-14 right-2 rounded-md border px-3 py-2 bg-primary/10 border-primary/20"
                        style={{
                          top: `${top + 4 + j * 52}px`,
                          height: "44px",
                          zIndex: 10,
                        }}
                        data-testid={`booking-block-${booking.id}`}
                      >
                        <div className="flex items-center gap-2 h-full">
                          <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm font-semibold truncate" data-testid={`text-team-name-${booking.id}`}>
                            {booking.teamName}
                          </span>
                          <Badge variant="secondary" className="flex-shrink-0" data-testid={`badge-training-type-${booking.id}`}>
                            {booking.trainingType === "speed" ? (
                              <><Zap className="h-3 w-3 mr-1" />Speed</>
                            ) : (
                              <><Dumbbell className="h-3 w-3 mr-1" />Strength</>
                            )}
                          </Badge>
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
                            Click to schedule a team
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

      <Dialog open={scheduleDialogOpen} onOpenChange={(open) => {
        setScheduleDialogOpen(open);
        if (!open) {
          setTeamName("");
          setTrainingType("strength");
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
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTrainingType("speed")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-colors ${
                    trainingType === "speed"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover-elevate"
                  }`}
                  data-testid="button-training-speed"
                >
                  <Zap className={`h-6 w-6 ${trainingType === "speed" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-medium ${trainingType === "speed" ? "text-primary" : "text-muted-foreground"}`}>
                    Speed
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTrainingType("strength")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-colors ${
                    trainingType === "strength"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover-elevate"
                  }`}
                  data-testid="button-training-strength"
                >
                  <Dumbbell className={`h-6 w-6 ${trainingType === "strength" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-medium ${trainingType === "strength" ? "text-primary" : "text-muted-foreground"}`}>
                    Strength
                  </span>
                </button>
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
    </div>
  );
}
