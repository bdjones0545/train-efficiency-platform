import { useState } from "react";
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
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Plus, CalendarIcon, Search, XCircle } from "lucide-react";
import { format } from "date-fns";
import type { Service } from "@shared/schema";

type ClientSearchResult = { id: string; firstName: string | null; lastName: string | null; email: string | null };

export function AddSessionDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const { data: services } = useQuery<Service[]>({ queryKey: ["/api/services"] });

  const { data: searchResults } = useQuery<ClientSearchResult[]>({
    queryKey: ["/api/coach/clients/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await fetch(`/api/coach/clients/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/coach/bookings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Scheduled", description: "The session has been added to your bookings." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
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
    setSelectedDate(undefined);
    setServiceId("");
    setStartTime("09:00");
    setClientFirstName("");
    setClientLastName("");
    setSelectedClientId(null);
    setSearchQuery("");
    setNotes("");
    setShowSearch(false);
  };

  const handleSubmit = () => {
    if (!selectedDate || !serviceId || !startTime) {
      toast({ title: "Missing Fields", description: "Please fill in date, time, and service.", variant: "destructive" });
      return;
    }
    if (!selectedClientId && (!clientFirstName.trim() || !clientLastName.trim())) {
      toast({ title: "Missing Client", description: "Please enter or select a client.", variant: "destructive" });
      return;
    }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);

    const body: any = { serviceId, startAt: startAt.toISOString(), notes };
    if (selectedClientId) {
      body.clientId = selectedClientId;
    } else {
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
        <Button data-testid="button-add-session">
          <Plus className="h-4 w-4 mr-1" />
          Add Session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule a Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
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
      </DialogContent>
    </Dialog>
  );
}
