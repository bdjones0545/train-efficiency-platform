import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Badge } from "@/components/ui/badge";
import { Plus, CalendarIcon, Search, XCircle, MapPin, UserPlus, Trash2, Copy } from "lucide-react";
import { format, addDays } from "date-fns";
import type { Service, TeamQuote } from "@shared/schema";

const PRESET_LOCATIONS = [
  "Bluffton High School",
  "Oscar Frazier Park (Bluffton, SC)",
  "PickUp USA Fitness (Bluffton, SC)",
  "Sweet Grass Fitness (Beaufort, SC)",
  "Coursen Tate Park (Beaufort, SC)",
  "Robert Smalls International Academy (Burton, SC)",
  "Humidity Fitness (Beaufort, SC)",
  "Dataw Island Community Center (St. Helena, SC)",
  "Spring Island Sports Complex (Okatie, SC)",
];

type ClientSearchResult = { id: string; firstName: string | null; lastName: string | null; email: string | null };

type ParticipantEntry = {
  type: "user" | "walkin";
  userId?: string;
  displayName: string;
};

type AddSessionDialogProps = {
  initialDate?: Date;
  initialTime?: string;
  triggerButton?: React.ReactNode;
  coachId?: string;
};

export function AddSessionDialog({ initialDate, initialTime, triggerButton, coachId }: AddSessionDialogProps = {}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(initialDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [startTime, setStartTime] = useState(initialTime || "09:00");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [skillLevel, setSkillLevel] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("6");
  const [participants, setParticipants] = useState<ParticipantEntry[]>([]);
  const [participantSearchQuery, setParticipantSearchQuery] = useState("");
  const [walkinName, setWalkinName] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showRepeatStep, setShowRepeatStep] = useState(false);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [repeatInterval, setRepeatInterval] = useState<string>("7");
  const [repeatEndDate, setRepeatEndDate] = useState<string>("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [teamQuoteProgramId, setTeamQuoteProgramId] = useState<string>("");

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (initialTime) setStartTime(initialTime);
  }, [initialTime]);

  const { data: services } = useQuery<Service[]>({ queryKey: ["/api/services"] });

  const { data: teamContracts } = useQuery<TeamQuote[]>({
    queryKey: ["/api/coach/team-contracts"],
    queryFn: async () => {
      const res = await fetch("/api/coach/team-contracts", { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: searchResults } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const { data: participantSearchResults } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", participantSearchQuery],
    queryFn: async () => {
      if (participantSearchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(participantSearchQuery)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: participantSearchQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/coach/bookings", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Session Scheduled", description: "The session has been added to your bookings." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      setCreatedBookingId(data.id);
      const defaultEnd = selectedDate ? format(addDays(selectedDate, 56), "yyyy-MM-dd") : "";
      setRepeatEndDate(defaultEnd);
      setShowRepeatStep(true);
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
      if (!createdBookingId || !repeatEndDate) throw new Error("Missing data");
      const body: any = {
        bookingId: createdBookingId,
        endDate: repeatEndDate,
      };
      if (repeatInterval === "custom") {
        body.daysOfWeek = selectedDays;
      } else {
        body.intervalDays = parseInt(repeatInterval);
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
      resetForm();
      setShowRepeatStep(false);
      setCreatedBookingId(null);
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const selectedServiceObj = services?.find(s => s.id === serviceId);
  const isSemiPrivate = selectedServiceObj?.name.toLowerCase().includes("semi-private") || false;
  const isTeamTraining = selectedServiceObj?.name.toLowerCase().includes("team training") || false;
  const resolvedLoc = location === "__custom__" ? customLocation.trim() : location;
  const isTeamBHS = isTeamTraining && resolvedLoc.toLowerCase().includes("bluffton high");

  const resetForm = () => {
    setSelectedDate(initialDate);
    setServiceId("");
    setStartTime(initialTime || "09:00");
    setClientFirstName("");
    setClientLastName("");
    setSelectedClientId(null);
    setSearchQuery("");
    setNotes("");
    setLocation("");
    setCustomLocation("");
    setGroupDescription("");
    setAgeRange("");
    setSkillLevel("");
    setMaxParticipants("6");
    setParticipants([]);
    setParticipantSearchQuery("");
    setWalkinName("");
    setShowSearch(false);
    setShowRepeatStep(false);
    setCreatedBookingId(null);
    setRepeatInterval("7");
    setRepeatEndDate("");
    setSelectedDays([]);
    setTeamQuoteProgramId("");
  };

  const handleSubmit = () => {
    if (!selectedDate || !serviceId || !startTime) {
      toast({ title: "Missing Fields", description: "Please fill in date, time, and service.", variant: "destructive" });
      return;
    }
    const hasTeamContract = isTeamTraining && teamQuoteProgramId && teamQuoteProgramId !== "none";
    if (!isSemiPrivate && !isTeamBHS && !hasTeamContract && !selectedClientId && (!clientFirstName.trim() || !clientLastName.trim())) {
      toast({ title: "Missing Client", description: "Please enter or select a client.", variant: "destructive" });
      return;
    }
    if (isSemiPrivate && !groupDescription.trim()) {
      toast({ title: "Missing Group Info", description: "Please describe the group training in this session.", variant: "destructive" });
      return;
    }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);

    const finalLocation = location === "__custom__" ? customLocation.trim() : location;
    const body: any = { serviceId, startAt: startAt.toISOString(), notes, location: finalLocation };
    if (coachId) {
      body.coachId = coachId;
    }
    if (isTeamTraining && teamQuoteProgramId && teamQuoteProgramId !== "none") {
      body.teamQuoteProgramId = teamQuoteProgramId;
      const contract = teamContracts?.find(c => (c.programId || c.id) === teamQuoteProgramId);
      body.clientFirstName = contract?.teamName || "Team";
      body.clientLastName = "Training";
      if (groupDescription.trim()) {
        body.groupDescription = groupDescription.trim();
      }
    } else if (isTeamBHS) {
      body.isTeamContract = true;
      body.clientFirstName = "Bluffton HS";
      body.clientLastName = "Team Training";
      if (groupDescription.trim()) {
        body.groupDescription = groupDescription.trim();
      }
    } else if (isSemiPrivate) {
      body.maxParticipants = parseInt(maxParticipants) || 6;
      body.groupDescription = groupDescription.trim();
      body.ageRange = ageRange.trim();
      body.skillLevel = skillLevel;
      if (participants.length > 0) {
        body.participants = participants.map(p => ({
          type: p.type,
          userId: p.userId,
          displayName: p.displayName,
        }));
      }
    }
    if (!isTeamBHS && selectedClientId) {
      body.clientId = selectedClientId;
    } else if (!isTeamBHS && clientFirstName.trim() && clientLastName.trim()) {
      body.clientFirstName = clientFirstName.trim();
      body.clientLastName = clientLastName.trim();
    }
    createMutation.mutate(body);
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

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button data-testid="button-add-session">
            <Plus className="h-4 w-4 mr-1" />
            Add Session
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {showRepeatStep ? (
          <>
            <DialogHeader>
              <DialogTitle>Repeat This Session?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-medium">Session created successfully!</p>
                <p className="text-xs text-muted-foreground mt-1">Would you like to repeat this session on future dates?</p>
              </div>

              <div className="space-y-2">
                <Label>Repeat Every</Label>
                <Select value={repeatInterval} onValueChange={(v) => { setRepeatInterval(v); if (v !== "custom") setSelectedDays([]); }}>
                  <SelectTrigger data-testid="select-repeat-interval">
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

              {repeatInterval === "custom" && (
                <div className="space-y-2">
                  <Label>Select Days</Label>
                  <div className="flex flex-wrap gap-2" data-testid="day-of-week-selector">
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
                        data-testid={`day-toggle-${day.label.toLowerCase()}`}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          selectedDays.includes(day.value)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-accent"
                        }`}
                        onClick={() => {
                          setSelectedDays((prev) =>
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
                  value={repeatEndDate}
                  onChange={(e) => setRepeatEndDate(e.target.value)}
                  data-testid="input-repeat-end-date"
                />
              </div>

              {repeatEndDate && selectedDate && (
                <p className="text-xs text-muted-foreground">
                  {repeatInterval === "custom"
                    ? `This will create sessions on ${selectedDays.map(d => ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"][d]).join(", ") || "selected days"}`
                    : `This will create sessions ${repeatInterval === "1" ? "daily" : repeatInterval === "7" ? "weekly" : "every 2 weeks"}`
                  } from{" "}
                  {repeatInterval === "custom"
                    ? format(addDays(selectedDate, 1), "MMM d, yyyy")
                    : format(addDays(selectedDate, parseInt(repeatInterval)), "MMM d, yyyy")
                  } through {format(new Date(repeatEndDate + "T12:00:00"), "MMM d, yyyy")}.
                  Conflicting time slots will be skipped.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { resetForm(); setOpen(false); }}
                  data-testid="button-skip-repeat"
                >
                  No Thanks
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => cloneMutation.mutate()}
                  disabled={!repeatEndDate || cloneMutation.isPending || (repeatInterval === "custom" && selectedDays.length === 0)}
                  data-testid="button-clone-sessions"
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
          <DialogTitle>Schedule a Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger data-testid="select-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {services?.filter(s => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`option-service-${s.id}`}>
                    {s.name} ({s.durationMin} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isSemiPrivate && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Group Description</Label>
                <Textarea
                  placeholder="Describe the group training, e.g. 'High school football speed training' or 'Basketball agility group'"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  className="resize-none"
                  data-testid="input-group-description"
                />
                <p className="text-xs text-muted-foreground">This will be shown to athletes who can register for this session.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Age Range</Label>
                  <Input
                    placeholder="e.g. 14-18, All Ages"
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                    data-testid="input-age-range"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Skill Level</Label>
                  <Select value={skillLevel} onValueChange={setSkillLevel}>
                    <SelectTrigger data-testid="select-skill-level">
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
              <div className="space-y-2">
                <Label>Max Participants</Label>
                <Input
                  type="number"
                  min="2"
                  max="20"
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(e.target.value)}
                  data-testid="input-max-participants"
                />
              </div>
              <div className="space-y-2">
                <Label>Participants ({participants.length}/{maxParticipants})</Label>
                {participants.length > 0 && (
                  <div className="space-y-1.5">
                    {participants.map((p, index) => (
                      <div key={index} className="flex items-center gap-2 border rounded-md px-3 py-1.5" data-testid={`participant-entry-${index}`}>
                        <Badge variant={p.type === "user" ? "default" : "secondary"} className="text-[10px] shrink-0">
                          {p.type === "user" ? "User" : "Walk-in"}
                        </Badge>
                        <span className="text-sm flex-1 truncate">{p.displayName}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setParticipants(participants.filter((_, i) => i !== index))}
                          data-testid={`button-remove-participant-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {participants.length < (parseInt(maxParticipants) || 6) && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search users to add..."
                        value={participantSearchQuery}
                        onChange={(e) => setParticipantSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-participant-search"
                      />
                    </div>
                    {participantSearchResults && participantSearchResults.length > 0 && participantSearchQuery.length >= 2 && (
                      <div className="border rounded-md max-h-32 overflow-y-auto">
                        {participantSearchResults
                          .filter(u => !participants.some(p => p.userId === u.id))
                          .map((user) => (
                          <button
                            key={user.id}
                            className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2"
                            onClick={() => {
                              const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
                              setParticipants([...participants, { type: "user", userId: user.id, displayName: name || user.email || "User" }]);
                              setParticipantSearchQuery("");
                            }}
                            data-testid={`button-add-user-${user.id}`}
                          >
                            <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>{user.firstName} {user.lastName}</span>
                            {user.email && <span className="text-xs text-muted-foreground ml-auto">{user.email}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {participantSearchQuery.length >= 2 && participantSearchResults && participantSearchResults.filter(u => !participants.some(p => p.userId === u.id)).length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-1">No matching users found</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Or type a walk-in name..."
                        value={walkinName}
                        onChange={(e) => setWalkinName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && walkinName.trim() && participants.length < (parseInt(maxParticipants) || 6)) {
                            e.preventDefault();
                            setParticipants([...participants, { type: "walkin", displayName: walkinName.trim() }]);
                            setWalkinName("");
                          }
                        }}
                        data-testid="input-walkin-name"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!walkinName.trim() || participants.length >= 6}
                        onClick={() => {
                          if (walkinName.trim()) {
                            setParticipants([...participants, { type: "walkin", displayName: walkinName.trim() }]);
                            setWalkinName("");
                          }
                        }}
                        data-testid="button-add-walkin"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Search for existing users or type walk-in names. Others can also join later from the Open Sessions page.</p>
              </div>
            </div>
          )}

          {isTeamTraining && (
            <div className="space-y-3">
              {teamContracts && teamContracts.length > 0 && (
                <div className="space-y-2">
                  <Label>Team Contract</Label>
                  <Select value={teamQuoteProgramId} onValueChange={setTeamQuoteProgramId}>
                    <SelectTrigger data-testid="select-team-contract">
                      <SelectValue placeholder="Select a paid team contract" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No contract (manual)</SelectItem>
                      {teamContracts.map((contract) => {
                        const monthlyCost = (contract.totalCents / 100).toFixed(2);
                        return (
                          <SelectItem key={contract.programId || contract.id} value={contract.programId || contract.id} data-testid={`option-contract-${contract.programId || contract.id}`}>
                            {contract.teamName} — ${monthlyCost}/mo ({contract.numberOfAthletes} athletes, {contract.frequency})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {teamQuoteProgramId && teamQuoteProgramId !== "none" ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-medium">Paid Team Contract Session</p>
                  {(() => {
                    const contract = teamContracts?.find(c => (c.programId || c.id) === teamQuoteProgramId);
                    if (!contract) return null;
                    const freq = contract.frequency;
                    const sessionsPerMonth = parseInt(freq) * 4.33;
                    const perSessionCents = Math.round(contract.totalCents / sessionsPerMonth);
                    const coachPayout = (perSessionCents * 0.5 / 100).toFixed(2);
                    return (
                      <p className="text-xs text-muted-foreground mt-1">
                        ~${coachPayout} coach payout per session (50% of ${(perSessionCents / 100).toFixed(2)}/session)
                      </p>
                    );
                  })()}
                </div>
              ) : isTeamBHS ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-medium">BHS Team Training Contract</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedServiceObj?.durationMin && selectedServiceObj.durationMin <= 30
                      ? "$10 coach payout per session. No client charge."
                      : "$20 coach payout per session. No client charge."}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Team / Notes (optional)</Label>
                <Textarea
                  placeholder="e.g. Varsity Football, JV Basketball..."
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  className="resize-none"
                  data-testid="input-team-description"
                />
              </div>
            </div>
          )}

          {!isSemiPrivate && !isTeamBHS && !(isTeamTraining && teamQuoteProgramId && teamQuoteProgramId !== "none") && (
            <div className="space-y-2">
              <Label>Client</Label>
              {selectedClientId ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm border rounded-md p-2">
                    {clientFirstName} {clientLastName}
                  </div>
                  <Button size="sm" variant="outline" onClick={clearSelectedClient} data-testid="button-clear-client">
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
                        data-testid="input-client-first-name"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="Last name"
                        value={clientLastName}
                        onChange={(e) => setClientLastName(e.target.value)}
                        data-testid="input-client-last-name"
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSearch(!showSearch)}
                      className="w-full"
                      data-testid="button-search-clients"
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
                          data-testid="input-search-clients"
                        />
                        {searchResults && searchResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {searchResults.map((client) => (
                              <button
                                key={client.id}
                                className="w-full text-left px-3 py-2 text-sm hover-elevate"
                                onClick={() => selectClient(client)}
                                data-testid={`button-select-client-${client.id}`}
                              >
                                {client.firstName} {client.lastName}
                                {client.email && <span className="text-muted-foreground ml-1">({client.email})</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {searchQuery.length >= 2 && searchResults && searchResults.length === 0 && (
                          <p className="text-xs text-muted-foreground">No clients found. Enter a name above to create a new client.</p>
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
                <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="button-select-date">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarWidget
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => { setSelectedDate(date); setCalendarOpen(false); }}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  data-testid="calendar-date-picker"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select value={startTime} onValueChange={setStartTime}>
              <SelectTrigger data-testid="select-time">
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
              <SelectTrigger data-testid="select-location">
                <MapPin className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {PRESET_LOCATIONS.map((loc) => (
                  <SelectItem key={loc} value={loc} data-testid={`option-location-${loc.replace(/\s+/g, '-').toLowerCase()}`}>
                    {loc}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__" data-testid="option-location-custom">
                  Other (enter manually)
                </SelectItem>
              </SelectContent>
            </Select>
            {location === "__custom__" && (
              <Input
                placeholder="Enter location..."
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                data-testid="input-custom-location"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Session notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
              data-testid="input-notes"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            data-testid="button-submit-session"
          >
            {createMutation.isPending ? "Scheduling..." : "Schedule Session"}
          </Button>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
