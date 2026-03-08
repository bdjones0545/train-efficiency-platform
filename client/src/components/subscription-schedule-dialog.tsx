import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Search, XCircle } from "lucide-react";
import type { Service, OrganizationSubscriptionPlan, Organization } from "@shared/schema";

type ClientSearchResult = { id: string; firstName: string | null; lastName: string | null; email: string | null };

type SubscriptionScheduleDialogProps = {
  coachId?: string;
  triggerButton: React.ReactNode;
};

export function SubscriptionScheduleDialog({ coachId, triggerButton }: SubscriptionScheduleDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [subscriptionPlanId, setSubscriptionPlanId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [weeksToGenerate, setWeeksToGenerate] = useState("8");
  const [maxParticipants, setMaxParticipants] = useState("6");
  const [groupDescription, setGroupDescription] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [skillLevel, setSkillLevel] = useState("");
  const [sport, setSport] = useState("");

  const { data: profileData } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profileData?.organizationId;

  const { data: orgData } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });
  const orgLocations = orgData?.locations || [];

  const { data: plans } = useQuery<OrganizationSubscriptionPlan[]>({
    queryKey: ["/api/organizations", orgId, "subscription-plans"],
    enabled: !!orgId,
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/services?organizationId=${orgId}` : "/api/services";
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
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/coach/subscription-schedules", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      const msg = data.sessionsSkipped > 0
        ? `Schedule created! ${data.sessionsCreated} sessions scheduled, ${data.sessionsSkipped} skipped (conflicts).`
        : `Schedule created! ${data.sessionsCreated} sessions scheduled.`;
      toast({ title: "Subscription Schedule Created", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/subscription-schedules"] });
      resetForm();
      setOpen(false);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSubscriptionPlanId("");
    setSelectedClientId(null);
    setSelectedClientName("");
    setSearchQuery("");
    setShowSearch(false);
    setServiceId("");
    setSelectedDays([]);
    setStartTime("09:00");
    setLocation("");
    setCustomLocation("");
    setNotes("");
    setWeeksToGenerate("8");
    setMaxParticipants("6");
    setGroupDescription("");
    setAgeRange("");
    setSkillLevel("");
    setSport("");
  };

  const handleSubmit = () => {
    if (!subscriptionPlanId) {
      toast({ title: "Missing Plan", description: "Please select a subscription plan.", variant: "destructive" });
      return;
    }
    if (!selectedClientId) {
      toast({ title: "Missing Client", description: "Please search and select a client.", variant: "destructive" });
      return;
    }
    if (!serviceId) {
      toast({ title: "Missing Service", description: "Please select a service type.", variant: "destructive" });
      return;
    }
    if (selectedDays.length === 0) {
      toast({ title: "Missing Days", description: "Please select at least one day of the week.", variant: "destructive" });
      return;
    }

    const finalLocation = location === "__custom__" ? customLocation.trim() : location;
    const isGroup = selectedService?.sessionType === "GROUP" || selectedPlan?.sessionType === "group";

    createMutation.mutate({
      subscriptionPlanId,
      clientId: selectedClientId,
      serviceId,
      daysOfWeek: selectedDays,
      startTime,
      location: finalLocation,
      notes,
      weeksToGenerate: parseInt(weeksToGenerate) || 8,
      ...(coachId ? { coachId } : {}),
      ...(isGroup ? {
        maxParticipants: parseInt(maxParticipants) || 6,
        groupDescription,
        ageRange,
        skillLevel: skillLevel === "none" ? "" : skillLevel,
        sport,
      } : {}),
    });
  };

  const selectClient = (client: ClientSearchResult) => {
    setSelectedClientId(client.id);
    setSelectedClientName(`${client.firstName || ""} ${client.lastName || ""}`.trim());
    setShowSearch(false);
    setSearchQuery("");
  };

  const clearClient = () => {
    setSelectedClientId(null);
    setSelectedClientName("");
  };

  const timeOptions: string[] = [];
  for (let h = 5; h < 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }

  const selectedPlan = plans?.find(p => p.id === subscriptionPlanId);
  const selectedService = services?.find(s => s.id === serviceId);

  const dayLabels = [
    { label: "Sun", value: 0 },
    { label: "Mon", value: 1 },
    { label: "Tue", value: 2 },
    { label: "Wed", value: 3 },
    { label: "Thu", value: 4 },
    { label: "Fri", value: 5 },
    { label: "Sat", value: 6 },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {triggerButton}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Subscription Sessions</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm text-muted-foreground">
              Create a recurring schedule for a subscription client. Sessions will be auto-generated on the selected days.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Subscription Plan</Label>
            <Select value={subscriptionPlanId} onValueChange={setSubscriptionPlanId}>
              <SelectTrigger data-testid="select-subscription-plan">
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans?.filter(p => p.active).map((p) => (
                  <SelectItem key={p.id} value={p.id} data-testid={`option-plan-${p.id}`}>
                    {p.name} — ${(p.amountCents / 100).toFixed(2)}/{p.interval}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPlan && (
              <p className="text-xs text-muted-foreground">{selectedPlan.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Client</Label>
            {selectedClientId ? (
              <div className="flex items-center gap-2 border rounded-md px-3 py-2">
                <span className="text-sm flex-1" data-testid="text-selected-client">{selectedClientName}</span>
                <Button size="icon" variant="ghost" onClick={clearClient} data-testid="button-clear-client">
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients by name..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); }}
                    className="pl-9"
                    data-testid="input-client-search"
                  />
                </div>
                {showSearch && searchResults && searchResults.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {searchResults.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
                        onClick={() => selectClient(client)}
                        data-testid={`option-client-${client.id}`}
                      >
                        <span className="font-medium">{client.firstName} {client.lastName}</span>
                        {client.email && (
                          <span className="text-xs text-muted-foreground ml-2">{client.email}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger data-testid="select-subscription-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {services?.filter(s => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`option-sub-service-${s.id}`}>
                    {s.name} ({s.durationMin} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(selectedService?.sessionType === "GROUP" || selectedPlan?.sessionType === "group") && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Group / Semi-Private Settings</p>
              <p className="text-xs text-muted-foreground">
                These sessions will appear on Open Sessions for other clients to join.
              </p>
              <div className="space-y-2">
                <Label>Max Participants</Label>
                <Select value={maxParticipants} onValueChange={setMaxParticipants}>
                  <SelectTrigger data-testid="select-sub-max-participants">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2,3,4,5,6,8,10,12,15,20,25,30].map(n => (
                      <SelectItem key={n} value={String(n)}>{n} participants</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Session Description</Label>
                <Textarea
                  placeholder="Describe the group session (visible to clients)..."
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  className="resize-none"
                  data-testid="input-sub-group-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Sport</Label>
                  <Input
                    placeholder="e.g. Football"
                    value={sport}
                    onChange={(e) => setSport(e.target.value)}
                    data-testid="input-sub-sport"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Age Range</Label>
                  <Input
                    placeholder="e.g. 14-18"
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                    data-testid="input-sub-age-range"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Skill Level</Label>
                <Select value={skillLevel} onValueChange={setSkillLevel}>
                  <SelectTrigger data-testid="select-sub-skill-level">
                    <SelectValue placeholder="Select skill level (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any level</SelectItem>
                    <SelectItem value="Beginner">Beginner</SelectItem>
                    <SelectItem value="Intermediate">Intermediate</SelectItem>
                    <SelectItem value="Advanced">Advanced</SelectItem>
                    <SelectItem value="Elite">Elite</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Training Days</Label>
            <div className="flex flex-wrap gap-2" data-testid="subscription-day-selector">
              {dayLabels.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  data-testid={`sub-day-toggle-${day.label.toLowerCase()}`}
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
            {selectedDays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Sessions on {selectedDays.map(d => dayLabels[d].label).join(", ")} each week
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select value={startTime} onValueChange={setStartTime}>
              <SelectTrigger data-testid="select-subscription-time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeOptions.map((t) => {
                  const [h, m] = t.split(":").map(Number);
                  const ampm = h >= 12 ? "PM" : "AM";
                  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  return (
                    <SelectItem key={t} value={t}>
                      {displayH}:{String(m).padStart(2, "0")} {ampm}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Location</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger data-testid="select-subscription-location">
                <SelectValue placeholder="Select location (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No location</SelectItem>
                {orgLocations.map((loc: string) => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
                <SelectItem value="__custom__">Custom location...</SelectItem>
              </SelectContent>
            </Select>
            {location === "__custom__" && (
              <Input
                placeholder="Enter custom location"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                data-testid="input-custom-location"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Weeks to Schedule</Label>
            <Select value={weeksToGenerate} onValueChange={setWeeksToGenerate}>
              <SelectTrigger data-testid="select-weeks-to-generate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 weeks</SelectItem>
                <SelectItem value="8">8 weeks</SelectItem>
                <SelectItem value="12">12 weeks</SelectItem>
                <SelectItem value="16">16 weeks</SelectItem>
                <SelectItem value="26">26 weeks (6 months)</SelectItem>
                <SelectItem value="52">52 weeks (1 year)</SelectItem>
              </SelectContent>
            </Select>
            {selectedDays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                This will create up to {selectedDays.length * parseInt(weeksToGenerate || "8")} sessions total
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Session notes for every generated session..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
              data-testid="input-subscription-notes"
            />
          </div>

          {selectedPlan && selectedClientId && serviceId && selectedDays.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-sm font-medium">Schedule Summary</p>
              <p className="text-xs text-muted-foreground">
                <strong>Plan:</strong> {selectedPlan.name}
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>Client:</strong> {selectedClientName}
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>Service:</strong> {selectedService?.name} ({selectedService?.durationMin} min)
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>Days:</strong> {selectedDays.map(d => dayLabels[d].label).join(", ")} at{" "}
                {(() => {
                  const [h, m] = startTime.split(":").map(Number);
                  const ampm = h >= 12 ? "PM" : "AM";
                  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  return `${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
                })()}
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>Duration:</strong> {weeksToGenerate} weeks ({selectedDays.length * parseInt(weeksToGenerate || "8")} sessions max)
              </p>
              {(selectedService?.sessionType === "GROUP" || selectedPlan?.sessionType === "group") && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <strong>Group:</strong> Up to {maxParticipants} participants — visible on Open Sessions
                </p>
              )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            data-testid="button-create-subscription-schedule"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${createMutation.isPending ? "animate-spin" : ""}`} />
            {createMutation.isPending ? "Creating Schedule..." : "Create Recurring Schedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
