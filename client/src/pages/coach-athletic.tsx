import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { ChevronLeft, ChevronRight, Clock, Users, Trophy, Zap, Dumbbell, Plus, X, Trash2 } from "lucide-react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, addDays, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AthleticBooking } from "@shared/schema";

const START_HOUR = 16;
const END_HOUR = 20;
const SLOT_HEIGHT_PX = 120;
const MAX_TEAMS_PER_SLOT = 2;

const TIME_SLOTS = [
  { id: "16:00", label: "4:00 PM", hour: 16 },
  { id: "17:00", label: "5:00 PM", hour: 17 },
  { id: "18:00", label: "6:00 PM", hour: 18 },
  { id: "19:00", label: "7:00 PM", hour: 19 },
];

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour;
  return `${h} ${suffix}`;
}

export default function CoachAthleticPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<typeof TIME_SLOTS[0] | null>(null);
  const [teamName, setTeamName] = useState("");
  const [trainingType, setTrainingType] = useState<"speed" | "strength">("strength");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { toast } = useToast();

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data: bookings, isLoading } = useQuery<AthleticBooking[]>({
    queryKey: ["/api/athletic/bookings", dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/bookings?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
  });

  const bookMutation = useMutation({
    mutationFn: async (data: { date: string; timeSlot: string; teamName: string; trainingType: string }) => {
      const res = await apiRequest("POST", "/api/athletic/bookings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", dateStr] });
      setScheduleDialogOpen(false);
      setTeamName("");
      setTrainingType("strength");
      setSelectedSlot(null);
      toast({ title: "Team Added", description: "The team has been scheduled for this time slot." });
    },
    onError: (error: any) => {
      toast({ title: "Could not schedule", description: error.message || "This slot may be full.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/athletic/bookings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/bookings", dateStr] });
      setDeleteConfirmId(null);
      toast({ title: "Removed", description: "The team booking has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove the booking.", variant: "destructive" });
    },
  });

  const getSlotBookings = (slotId: string) => {
    return bookings?.filter((b) => b.timeSlot === slotId) || [];
  };

  const handleSlotClick = (slot: typeof TIME_SLOTS[0]) => {
    const slotBookings = getSlotBookings(slot.id);
    if (slotBookings.length >= MAX_TEAMS_PER_SLOT) return;
    setSelectedSlot(slot);
    setTeamName("");
    setTrainingType("strength");
    setScheduleDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !teamName.trim()) return;
    bookMutation.mutate({
      date: dateStr,
      timeSlot: selectedSlot.id,
      teamName: teamName.trim(),
      trainingType,
    });
  };

  const totalBooked = bookings?.length || 0;
  const totalSlots = TIME_SLOTS.length * MAX_TEAMS_PER_SLOT;
  const slotsAvailable = totalSlots - totalBooked;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-coach-athletic-title">
            <Trophy className="h-6 w-6 text-primary" />
            BLHS Athletic Scheduling
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage team training schedules for Bluffton High School</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
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
                <CalendarIcon className="h-4 w-4 mr-2" />
                {format(selectedDate, "EEEE, MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => { if (d) { setSelectedDate(d); setCalendarOpen(false); } }}
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
        <div className="flex items-center gap-3">
          <Card className="px-3 py-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid="text-teams-booked">{totalBooked}</span>
            <span className="text-xs text-muted-foreground">Booked</span>
          </Card>
          <Card className="px-3 py-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid="text-slots-available">{slotsAvailable}</span>
            <span className="text-xs text-muted-foreground">Available</span>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden" data-testid="calendar-timeline">
        <div className="relative" style={{ height: `${TIME_SLOTS.length * SLOT_HEIGHT_PX}px` }}>
          {TIME_SLOTS.map((slot, i) => {
            const top = i * SLOT_HEIGHT_PX;
            const slotBookings = getSlotBookings(slot.id);
            const isFull = slotBookings.length >= MAX_TEAMS_PER_SLOT;

            return (
              <div key={slot.id} className="absolute left-0 right-0" style={{ top: `${top}px`, height: `${SLOT_HEIGHT_PX}px` }}>
                <div className="absolute inset-0 border-b border-border/50" />
                <div className="absolute left-0 top-0 w-14 h-full flex items-start justify-end pr-2 pt-2">
                  <span className="text-xs text-muted-foreground font-medium">{slot.label}</span>
                </div>

                {slotBookings.map((booking, j) => (
                  <div
                    key={booking.id}
                    className="absolute left-14 right-2 rounded-md border px-3 py-2 bg-primary/10 border-primary/20"
                    style={{
                      top: `${4 + j * 52}px`,
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
                      <Badge variant="secondary" className="flex-shrink-0">
                        {booking.trainingType === "speed" ? (
                          <><Zap className="h-3 w-3 mr-1" />Speed</>
                        ) : (
                          <><Dumbbell className="h-3 w-3 mr-1" />Strength</>
                        )}
                      </Badge>
                      <div className="ml-auto flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDeleteConfirmId(booking.id)}
                          data-testid={`button-delete-booking-${booking.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {!isFull && (
                  <div
                    className="absolute left-14 right-2 cursor-pointer group"
                    style={{
                      top: `${4 + slotBookings.length * 52}px`,
                      height: `${SLOT_HEIGHT_PX - 8 - slotBookings.length * 52}px`,
                      zIndex: 5,
                    }}
                    onClick={() => handleSlotClick(slot)}
                    data-testid={`slot-click-area-${slot.id}`}
                  >
                    <div className="h-full rounded-md border border-dashed border-border/60 flex items-center justify-center gap-2 text-muted-foreground/60 group-hover:border-primary/40 group-hover:text-primary/60 transition-colors">
                      <Plus className="h-4 w-4" />
                      <span className="text-xs font-medium">Add Team</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

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
              Add Team
            </DialogTitle>
            <DialogDescription>
              {selectedSlot && (
                <>
                  {format(selectedDate, "EEEE, MMM d")} — {formatHour(selectedSlot.hour)} to {formatHour(selectedSlot.hour + 1)}
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
              {bookMutation.isPending ? "Adding..." : "Add Team"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="sm:max-w-sm" data-testid="modal-delete-confirm">
          <DialogHeader>
            <DialogTitle>Remove Team Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this team from this time slot?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteConfirmId(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); }}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
