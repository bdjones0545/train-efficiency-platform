import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarIcon, Search, XCircle, MapPin,
  CheckCircle2, AlertCircle, AlertTriangle, Clock,
} from "lucide-react";
import { format } from "date-fns";
import type { Service } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";

type ClientSearchResult = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

type LocationEntry = { id: string; name: string };

export type ScheduleFormData = {
  serviceId: string;
  clientId: string | null;
  clientFirstName?: string;
  clientLastName?: string;
  coachId: string;
  startAt: Date;
  endAt: Date;
  location: string;
  notes: string;
};

type AvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "coach_conflict"
  | "client_conflict"
  | "outside_availability"
  | "locked_session"
  | "unknown";

type SuggestionSlot = {
  startTime: string;
  endTime: string;
  coachId: string;
  coachName: string;
  reason: string;
};

type CreditsInfo = {
  hasActiveSubscription: boolean;
  sessionsRemaining: number | null;
  willConsumeCredit: boolean;
  insufficient: boolean;
  planName?: string;
};

type Props = {
  services: Service[];
  coaches: CoachWithUser[];
  locations: LocationEntry[];
  defaultClientId?: string;
  defaultClientFirstName?: string;
  defaultClientLastName?: string;
  defaultCoachId?: string;
  defaultDate?: Date;
  defaultServiceId?: string;
  defaultLocation?: string;
  defaultNotes?: string;
  defaultStartTime?: string;
  excludeBookingId?: string;
  submitLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  showCoachSelector?: boolean;
  allowConflictOverride?: boolean;
  onSubmit: (data: ScheduleFormData) => void;
  onCancel?: () => void;
  onValidationError?: (message: string) => void;
};

