import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CalendarIcon, Search, Trash2, XCircle, MapPin, DollarSign, UserPlus, Users, X, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, addDays } from "date-fns";
import type { Service, Organization } from "@shared/schema";
import type { ParticipantWithUser, BookingWithDetails } from "@/lib/types";

type ClientSearchResult = { id: string; firstName: string | null; lastName: string | null; email: string | null };

type EditSessionDialogProps = {
  booking: BookingWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditSessionDialog({ booking, open, onOpenChange }: EditSessionDialogProps) {
  const { toast } = useToast();

  const startDt = parseISO(booking.startAt as unknown as string);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(startDt);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [serviceId, setServiceId] = useState(booking.serviceId);
  const [startTime, setStartTime] = useState(format(startDt, "HH:mm"));
  const [clientFirstName, setClientFirstName] = useState(booking.client?.firstName || "");
  const [clientLastName, setClientLastName] = useState(booking.client?.lastName || "");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(booking.clientId);
  const [searchQuery, setSearchQuery] = useState("");
  const [notes, setNotes] = useState(booking.notes || "");
  const [groupDescription, setGroupDescription] = useState(booking.groupDescription || "");
  const [ageRange, setAgeRange] = useState(booking.ageRange || "");
  const [skillLevel, setSkillLevel] = useState(booking.skillLevel || "");
  const [editMaxParticipants, setEditMaxParticipants] = useState(String(booking.maxParticipants || 6));
  const [showSearch, setShowSearch] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"single" | "all">("single");
  const [participantSearchQuery, setParticipantSearchQuery] = useState("");
  const [showParticipantSearch, setShowParticipantSearch] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(booking.paymentMethod || "");
  const [showCloneStep, setShowCloneStep] = useState(false);
  const [cloneInterval, setCloneInterval] = useState<string>("7");
  const [cloneEndDate, setCloneEndDate] = useState<string>("");
  const [cloneDays, setCloneDays] = useState<number[]>([]);

  const initLocation = booking.location || "";
  const isPreset = orgLocations.includes(initLocation);
  const [location, setLocation] = useState(isPreset ? initLocation : (initLocation ? "__custom__" : ""));
  const [customLocation, setCustomLocation] = useState(isPreset ? "" : initLocation);

  useEffect(() => {
    if (open) {
      const dt = parseISO(booking.startAt as unknown as string);
      setSelectedDate(dt);
      setServiceId(booking.serviceId);
      setStartTime(format(dt, "HH:mm"));
      setClientFirstName(booking.client?.firstName || "");
      setClientLastName(booking.client?.lastName || "");
      setSelectedClientId(booking.clientId);
      setNotes(booking.notes || "");
      setGroupDescription(booking.groupDescription || "");
      setAgeRange(booking.ageRange || "");
      setSkillLevel(booking.skillLevel || "");
      setEditMaxParticipants(String(booking.maxParticipants || 6));
      const loc = booking.location || "";
      const preset = orgLocations.includes(loc);
      setLocation(preset ? loc : (loc ? "__custom__" : ""));
      setCustomLocation(preset ? "" : loc);
      setSearchQuery("");
      setShowSearch(false);
      setParticipantSearchQuery("");
      setShowParticipantSearch(false);
      setWalkInName("");
      setPaymentMethod(booking.paymentMethod || "");
      setShowCloneStep(false);
      setCloneInterval("7");
      setCloneEndDate("");
      setCloneDays([]);
    }
  }, [open, booking]);

  const { data: editSessionProfile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const editSessionOrgId = editSessionProfile?.organizationId;
  const { data: editSessionOrg } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", editSessionOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${editSessionOrgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!editSessionOrgId,
  });
  const orgLocations = editSessionOrg?.locations || [];
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services", editSessionOrgId],
    queryFn: async () => {
      const url = editSessionOrgId ? `/api/services?organizationId=${editSessionOrgId}` : "/api/services";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
  });

  const { data: searchResults } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const { data: participantSearchResults } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", participantSearchQuery],
    queryFn: async () => {
      if (participantSearchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(participantSearchQuery)}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: participantSearchQuery.length >= 2,
  });

  const { data: participants } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", booking.id, "participants"],
    enabled: open && !!booking.maxParticipants,
  });

  const addParticipantMutation = useMutation({
    mutationFn: async (data: { userId?: string; participantName?: string }) => {
      const res = await apiRequest("POST", `/api/coach/bookings/${booking.id}/add-participant`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Participant Added" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", booking.id, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      setParticipantSearchQuery("");
      setShowParticipantSearch(false);
      setWalkInName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeParticipantMutation = useMutation({
    mutationFn: async (participantId: string) => {
      await apiRequest("DELETE", `/api/coach/bookings/${booking.id}/participants/${participantId}`);
    },
    onSuccess: () => {
      toast({ title: "Participant Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", booking.id, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/coach/bookings/${booking.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Updated", description: "The session has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: redemptions } = useQuery<{ bookingId: string }[]>({
    queryKey: ["/api/coach/redemptions"],
    enabled: open,
  });
  const isRedeemed = redemptions?.some((r) => r.bookingId === booking.id) ?? false;

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/redemptions", { bookingId: booking.id });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Redeemed", description: "Payout is pending." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings/completed"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
        return;
      }
      toast({ title: "Redemption Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mode: "single" | "all") => {
      const url = mode === "all" && booking.recurringGroupId
        ? `/api/coach/bookings/${booking.id}?deleteGroup=true`
        : `/api/coach/bookings/${booking.id}`;
      const res = await apiRequest("DELETE", url);
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.deletedCount || 1;
      const desc = count > 1 ? `${count} recurring sessions have been removed.` : "The session has been removed.";
      toast({ title: "Session Deleted", description: desc });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (!cloneEndDate) throw new Error("Missing end date");
      const body: any = {
        bookingId: booking.id,
        endDate: cloneEndDate,
      };
      if (cloneInterval === "custom") {
        body.daysOfWeek = cloneDays;
      } else {
        body.intervalDays = parseInt(cloneInterval);
      }
      const res = await apiRequest("POST", "/api/coach/bookings/clone", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      const msg = data.skipped > 0
        ? `${data.created} session${data.created !== 1 ? "s" : ""} created, ${data.skipped} skipped (conflicts).`
        : `${data.created} session${data.created !== 1 ? "s" : ""} created!`;
      toast({ title: "Sessions Cloned", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      setShowCloneStep(false);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const selectedServiceObj = services?.find(s => s.id === serviceId);
  const isSemiPrivate = selectedServiceObj?.name.toLowerCase().includes("semi-private") || false;

  const handleSubmit = () => {
    if (!selectedDate || !serviceId || !startTime) {
      toast({ title: "Missing Fields", description: "Please fill in date, time, and service.", variant: "destructive" });
      return;
    }
    if (!isSemiPrivate && !selectedClientId && (!clientFirstName.trim() || !clientLastName.trim())) {
      toast({ title: "Missing Client", description: "Please enter or select a client.", variant: "destructive" });
      return;
    }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);

    const resolvedLocation = location === "__custom__" ? customLocation.trim() : location;
    const body: any = {
      serviceId,
      startAt: startAt.toISOString(),
      notes,
      location: resolvedLocation,
      groupDescription: isSemiPrivate ? groupDescription : "",
      ageRange: isSemiPrivate ? ageRange.trim() : "",
      skillLevel: isSemiPrivate ? skillLevel : "",
      maxParticipants: isSemiPrivate ? (parseInt(editMaxParticipants) || 6) : null,
      paymentMethod: paymentMethod || null,
    };

    if (selectedClientId && selectedClientId !== booking.clientId) {
      body.clientId = selectedClientId;
    } else if (!selectedClientId && clientFirstName.trim() && clientLastName.trim()) {
      body.clientFirstName = clientFirstName.trim();
      body.clientLastName = clientLastName.trim();
    }

    updateMutation.mutate(body);
  };

  const selectClient = (client: ClientSearchResult) => {
    setSelectedClientId(client.id);
    setClientFirstName(client.firstName || "");
    setClientLastName(client.lastName || "");
    setShowSearch(false);
    setSearchQuery("");
  };

  const clearSelectedClient = () => {
    setSelectedClientId(null);
    setClientFirstName("");
    setClientLastName("");
  };

  const timeOptions: string[] = [];
  for (let h = 5; h < 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }

  const roundedStartTime = (() => {
    const [h, m] = startTime.split(":").map(Number);
    const roundedM = Math.round(m / 15) * 15;
    const adjH = roundedM === 60 ? h + 1 : h;
    const adjM = roundedM === 60 ? 0 : roundedM;
    return `${String(adjH).padStart(2, "0")}:${String(adjM).padStart(2, "0")}`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {showCloneStep ? (
          <>
            <DialogHeader>
              <DialogTitle>Clone This Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-medium">Clone this session to future dates</p>
                <p className="text-xs text-muted-foreground mt-1">Create copies of this session on a recurring schedule.</p>
              </div>

              <div className="space-y-2">
                <Label>Repeat Every</Label>
                <Select value={cloneInterval} onValueChange={(v) => { setCloneInterval(v); if (v !== "custom") setCloneDays([]); }}>
                  <SelectTrigger data-testid="edit-select-clone-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Every week</SelectItem>
                    <SelectItem value="14">Every 2 weeks</SelectItem>
                    <SelectItem value="1">Every day</SelectItem>
                    <SelectItem value="custom">Specific days of the week</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {cloneInterval === "custom" && (
                <div className="space-y-2">
                  <Label>Select Days</Label>
                  <div className="flex flex-wrap gap-2" data-testid="edit-day-of-week-selector">
                    {[
                      { label: "Sun", value: 0 },
                      { label: "Mon", value: 1 },
                      { label: "Tue", value: 2 },
                      { label: "Wed", value: 3 },
                      { label: "Thu", value: 4 },
                      { label: "Fri", value: 5 },
                      { label: "Sat", value: 6 },
                    ].map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        data-testid={`edit-day-toggle-${day.label.toLowerCase()}`}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          cloneDays.includes(day.value)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-accent"
                        }`}
                        onClick={() => {
                          setCloneDays((prev) =>
                            prev.includes(day.value) ? prev.filter((d) => d !== day.value) : [...prev, day.value].sort()
                          );
                        }}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={cloneEndDate}
                  onChange={(e) => setCloneEndDate(e.target.value)}
                  data-testid="edit-input-clone-end-date"
                />
              </div>

              {cloneEndDate && selectedDate && (
                <p className="text-xs text-muted-foreground">
                  {cloneInterval === "custom"
                    ? `This will create sessions on ${cloneDays.map(d => ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"][d]).join(", ") || "selected days"}`
                    : `This will create sessions ${cloneInterval === "1" ? "daily" : cloneInterval === "7" ? "weekly" : "every 2 weeks"}`
                  } from{" "}
                  {cloneInterval === "custom"
                    ? format(addDays(selectedDate, 1), "MMM d, yyyy")
                    : format(addDays(selectedDate, parseInt(cloneInterval)), "MMM d, yyyy")
                  } through {format(new Date(cloneEndDate + "T12:00:00"), "MMM d, yyyy")}.
                  Conflicting time slots will be skipped.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCloneStep(false)}
                  data-testid="button-back-from-clone"
                >
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => cloneMutation.mutate()}
                  disabled={!cloneEndDate || cloneMutation.isPending || (cloneInterval === "custom" && cloneDays.length === 0)}
                  data-testid="button-clone-existing-sessions"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  {cloneMutation.isPending ? "Creating..." : "Clone Sessions"}
                </Button>
              </div>
            </div>
          </>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Edit Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger data-testid="edit-select-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {services?.filter(s => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`edit-option-service-${s.id}`}>
                    {s.name} ({s.durationMin} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isSemiPrivate && (
            <div className="space-y-2">
              <Label>Group Description</Label>
              <Textarea
                placeholder="Describe the group training..."
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                className="resize-none"
                data-testid="edit-input-group-description"
              />
            </div>
          )}

          {isSemiPrivate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Age Range</Label>
                <Input
                  placeholder="e.g. 14-18, All Ages"
                  value={ageRange}
                  onChange={(e) => setAgeRange(e.target.value)}
                  data-testid="edit-input-age-range"
                />
              </div>
              <div className="space-y-2">
                <Label>Skill Level</Label>
                <Select value={skillLevel} onValueChange={setSkillLevel}>
                  <SelectTrigger data-testid="edit-select-skill-level">
                    <SelectValue placeholder="Any level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Beginner">Beginner</SelectItem>
                    <SelectItem value="Intermediate">Intermediate</SelectItem>
                    <SelectItem value="Advanced">Advanced</SelectItem>
                    <SelectItem value="All Levels">All Levels</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isSemiPrivate && (
            <div className="space-y-2">
              <Label>Max Participants</Label>
              <Input
                type="number"
                min="2"
                max="20"
                value={editMaxParticipants}
                onChange={(e) => setEditMaxParticipants(e.target.value)}
                data-testid="edit-input-max-participants"
              />
            </div>
          )}

          {isSemiPrivate && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Participants ({participants?.length || 0}/{editMaxParticipants})
                </Label>
              </div>

              {participants && participants.length > 0 && (
                <div className="space-y-1">
                  {participants.map((p) => {
                    const isWalkIn = !!p.participantName;
                    const displayName = isWalkIn
                      ? p.participantName
                      : `${p.user?.firstName || ""} ${p.user?.lastName || ""}`.trim() || p.userId;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 border rounded-md px-3 py-1.5"
                        data-testid={`participant-row-${p.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm truncate">{displayName}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {isWalkIn ? "Walk-in" : "User"}
                          </Badge>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeParticipantMutation.mutate(p.id)}
                          disabled={removeParticipantMutation.isPending}
                          data-testid={`button-remove-participant-${p.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {(!participants || participants.length < (parseInt(editMaxParticipants) || 6)) && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowParticipantSearch(!showParticipantSearch)}
                    data-testid="button-toggle-add-participant"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add Participant
                  </Button>

                  {showParticipantSearch && (
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Search existing users</Label>
                        <Input
                          placeholder="Search by name or email..."
                          value={participantSearchQuery}
                          onChange={(e) => setParticipantSearchQuery(e.target.value)}
                          autoFocus
                          data-testid="input-search-participant"
                        />
                        {participantSearchResults && participantSearchResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {participantSearchResults.map((client) => {
                              const alreadyAdded = participants?.some(p => p.userId === client.id && !p.participantName);
                              return (
                                <button
                                  key={client.id}
                                  className="w-full text-left px-3 py-2 text-sm hover-elevate disabled:opacity-50"
                                  onClick={() => addParticipantMutation.mutate({ userId: client.id })}
                                  disabled={alreadyAdded || addParticipantMutation.isPending}
                                  data-testid={`button-add-user-participant-${client.id}`}
                                >
                                  {client.firstName} {client.lastName}
                                  {client.email && <span className="text-muted-foreground ml-1">({client.email})</span>}
                                  {alreadyAdded && <span className="text-muted-foreground ml-1"> - Already added</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {participantSearchQuery.length >= 2 && participantSearchResults && participantSearchResults.length === 0 && (
                          <p className="text-xs text-muted-foreground">No users found.</p>
                        )}
                      </div>

                      <div className="border-t pt-2 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Or add a walk-in</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Walk-in name..."
                            value={walkInName}
                            onChange={(e) => setWalkInName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && walkInName.trim()) {
                                addParticipantMutation.mutate({ participantName: walkInName.trim() });
                              }
                            }}
                            data-testid="input-walkin-name"
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (walkInName.trim()) {
                                addParticipantMutation.mutate({ participantName: walkInName.trim() });
                              }
                            }}
                            disabled={!walkInName.trim() || addParticipantMutation.isPending}
                            data-testid="button-add-walkin"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isSemiPrivate && (
            <div className="space-y-2">
              <Label>Client</Label>
              {selectedClientId ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm border rounded-md p-2">
                    {clientFirstName} {clientLastName}
                  </div>
                  <Button size="sm" variant="outline" onClick={clearSelectedClient} data-testid="edit-button-clear-client">
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="First name"
                        value={clientFirstName}
                        onChange={(e) => setClientFirstName(e.target.value)}
                        data-testid="edit-input-client-first-name"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="Last name"
                        value={clientLastName}
                        onChange={(e) => setClientLastName(e.target.value)}
                        data-testid="edit-input-client-last-name"
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSearch(!showSearch)}
                      className="w-full"
                      data-testid="edit-button-search-clients"
                    >
                      <Search className="h-3.5 w-3.5 mr-1" />
                      Search Existing Clients
                    </Button>
                    {showSearch && (
                      <div className="mt-2 space-y-2">
                        <Input
                          placeholder="Type to search..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          autoFocus
                          data-testid="edit-input-search-clients"
                        />
                        {searchResults && searchResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {searchResults.map((client) => (
                              <button
                                key={client.id}
                                className="w-full text-left px-3 py-2 text-sm hover-elevate"
                                onClick={() => selectClient(client)}
                                data-testid={`edit-button-select-client-${client.id}`}
                              >
                                {client.firstName} {client.lastName}
                                {client.email && <span className="text-muted-foreground ml-1">({client.email})</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {searchQuery.length >= 2 && searchResults && searchResults.length === 0 && (
                          <p className="text-xs text-muted-foreground">No clients found.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Date</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="edit-button-select-date">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarWidget
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => { setSelectedDate(date); setCalendarOpen(false); }}
                  data-testid="edit-calendar-date-picker"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select value={roundedStartTime} onValueChange={setStartTime}>
              <SelectTrigger data-testid="edit-select-time">
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {timeOptions.map((t) => {
                  const [h, m] = t.split(":").map(Number);
                  const d = new Date();
                  d.setHours(h, m);
                  return (
                    <SelectItem key={t} value={t}>
                      {format(d, "h:mm a")}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Location</Label>
            <Select value={location} onValueChange={(v) => { setLocation(v); if (v !== "__custom__") setCustomLocation(""); }}>
              <SelectTrigger data-testid="edit-select-location">
                <MapPin className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {orgLocations.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">
                  Other (enter manually)
                </SelectItem>
              </SelectContent>
            </Select>
            {location === "__custom__" && (
              <Input
                placeholder="Enter location..."
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                data-testid="edit-input-custom-location"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger data-testid="edit-select-payment-method">
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WALLET" data-testid="edit-payment-wallet">Wallet</SelectItem>
                <SelectItem value="VENMO" data-testid="edit-payment-venmo">Venmo</SelectItem>
                <SelectItem value="CASH" data-testid="edit-payment-cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Session notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
              data-testid="edit-input-notes"
            />
          </div>

          {booking.status === "COMPLETED" && (
            <div className="border-t pt-3">
              {isRedeemed ? (
                <Badge variant="secondary" className="w-full justify-center py-1.5 no-default-hover-elevate no-default-active-elevate">
                  Session Redeemed
                </Badge>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => redeemMutation.mutate()}
                  disabled={redeemMutation.isPending}
                  data-testid="button-redeem-session"
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  {redeemMutation.isPending ? "Redeeming..." : "Redeem Session"}
                </Button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteMutation.isPending || updateMutation.isPending}
              data-testid="button-delete-session"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const defaultEnd = selectedDate ? format(addDays(selectedDate, 56), "yyyy-MM-dd") : "";
                setCloneEndDate(defaultEnd);
                setShowCloneStep(true);
              }}
              disabled={updateMutation.isPending || deleteMutation.isPending}
              data-testid="button-open-clone"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={updateMutation.isPending || deleteMutation.isPending}
              data-testid="button-save-session"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
        </>
        )}
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={(v) => { setShowDeleteConfirm(v); if (!v) setDeleteMode("single"); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session</AlertDialogTitle>
            <AlertDialogDescription>
              {booking.recurringGroupId
                ? "This session is part of a recurring series. Would you like to delete just this session or all sessions in the series?"
                : "Are you sure you want to delete this session? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={booking.recurringGroupId ? "flex-col sm:flex-col gap-2" : ""}>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            {booking.recurringGroupId ? (
              <>
                <AlertDialogAction
                  onClick={() => { setDeleteMode("single"); deleteMutation.mutate("single"); }}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-delete-single"
                >
                  {deleteMutation.isPending && deleteMode === "single" ? "Deleting..." : "Delete This Session Only"}
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => { setDeleteMode("all"); deleteMutation.mutate("all"); }}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-delete-all-recurring"
                >
                  {deleteMutation.isPending && deleteMode === "all" ? "Deleting..." : "Delete All Recurring Sessions"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={() => deleteMutation.mutate("single")}
                className="bg-destructive text-destructive-foreground"
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
