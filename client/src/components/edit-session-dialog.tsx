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
import { CalendarIcon, Search, Trash2, XCircle, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Service } from "@shared/schema";

const PRESET_LOCATIONS = [
  "Bluffton High School",
  "Oscar Frazier Park (Bluffton, SC)",
  "PickUp USA Fitness (Bluffton, SC)",
  "Sweet Grass Fitness (Beaufort, SC)",
  "Coursen Tate Park (Beaufort, SC)",
  "Robert Smalls International Academy (Burton, SC)",
];
import type { BookingWithDetails } from "@/lib/types";

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
  const [showSearch, setShowSearch] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const initLocation = booking.location || "";
  const isPreset = PRESET_LOCATIONS.includes(initLocation);
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
      const loc = booking.location || "";
      const preset = PRESET_LOCATIONS.includes(loc);
      setLocation(preset ? loc : (loc ? "__custom__" : ""));
      setCustomLocation(preset ? "" : loc);
      setSearchQuery("");
      setShowSearch(false);
    }
  }, [open, booking]);

  const { data: services } = useQuery<Service[]>({ queryKey: ["/api/services"] });

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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/coach/bookings/${booking.id}`);
    },
    onSuccess: () => {
      toast({ title: "Session Deleted", description: "The session has been removed." });
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
                {PRESET_LOCATIONS.map((loc) => (
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
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Session notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
              data-testid="edit-input-notes"
            />
          </div>

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
              className="flex-1"
              onClick={handleSubmit}
              disabled={updateMutation.isPending || deleteMutation.isPending}
              data-testid="button-save-session"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this session? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
