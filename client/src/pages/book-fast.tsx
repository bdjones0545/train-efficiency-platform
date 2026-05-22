import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { format, parseISO, isToday, isTomorrow, addDays, startOfDay } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  Clock,
  MapPin,
  Users,
  ChevronRight,
  Zap,
  Plus,
  X,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import type { Service } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";

type AvailSlot = {
  date: string;
  start: string;
  end: string;
  location: string;
  coachId: string;
  coachName: string;
  coachAvatar: string | null;
};

type AvailDay = {
  date: string;
  slots: AvailSlot[];
};

function formatDateLabel(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE M/d");
}

function formatPrice(service: Service): string {
  if (service.name.toLowerCase().includes("team training")) return "Quoted";
  if (service.priceCents === 0) return "Free";
  return `$${(service.priceCents / 100).toFixed(0)}`;
}

function ServiceCard({
  service,
  selected,
  onClick,
  freeUsed,
}: {
  service: Service;
  selected: boolean;
  onClick: () => void;
  freeUsed: boolean;
}) {
  const isFreeIntro = service.name.toLowerCase().includes("free intro");
  const disabled = isFreeIntro && freeUsed;
  const price = formatPrice(service);
  const isFree = price === "Free";

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      data-testid={`card-service-${service.id}`}
      className={`relative w-full rounded-xl border p-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        disabled
          ? "opacity-40 cursor-not-allowed border-border bg-card/30"
          : selected
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]"
          : "border-border bg-card/60 hover:border-primary/50 hover:bg-card/80 active:scale-[0.98]"
      }`}
    >
      {selected && (
        <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
      )}
      {isFreeIntro && !freeUsed && (
        <Badge className="absolute top-3 right-3 text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-1.5 py-0.5">
          Free
        </Badge>
      )}
      <div className="pr-6">
        <p className="font-semibold text-sm leading-snug">{service.name}</p>
        {service.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
            {service.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {service.durationMin}min
          </span>
          <span
            className={`text-xs font-semibold ${
              isFree ? "text-emerald-400" : "text-foreground"
            }`}
          >
            {price}
          </span>
        </div>
        {disabled && (
          <p className="text-xs text-muted-foreground mt-1">Already used</p>
        )}
      </div>
    </button>
  );
}

function SlotRow({
  slot,
  serviceDuration,
  onSelect,
}: {
  slot: AvailSlot;
  serviceDuration: number;
  onSelect: () => void;
}) {
  const time = format(parseISO(slot.start), "h:mm a");
  const initials = slot.coachName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <button
      onClick={onSelect}
      data-testid={`slot-row-${slot.start}-${slot.coachId}`}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-card/60 hover:border-primary/50 hover:bg-card/90 active:scale-[0.99] transition-all duration-100 text-left group"
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={slot.coachAvatar || undefined} />
        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{time}</span>
          <span className="text-xs text-muted-foreground">
            {serviceDuration}min
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {slot.coachName}
          </span>
          {slot.location && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs text-muted-foreground flex items-center gap-0.5 truncate">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                {slot.location.split("(")[0].trim()}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
    </button>
  );
}

export default function BookFastPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailSlot | null>(null);
  const [showCoachSheet, setShowCoachSheet] = useState(false);
  const [groupDescription, setGroupDescription] = useState("");
  const [participantNames, setParticipantNames] = useState<string[]>([""]);

  const dateTrayRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: services, isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ["/api/services", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/services?organizationId=${orgId}` : "/api/services";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
  });

  const { data: freeSessionStatus } = useQuery<{ hasUsedFreeSession: boolean }>({
    queryKey: ["/api/free-session-status"],
    enabled: isAuthenticated,
  });

  const { data: coaches, isLoading: coachesLoading } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
    enabled: showCoachSheet,
  });

  const startDate = format(new Date(), "yyyy-MM-dd");

  const { data: availability, isLoading: availLoading } = useQuery<AvailDay[]>({
    queryKey: ["/api/availability", selectedServiceId, orgId, startDate],
    queryFn: async () => {
      const params = new URLSearchParams({ serviceId: selectedServiceId!, startDate, days: "14" });
      if (orgId) params.set("organizationId", orgId);
      const res = await fetch(`/api/availability?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
    enabled: !!selectedServiceId && step === 2,
  });

  useEffect(() => {
    if (availability && availability.length > 0 && !selectedDate) {
      setSelectedDate(availability[0].date);
    }
  }, [availability]);

  useEffect(() => {
    if (selectedDate && dateTrayRef.current) {
      const activeBtn = dateTrayRef.current.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement;
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [selectedDate]);

  const selectedServiceData = services?.find((s) => s.id === selectedServiceId);
  const isSemiPrivate = selectedServiceData?.name?.toLowerCase().includes("semi-private") ?? false;

  const activeBookableServices = services?.filter((s) => s.active && s.isBookableByClient !== false) ?? [];

  const currentDaySlots =
    availability?.find((d) => d.date === selectedDate)?.slots ?? [];

  const bookMutation = useMutation({
    mutationFn: async (data: {
      coachId: string;
      serviceId: string;
      startAt: string;
      endAt: string;
      location?: string;
      groupDescription?: string;
      participantNames?: string[];
    }) => {
      const res = await apiRequest("POST", "/api/bookings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Booked!", description: "Your session has been confirmed." });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/availability"] });
      queryClient.invalidateQueries({ queryKey: ["/api/free-session-status"] });
      setSelectedSlot(null);
      setGroupDescription("");
      setParticipantNames([""]);
      setStep(1);
      setSelectedServiceId(null);
      setSelectedDate(null);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Please log in",
          description: "You need to be logged in to book.",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/";
        }, 500);
        return;
      }
      toast({ title: "Booking Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleBook = () => {
    if (!isAuthenticated) {
      window.location.href = "/";
      return;
    }
    if (!selectedSlot || !selectedServiceId) return;
    const filledNames = participantNames.filter((n) => n.trim());
    bookMutation.mutate({
      coachId: selectedSlot.coachId,
      serviceId: selectedServiceId,
      startAt: selectedSlot.start,
      endAt: selectedSlot.end,
      location: selectedSlot.location || "",
      ...(isSemiPrivate
        ? {
            groupDescription,
            participantNames: filledNames.length > 0 ? filledNames : undefined,
          }
        : {}),
    });
  };

  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedDate(null);
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
    setSelectedDate(null);
    setSelectedSlot(null);
  };

  return (
    <div className="space-y-5 pb-12">
      {step === 1 && (
        <>
          <div className="flex items-center gap-2 pt-1">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold" data-testid="text-book-fast-title">
                Book Fast
              </h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground -mt-3">
            Choose a session type to see available times.
          </p>

          {servicesLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : activeBookableServices.length > 0 ? (
            <div className="grid grid-cols-2 gap-3" data-testid="service-cards-grid">
              {activeBookableServices
                .sort((a, b) => {
                  const aFree = a.name.toLowerCase().includes("free intro");
                  const bFree = b.name.toLowerCase().includes("free intro");
                  if (aFree && !bFree) return -1;
                  if (!aFree && bFree) return 1;
                  return a.priceCents - b.priceCents;
                })
                .map((service) => {
                  const isFreeIntro = service.name.toLowerCase().includes("free intro");
                  const freeUsed = !!(isFreeIntro && freeSessionStatus?.hasUsedFreeSession);
                  return (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      selected={selectedServiceId === service.id}
                      onClick={() => handleServiceSelect(service.id)}
                      freeUsed={freeUsed}
                    />
                  );
                })}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No services available.</p>
            </Card>
          )}

          <div className="pt-2 border-t border-border/40">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => setShowCoachSheet(true)}
              data-testid="button-prefer-specific-coach"
            >
              Prefer a specific coach?
            </Button>
          </div>
        </>
      )}

      {step === 2 && selectedServiceData && (
        <>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="px-2"
              data-testid="button-back-to-services"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-base leading-tight truncate">
                {selectedServiceData.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {selectedServiceData.durationMin}min ·{" "}
                {formatPrice(selectedServiceData)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs shrink-0"
              onClick={() => setShowCoachSheet(true)}
              data-testid="button-prefer-specific-coach-step2"
            >
              Choose coach
            </Button>
          </div>

          {availLoading ? (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-hidden">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-9 w-20 rounded-full shrink-0" />
                ))}
              </div>
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            </div>
          ) : !availability || availability.length === 0 ? (
            <Card className="p-8 text-center space-y-3">
              <Calendar className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium">No availability found</p>
              <p className="text-xs text-muted-foreground">
                No coaches have open slots for this service in the next 14 days.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCoachSheet(true)}
              >
                Browse coaches instead
              </Button>
            </Card>
          ) : (
            <>
              <div
                ref={dateTrayRef}
                className="flex gap-2 overflow-x-auto pb-1 no-scrollbar"
                data-testid="date-tabs"
              >
                {availability.map((day) => {
                  const label = formatDateLabel(day.date);
                  const isActive = selectedDate === day.date;
                  return (
                    <button
                      key={day.date}
                      data-date={day.date}
                      onClick={() => setSelectedDate(day.date)}
                      data-testid={`date-tab-${day.date}`}
                      className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`ml-1.5 rounded-full px-1 py-0 text-[10px] ${
                          isActive
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {day.slots.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <div className="space-y-2" data-testid="slot-list">
                  {currentDaySlots.length === 0 ? (
                    <Card className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No slots on this day.
                      </p>
                    </Card>
                  ) : (
                    currentDaySlots.map((slot) => (
                      <SlotRow
                        key={`${slot.start}-${slot.coachId}`}
                        slot={slot}
                        serviceDuration={selectedServiceData.durationMin}
                        onSelect={() => setSelectedSlot(slot)}
                      />
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <Dialog
        open={!!selectedSlot}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSlot(null);
            setGroupDescription("");
            setParticipantNames([""]);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-booking">
          <DialogHeader>
            <DialogTitle>Confirm Booking</DialogTitle>
            <DialogDescription>Review your session and confirm</DialogDescription>
          </DialogHeader>
          {selectedSlot && selectedServiceData && (
            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2.5">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selectedSlot.coachAvatar || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {selectedSlot.coachName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold">{selectedSlot.coachName}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedServiceData.name}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {format(parseISO(selectedSlot.start), "EEE, MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {format(parseISO(selectedSlot.start), "h:mm a")} –{" "}
                      {format(parseISO(selectedSlot.end), "h:mm a")}
                    </span>
                  </div>
                  {selectedSlot.location && (
                    <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{selectedSlot.location}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 col-span-2">
                    <span className="font-semibold text-foreground">
                      {formatPrice(selectedServiceData)}
                    </span>
                    <span className="text-muted-foreground">
                      · {selectedServiceData.durationMin} min
                    </span>
                    {isSemiPrivate && (
                      <span className="flex items-center gap-1 text-muted-foreground ml-auto">
                        <Users className="h-3.5 w-3.5" />
                        Group
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {isSemiPrivate && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="group-description">What is this session for?</Label>
                    <Textarea
                      id="group-description"
                      placeholder="e.g., Speed & agility for soccer team..."
                      value={groupDescription}
                      onChange={(e) => setGroupDescription(e.target.value)}
                      className="resize-none"
                      rows={2}
                      data-testid="input-group-description"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Participants</Label>
                    <div className="space-y-2">
                      {participantNames.map((name, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            placeholder={`Participant ${idx + 1}`}
                            value={name}
                            onChange={(e) => {
                              const updated = [...participantNames];
                              updated[idx] = e.target.value;
                              setParticipantNames(updated);
                            }}
                            data-testid={`input-participant-${idx}`}
                          />
                          {participantNames.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setParticipantNames(participantNames.filter((_, i) => i !== idx))
                              }
                              data-testid={`button-remove-participant-${idx}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {participantNames.length < 6 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setParticipantNames([...participantNames, ""])}
                        data-testid="button-add-participant"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Participant
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleBook}
                disabled={bookMutation.isPending}
                data-testid="button-confirm-booking"
              >
                {bookMutation.isPending ? "Booking..." : "Confirm Booking"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={showCoachSheet} onOpenChange={setShowCoachSheet}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl">
          <SheetHeader className="pb-4">
            <SheetTitle>Choose a Coach</SheetTitle>
            <SheetDescription>
              View a specific coach's schedule and availability.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto space-y-2 pb-6">
            {coachesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : coaches && coaches.length > 0 ? (
              coaches.map((coach) => (
                <button
                  key={coach.id}
                  onClick={() => {
                    setShowCoachSheet(false);
                    navigate(`/coaches/${coach.id}`);
                  }}
                  data-testid={`button-choose-coach-${coach.id}`}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card/60 hover:border-primary/50 hover:bg-card/80 active:scale-[0.99] transition-all text-left group"
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={coach.photoUrl || coach.user?.profileImageUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                      {(coach.user?.firstName?.[0] || "C").toUpperCase()}
                      {(coach.user?.lastName?.[0] || "").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">
                      {coach.user?.firstName} {coach.user?.lastName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {coach.specialties && coach.specialties.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          {coach.specialties.slice(0, 3).join(" · ")}
                        </p>
                      )}
                      {coach.location && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                          <MapPin className="h-2.5 w-2.5" />
                          {coach.location}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No coaches found.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
