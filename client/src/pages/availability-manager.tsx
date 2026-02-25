import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { getAuthHeaders } from "@/lib/authToken";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Clock, MapPin, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import type { AvailabilityBlock, Organization } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMES: string[] = [];
for (let h = 5; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function formatTime(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function fetchWithAuth(url: string) {
  return fetch(url, {
    credentials: "include",
    headers: { ...getAuthHeaders(), "Cache-Control": "no-cache" },
  }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    return res.json();
  });
}

export default function AvailabilityManagerPage() {
  const { toast } = useToast();
  const [newDay, setNewDay] = useState("0");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newLocation, setNewLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");

  const { data: avProfile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const avOrgId = avProfile?.organizationId;
  const { data: avOrg } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", avOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${avOrgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!avOrgId,
  });
  const orgLocations = avOrg?.locations || [];
  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", avOrgId],
    queryFn: async () => {
      const url = avOrgId ? `/api/coaches?organizationId=${avOrgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
  });

  const { data: myCoachProfile } = useQuery<{ id: string }>({
    queryKey: ["/api/coach/profile"],
    queryFn: () => fetchWithAuth("/api/coach/profile"),
  });

  const activeCoachId = selectedCoachId || myCoachProfile?.id || "";

  const selectedCoach = coaches?.find((c) => c.id === activeCoachId);
  const selectedCoachName = selectedCoach
    ? `${selectedCoach.user?.firstName || ""} ${selectedCoach.user?.lastName || ""}`.trim()
    : "";

  const { data: blocks, isLoading } = useQuery<AvailabilityBlock[]>({
    queryKey: ["/api/coach/availability", activeCoachId],
    queryFn: () => fetchWithAuth(activeCoachId ? `/api/coach/availability?coachId=${activeCoachId}` : "/api/coach/availability"),
    enabled: !!activeCoachId,
  });

  const addMutation = useMutation({
    mutationFn: async (data: { dayOfWeek: number; startTime: string; endTime: string; coachId?: string }) => {
      const res = await apiRequest("POST", "/api/coach/availability", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Availability Added" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/coach/availability/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Block Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = async () => {
    if (newStart >= newEnd) {
      toast({ title: "Invalid Time", description: "End time must be after start time.", variant: "destructive" });
      return;
    }
    const resolvedLocation = newLocation === "__other__" ? customLocation : newLocation;
    if (newLocation === "__other__" && customLocation.trim() && avOrgId && !orgLocations.includes(customLocation.trim())) {
      try {
        await apiRequest("PATCH", `/api/organizations/${avOrgId}`, {
          locations: [...orgLocations, customLocation.trim()],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", avOrgId] });
      } catch (e) {}
    }
    const payload: { dayOfWeek: number; startTime: string; endTime: string; coachId?: string; location?: string } = {
      dayOfWeek: parseInt(newDay),
      startTime: newStart,
      endTime: newEnd,
      location: resolvedLocation || "",
    };
    if (activeCoachId) {
      payload.coachId = activeCoachId;
    }
    addMutation.mutate(payload);
    setNewLocation("");
    setCustomLocation("");
  };

  const groupedBlocks = DAYS.map((day, i) => ({
    day,
    dayIndex: i,
    blocks: (blocks || []).filter((b) => b.dayOfWeek === i).sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-availability-title">Availability</h1>
        <p className="text-muted-foreground mt-1">
          {selectedCoachId && selectedCoachId !== myCoachProfile?.id
            ? `Managing availability for ${selectedCoachName}`
            : "Set your weekly recurring availability"}
        </p>
      </div>

      {coaches && coaches.length > 1 && (
        <Card className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground shrink-0">Manage Coach:</span>
            <Select
              value={activeCoachId}
              onValueChange={(val) => setSelectedCoachId(val)}
            >
              <SelectTrigger className="w-full sm:w-64" data-testid="select-coach-availability">
                <SelectValue placeholder="Select a coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.filter(c => c.isActive).map((coach) => (
                  <SelectItem key={coach.id} value={coach.id} data-testid={`option-avail-coach-${coach.id}`}>
                    {coach.user?.firstName} {coach.user?.lastName}
                    {coach.id === myCoachProfile?.id ? " (You)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
              <Badge variant="secondary" className="text-xs">
                Editing {selectedCoachName}
              </Badge>
            )}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="font-semibold mb-4">Add Availability Block</h2>
        <div className="flex flex-col sm:flex-row items-end gap-3 flex-wrap">
          <div className="w-full sm:w-40">
            <label className="text-sm text-muted-foreground mb-1 block">Day</label>
            <Select value={newDay} onValueChange={setNewDay}>
              <SelectTrigger data-testid="select-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((day, i) => (
                  <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-36">
            <label className="text-sm text-muted-foreground mb-1 block">Start Time</label>
            <Select value={newStart} onValueChange={setNewStart}>
              <SelectTrigger data-testid="select-start-time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-36">
            <label className="text-sm text-muted-foreground mb-1 block">End Time</label>
            <Select value={newEnd} onValueChange={setNewEnd}>
              <SelectTrigger data-testid="select-end-time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-56">
            <label className="text-sm text-muted-foreground mb-1 block">Location</label>
            <Select value={newLocation} onValueChange={(val) => { setNewLocation(val); if (val !== "__other__") setCustomLocation(""); }}>
              <SelectTrigger data-testid="select-location">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No location</SelectItem>
                {orgLocations.map((loc) => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
                <SelectItem value="__other__">Other (custom)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newLocation === "__other__" && (
            <div className="w-full sm:w-56">
              <label className="text-sm text-muted-foreground mb-1 block">Custom Location</label>
              <Input
                placeholder="Enter location..."
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                data-testid="input-custom-location"
              />
            </div>
          )}
          <Button onClick={handleAdd} disabled={addMutation.isPending} data-testid="button-add-availability">
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        {groupedBlocks.map(({ day, blocks: dayBlocks }) => (
          <Card key={day} className="p-4">
            <h3 className="font-semibold mb-3">{day}</h3>
            {dayBlocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No availability set</p>
            ) : (
              <div className="space-y-2">
                {dayBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/50"
                    data-testid={`block-${block.id}`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{formatTime(block.startTime)} — {formatTime(block.endTime)}</span>
                      </div>
                      {block.location && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-5">
                          <MapPin className="h-3 w-3" />
                          <span>{block.location}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(block.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-block-${block.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