const TIME_OPTIONS: string[] = [];
for (let h = 5; h < 22; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function deriveEndTime(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const totalMin = h * 60 + m + durationMin;
  const endH = Math.floor(totalMin / 60);
  const endM = totalMin % 60;
  const d = new Date();
  d.setHours(endH, endM);
  return format(d, "h:mm a");
}

const STATUS_STYLES: Record<string, string> = {
  checking: "bg-muted/40 text-muted-foreground border border-border",
  available: "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400",
  coach_conflict: "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
  client_conflict: "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
  locked_session: "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
  outside_availability: "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",
  unknown: "bg-muted/40 text-muted-foreground border border-border",
};

export function ScheduleSessionForm({
  services,
  coaches,
  locations,
  defaultClientId,
  defaultClientFirstName = "",
  defaultClientLastName = "",
  defaultCoachId = "",
  defaultDate,
  defaultServiceId = "",
  defaultLocation = "",
  defaultNotes = "",
  defaultStartTime = "09:00",
  excludeBookingId,
  submitLabel = "Schedule Session",
  cancelLabel = "Cancel",
  isSubmitting = false,
  showCoachSelector = true,
  allowConflictOverride = false,
  onSubmit,
  onCancel,
  onValidationError,
}: Props) {
  const [serviceId, setServiceId] = useState(defaultServiceId);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(defaultDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [clientId, setClientId] = useState<string | null>(defaultClientId ?? null);
  const [clientFirstName, setClientFirstName] = useState(defaultClientFirstName);
  const [clientLastName, setClientLastName] = useState(defaultClientLastName);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [coachId, setCoachId] = useState(defaultCoachId || (coaches.length === 1 ? coaches[0].id : ""));
  const [location, setLocation] = useState(defaultLocation);
  const [notes, setNotes] = useState(defaultNotes);

  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>("idle");
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionSlot[]>([]);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: searchResults = [] } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const selectedService = services.find(s => s.id === serviceId);
  const durationMin = selectedService?.durationMin ?? 60;
  const price = (selectedService as any)?.price;
  const sessionCredits = (selectedService as any)?.sessionCredits;
  const resolvedCoachId = coachId || (coaches.length === 1 ? coaches[0].id : "");

  useEffect(() => {
    const hasRequired = serviceId && clientId && selectedDate && startTime && (!showCoachSelector || resolvedCoachId);
    if (!hasRequired) {
      setAvailabilityStatus("idle");
      setSuggestions([]);
      return;
    }

    setAvailabilityStatus("checking");
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);

    availabilityTimer.current = setTimeout(async () => {
      try {
        const [hours, minutes] = startTime.split(":").map(Number);
        const startAt = new Date(selectedDate!);
        startAt.setHours(hours, minutes, 0, 0);
        const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

        const params = new URLSearchParams({
          clientId: clientId!,
          serviceId,
          startTime: startAt.toISOString(),
          endTime: endAt.toISOString(),
        });
        if (resolvedCoachId) params.set("coachId", resolvedCoachId);
        if (excludeBookingId) params.set("excludeBookingId", excludeBookingId);

        const res = await fetch(`/api/scheduling-intelligence/check-availability?${params}`, {
          credentials: "include",
        });
        if (!res.ok) {
          setAvailabilityStatus("unknown");
          setAvailabilityMessage("Could not check availability.");
          return;
        }
        const data = await res.json();
        setAvailabilityStatus(data.status ?? "unknown");
        setAvailabilityMessage(data.message ?? "");
        setSuggestions(data.suggestions ?? []);
        setCredits(data.credits ?? null);
      } catch {
        setAvailabilityStatus("unknown");
        setAvailabilityMessage("Could not check availability.");
      }
    }, 600);

    return () => {
      if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
    };
  }, [serviceId, clientId, selectedDate, startTime, resolvedCoachId, durationMin, excludeBookingId, showCoachSelector]);

  const applySuggestion = (s: SuggestionSlot) => {
    const d = new Date(s.startTime);
    setSelectedDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    setStartTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    if (s.coachId && s.coachId !== resolvedCoachId) setCoachId(s.coachId);
  };

  const handleSelectClient = (client: ClientSearchResult) => {
    setClientId(client.id);
    setClientFirstName(client.firstName || "");
    setClientLastName(client.lastName || "");
    setShowSearch(false);
    setSearchQuery("");
  };

  const handleClearClient = () => {
    setClientId(null);
    setClientFirstName("");
    setClientLastName("");
    setAvailabilityStatus("idle");
    setCredits(null);
  };

  const isHardConflict = !allowConflictOverride && (
    availabilityStatus === "coach_conflict" ||
    availabilityStatus === "client_conflict" ||
    availabilityStatus === "locked_session"
  );

  const handleSubmit = () => {
    const notify = onValidationError ?? (() => {});
    if (!serviceId) { notify("Please select a service."); return; }
    if (!clientId) { notify("Please select a client."); return; }
    if (!selectedDate) { notify("Please pick a date."); return; }
    if (!startTime) { notify("Please select a start time."); return; }
    if (showCoachSelector && !resolvedCoachId) { notify("Please select a coach."); return; }
    if (isHardConflict) { notify("Resolve the scheduling conflict before saving."); return; }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);
    const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

    onSubmit({
      serviceId,
      clientId,
      clientFirstName,
      clientLastName,
      coachId: resolvedCoachId,
      startAt,
      endAt,
      location: location !== "__none__" ? location : "",
      notes,
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Service */}
      <div className="space-y-1.5">
        <Label>Service *</Label>
        <Select value={serviceId} onValueChange={setServiceId}>
          <SelectTrigger data-testid="ssf-select-service">
            <SelectValue placeholder="Select a service" />
          </SelectTrigger>
          <SelectContent>
            {services
              .filter(s => s.active && (s as any).isBookableByCoach !== false)
              .map(s => (
                <SelectItem key={s.id} value={s.id} data-testid={`ssf-option-service-${s.id}`}>
                  {s.name}
                  {s.durationMin ? ` · ${s.durationMin} min` : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {selectedService && (
          <p className="text-xs text-muted-foreground px-1" data-testid="ssf-service-summary">
            {selectedService.durationMin
              ? `${selectedService.durationMin} min`
              : <span className="text-amber-600 dark:text-amber-400">60 min (default)</span>
            }
            {price ? ` · $${(price / 100).toFixed(0)}` : ""}
            {sessionCredits ? ` · Uses ${sessionCredits} credit${sessionCredits !== 1 ? "s" : ""}` : ""}
          </p>
        )}
      </div>

      {/* 2. Client */}
      <div className="space-y-1.5">
        <Label>Client *</Label>
        {clientId ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 text-sm border rounded-md p-2 bg-muted/30" data-testid="ssf-selected-client">
              {clientFirstName} {clientLastName}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearClient}
              data-testid="ssf-button-clear-client"
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSearch(!showSearch)}
              className="w-full justify-start"
              data-testid="ssf-button-search-clients"
            >
              <Search className="h-3.5 w-3.5 mr-2" />
              Search clients...
            </Button>
            {showSearch && (
              <div className="space-y-2">
                <Input
                  placeholder="Type a name or email..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoFocus
                  data-testid="ssf-input-search-clients"
                />
                {searchResults.length > 0 && (
                  <div className="border rounded-md max-h-36 overflow-y-auto">
                    {searchResults.map(client => (
                      <button
                        key={client.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
                        onClick={() => handleSelectClient(client)}
                        data-testid={`ssf-button-select-client-${client.id}`}
                      >
                        <span className="font-medium">{client.firstName} {client.lastName}</span>
                        {client.email && (
                          <span className="text-muted-foreground ml-2 text-xs">{client.email}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className="text-xs text-muted-foreground">No clients found for "{searchQuery}".</p>
                )}
              </div>
            )}
          </div>
        )}
        {/* Client credit visibility — shown once both client + service are selected */}
        {clientId && serviceId && credits !== null && (
          <p
            className={`text-xs px-1 ${credits.insufficient ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="ssf-credits-info"
          >
            {credits.hasActiveSubscription
              ? credits.sessionsRemaining !== null
                ? `${clientFirstName || "Client"} has ${credits.sessionsRemaining} session credit${credits.sessionsRemaining !== 1 ? "s" : ""} remaining.${credits.sessionsRemaining > 0 ? " This booking uses 1 credit." : " No credits — coach may book as unpaid."}`
                : `${clientFirstName || "Client"} has an active ${credits.planName || "subscription"}.`
              : `No active subscription found for ${clientFirstName || "this client"}.`}
          </p>
        )}
      </div>

      {/* 3. Date */}
      <div className="space-y-1.5">
        <Label>Date *</Label>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start text-left font-normal"
              data-testid="ssf-button-select-date"
            >
              <CalendarIcon className="h-4 w-4 mr-2" />
              {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarWidget
              mode="single"
              selected={selectedDate}
              onSelect={date => { setSelectedDate(date); setCalendarOpen(false); }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* 4. Start Time */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Start Time *</Label>
          {startTime && (
            <span className="text-xs text-muted-foreground" data-testid="ssf-text-end-time">
              ends {deriveEndTime(startTime, durationMin)} · {durationMin} min
              {!selectedService?.durationMin && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">(default)</span>
              )}
            </span>
          )}
        </div>
        <Select value={startTime} onValueChange={setStartTime}>
          <SelectTrigger data-testid="ssf-select-time">
            <SelectValue placeholder="Select time" />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {TIME_OPTIONS.map(t => {
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

      {/* Availability Status Banner — shown after all required fields are filled */}
      {availabilityStatus !== "idle" && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${STATUS_STYLES[availabilityStatus] ?? STATUS_STYLES.unknown}`}
          data-testid="ssf-availability-status"
          data-status={availabilityStatus}
        >
          <div className="flex items-start gap-2">
            {availabilityStatus === "checking" && (
              <span className="text-[10px] tracking-widest animate-pulse mt-0.5">●●●</span>
            )}
            {availabilityStatus === "available" && (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            {(availabilityStatus === "coach_conflict" ||
              availabilityStatus === "client_conflict" ||
              availabilityStatus === "locked_session") && (
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            {availabilityStatus === "outside_availability" && (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>
              {availabilityStatus === "checking"
                ? "Checking availability…"
                : availabilityMessage}
            </span>
          </div>

          {/* Suggestion chips */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5 ml-6">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-current/40 hover:bg-current/10 transition-colors font-medium"
                  onClick={() => applySuggestion(s)}
                  data-testid={`ssf-suggestion-${i}`}
                >
                  <Clock className="h-3 w-3" />
                  {s.reason}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Coach (optional) */}
      {showCoachSelector && (
        <div className="space-y-1.5">
          <Label>Coach {coaches.length === 1 ? "" : "*"}</Label>
          <Select value={resolvedCoachId} onValueChange={setCoachId}>
            <SelectTrigger data-testid="ssf-select-coach">
              <SelectValue
                placeholder={
                  coaches.length === 1
                    ? `${coaches[0].user.firstName} ${coaches[0].user.lastName}`
                    : "Select coach"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {coaches.map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`ssf-option-coach-${c.id}`}>
                  {c.user.firstName} {c.user.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 6. Location */}
      <div className="space-y-1.5">
        <Label>Location</Label>
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger data-testid="ssf-select-location">
            <MapPin className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Select a location (optional)" />
          </SelectTrigger>
          <SelectContent>
            {locations.map(l => (
              <SelectItem key={l.id} value={l.name} data-testid={`ssf-option-location-${l.id}`}>
                {l.name}
              </SelectItem>
            ))}
            <SelectItem value="__none__">No location / remote</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 7. Notes */}
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea
          placeholder="Session notes (optional)..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="resize-none"
          data-testid="ssf-input-notes"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            data-testid="ssf-button-cancel"
          >
            {cancelLabel}
          </Button>
        )}
        <Button
          type="button"
          className="flex-1"
          onClick={handleSubmit}
          disabled={isSubmitting || isHardConflict}
          title={isHardConflict ? "Resolve the conflict before scheduling" : undefined}
          data-testid="ssf-button-submit"
        >
          {isSubmitting ? "Scheduling..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
