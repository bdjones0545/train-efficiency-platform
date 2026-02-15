import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { ChevronLeft, ChevronRight, Clock, MapPin, ArrowLeft, Users } from "lucide-react";
import { useState } from "react";
import { format, addDays, startOfWeek, isSameDay, parseISO } from "date-fns";
import type { CoachWithUser, DaySlots } from "@/lib/types";
import type { Service } from "@shared/schema";

export default function CoachSchedulePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; start: string; end: string } | null>(null);
  const [groupDescription, setGroupDescription] = useState("");

  const { data: coach, isLoading: coachLoading } = useQuery<CoachWithUser>({
    queryKey: ["/api/coaches", params.id],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const weekEnd = addDays(weekStart, 6);

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const { data: slots, isLoading: slotsLoading } = useQuery<DaySlots[]>({
    queryKey: ["/api/coaches", params.id, "slots", weekStartStr, selectedService],
    queryFn: async () => {
      const res = await fetch(
        `/api/coaches/${params.id}/slots?serviceId=${selectedService}&weekStart=${weekStartStr}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch slots");
      return res.json();
    },
    enabled: !!selectedService,
  });

  const bookMutation = useMutation({
    mutationFn: async (data: { coachId: string; serviceId: string; startAt: string; endAt: string; groupDescription?: string }) => {
      const res = await apiRequest("POST", "/api/bookings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Booked", description: "Your session has been confirmed." });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches", params.id, "slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      setSelectedSlot(null);
      setGroupDescription("");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Please log in", description: "You need to be logged in to book.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Booking Failed", description: error.message, variant: "destructive" });
    },
  });

  const selectedServiceData = services?.find(s => s.id === selectedService);
  const isSemiPrivate = selectedServiceData?.name?.toLowerCase().includes("semi-private") ?? false;

  const handleBook = () => {
    if (!isAuthenticated) {
      window.location.href = "/";
      return;
    }
    if (!selectedSlot || !selectedService) return;
    bookMutation.mutate({
      coachId: params.id!,
      serviceId: selectedService,
      startAt: selectedSlot.start,
      endAt: selectedSlot.end,
      ...(isSemiPrivate ? { groupDescription: groupDescription } : {}),
    });
  };

  const today = new Date();

  if (coachLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!coach) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">Coach not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/coaches")}>
          Back to Coaches
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/coaches")} data-testid="button-back-coaches">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Coaches
      </Button>

      <Card className="p-6">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={coach.photoUrl || coach.user?.profileImageUrl || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
              {(coach.user?.firstName?.[0] || "C").toUpperCase()}
              {(coach.user?.lastName?.[0] || "").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-serif font-bold" data-testid="text-coach-detail-name">
              {coach.user?.firstName} {coach.user?.lastName}
            </h1>
            {coach.timezone && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {coach.timezone.replace("_", " ")}
              </p>
            )}
            {coach.bio && <p className="text-sm text-muted-foreground leading-relaxed">{coach.bio}</p>}
            {coach.specialties && coach.specialties.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {coach.specialties.map((spec) => (
                  <Badge key={spec} variant="secondary" className="text-xs">{spec}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-full sm:w-64">
          <Select value={selectedService} onValueChange={setSelectedService}>
            <SelectTrigger data-testid="select-service">
              <SelectValue placeholder="Select a service" />
            </SelectTrigger>
            <SelectContent>
              {services?.filter(s => s.active).map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name} ({service.durationMin}min) — ${(service.priceCents / 100).toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedService && (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} data-testid="button-prev-week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="font-semibold text-center" data-testid="text-week-range">
              {format(weekStart, "MMM d")} — {format(weekEnd, "MMM d, yyyy")}
            </h2>
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} data-testid="button-next-week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {slotsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {slots?.map((day) => {
                const dayDate = parseISO(day.date);
                const isPast = dayDate < today && !isSameDay(dayDate, today);
                return (
                  <div key={day.date} className="space-y-2">
                    <div className={`text-center py-1.5 rounded-md text-sm font-medium ${
                      isSameDay(dayDate, today)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}>
                      <div className="text-xs opacity-75">{day.dayLabel}</div>
                      <div>{format(dayDate, "d")}</div>
                    </div>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {day.slots.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">No slots</p>
                      ) : (
                        day.slots.map((slot) => {
                          const isSelected =
                            selectedSlot?.start === slot.start &&
                            selectedSlot?.date === day.date;
                          return (
                            <button
                              key={slot.start}
                              disabled={!slot.available || isPast}
                              onClick={() =>
                                setSelectedSlot(
                                  isSelected
                                    ? null
                                    : { date: day.date, start: slot.start, end: slot.end }
                                )
                              }
                              className={`w-full py-1.5 px-2 text-xs rounded-md border transition-colors ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : slot.available && !isPast
                                  ? "hover-elevate border-border"
                                  : "opacity-40 cursor-not-allowed border-transparent bg-muted"
                              }`}
                              data-testid={`slot-${day.date}-${slot.start}`}
                            >
                              {format(parseISO(slot.start), "h:mm a")}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {selectedSlot && (
        <Card className="p-6 border-primary/30">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-semibold">Confirm Booking</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {format(parseISO(selectedSlot.start), "EEEE, MMM d 'at' h:mm a")} —{" "}
                  {format(parseISO(selectedSlot.end), "h:mm a")}
                </div>
                <p className="text-sm text-muted-foreground">
                  with {coach.user?.firstName} {coach.user?.lastName}
                </p>
                {isSemiPrivate && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    Group session (up to 6 participants)
                  </div>
                )}
              </div>
              <Button
                onClick={handleBook}
                disabled={bookMutation.isPending}
                data-testid="button-confirm-booking"
              >
                {bookMutation.isPending ? "Booking..." : "Confirm Booking"}
              </Button>
            </div>
            {isSemiPrivate && (
              <div className="space-y-2">
                <Label htmlFor="group-description" data-testid="label-group-description">
                  What is this session for?
                </Label>
                <Textarea
                  id="group-description"
                  placeholder="e.g., Speed & agility work for soccer team, Pre-season strength training..."
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  className="resize-none"
                  rows={2}
                  data-testid="input-group-description"
                />
                <p className="text-xs text-muted-foreground">
                  This description will be visible to other clients who can join your session.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
