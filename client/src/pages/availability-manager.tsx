import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { getAuthHeaders } from "@/lib/authToken";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Clock,
  MapPin,
  Pencil,
  Copy,
  Check,
  X,
  ChevronDown,
  BarChart3,
  Zap,
  LayoutList,
  CalendarDays,
  TrendingUp,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AvailabilityBlock, Organization } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";
import {
  startOfWeek, endOfWeek, isWithinInterval, differenceInMinutes,
} from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

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

function blockDurationHours(b: AvailabilityBlock): number {
  const [sh, sm] = b.startTime.split(":").map(Number);
  const [eh, em] = b.endTime.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

// ─── Templates ───────────────────────────────────────────────────────────────

type TemplateBlock = { dayOfWeek: number; startTime: string; endTime: string; location?: string };

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  blocks: TemplateBlock[];
}

const TEMPLATES: Template[] = [
  {
    id: "spring-island",
    name: "Spring Island Coach",
    description: "Full-day availability Mon–Fri at Spring Island",
    icon: "🌴",
    blocks: [0,1,2,3,4].map(d => ({ dayOfWeek: d, startTime: "06:00", endTime: "14:00", location: "Spring Island" })),
  },
  {
    id: "high-school",
    name: "High School Coach",
    description: "Afternoon blocks for school-schedule coaches",
    icon: "🏫",
    blocks: [0,1,2,3,4].map(d => ({ dayOfWeek: d, startTime: "14:00", endTime: "19:00" })),
  },
  {
    id: "semi-private",
    name: "Semi-Private Coach",
    description: "Morning and evening sessions Mon–Fri",
    icon: "💪",
    blocks: [
      ...[0,1,2,3,4].map(d => ({ dayOfWeek: d, startTime: "06:00", endTime: "10:00" })),
      ...[0,1,2,3,4].map(d => ({ dayOfWeek: d, startTime: "16:00", endTime: "19:00" })),
    ],
  },
  {
    id: "early-bird",
    name: "Personal Training Coach",
    description: "Early mornings Mon–Sat",
    icon: "🌅",
    blocks: [0,1,2,3,4,5].map(d => ({ dayOfWeek: d, startTime: "05:00", endTime: "12:00" })),
  },
  {
    id: "evening",
    name: "Evening Coach",
    description: "Weekday evenings + Saturday mornings",
    icon: "🌆",
    blocks: [
      ...[0,1,2,3,4].map(d => ({ dayOfWeek: d, startTime: "16:00", endTime: "21:00" })),
      { dayOfWeek: 5, startTime: "08:00", endTime: "12:00" },
    ],
  },
  {
    id: "football",
    name: "Football / Team Coach",
    description: "Heavy Mon–Thu schedule with weekend games",
    icon: "🏈",
    blocks: [
      ...[0,1,2,3].map(d => ({ dayOfWeek: d, startTime: "06:00", endTime: "18:00" })),
      { dayOfWeek: 5, startTime: "08:00", endTime: "20:00" },
      { dayOfWeek: 6, startTime: "08:00", endTime: "20:00" },
    ],
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function fetchWithAuth(url: string) {
  return fetch(url, {
    credentials: "include",
    headers: { ...getAuthHeaders(), "Cache-Control": "no-cache" },
  }).then(res => {
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    return res.json();
  });
}

// ─── Capacity Bar ─────────────────────────────────────────────────────────────

function CapacityBar({ blocks, coachId }: { blocks: AvailabilityBlock[]; coachId: string }) {
  const { data: bookings = [] } = useQuery<any[]>({
    queryKey: ["/api/coach/bookings", coachId],
    queryFn: () => fetchWithAuth(coachId ? `/api/coach/bookings?coachId=${coachId}` : "/api/coach/bookings"),
    enabled: !!coachId,
  });

  const availableHours = useMemo(
    () => blocks.reduce((sum, b) => sum + blockDurationHours(b), 0),
    [blocks]
  );

  const bookedHours = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    return bookings
      .filter(b => {
        if (b.status === "CANCELLED") return false;
        const d = new Date(b.startAt);
        return isWithinInterval(d, { start: weekStart, end: weekEnd });
      })
      .reduce((sum, b) => {
        const mins = differenceInMinutes(new Date(b.endAt), new Date(b.startAt));
        return sum + mins / 60;
      }, 0);
  }, [bookings]);

  const openHours = Math.max(availableHours - bookedHours, 0);
  const utilization = availableHours > 0 ? Math.round((bookedHours / availableHours) * 100) : 0;

  const utilizationColor =
    utilization >= 90 ? "text-red-600 dark:text-red-400" :
    utilization >= 75 ? "text-amber-600 dark:text-amber-400" :
    "text-green-600 dark:text-green-400";

  const metrics = [
    { label: "Available / Wk", value: `${availableHours.toFixed(1)}h`, icon: Clock, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Booked This Wk", value: `${bookedHours.toFixed(1)}h`, icon: BarChart3, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
    { label: "Open Capacity", value: `${openHours.toFixed(1)}h`, icon: Zap, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Utilization", value: `${utilization}%`, icon: TrendingUp, color: utilizationColor, bg: "bg-muted/50" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map(m => (
        <Card key={m.label} className="border-0 shadow-sm" data-testid={`capacity-${m.label.toLowerCase().replace(/\s/g, "-")}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${m.bg}`}>
                <m.icon className={`h-4 w-4 ${m.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Block Card (read mode) ───────────────────────────────────────────────────

function BlockCard({
  block,
  onEdit,
  onDuplicate,
  onDelete,
  isDeleting,
}: {
  block: AvailabilityBlock;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-card hover:shadow-sm transition-shadow"
      data-testid={`block-${block.id}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-1.5 h-8 rounded-full bg-primary/60 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span data-testid={`block-time-${block.id}`}>
              {formatTime(block.startTime)} — {formatTime(block.endTime)}
            </span>
            <span className="text-xs text-muted-foreground">
              ({blockDurationHours(block).toFixed(1)}h)
            </span>
          </div>
          {block.location && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 pl-5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{block.location}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onEdit}
          data-testid={`button-edit-block-${block.id}`}
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onDuplicate}
          data-testid={`button-duplicate-block-${block.id}`}
          title="Copy to another day"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          disabled={isDeleting}
          data-testid={`button-delete-block-${block.id}`}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Inline Edit Form ─────────────────────────────────────────────────────────

function InlineBlockForm({
  startTime,
  endTime,
  location,
  orgLocations,
  onStartChange,
  onEndChange,
  onLocationChange,
  onSave,
  onCancel,
  isSaving,
  saveLabel,
}: {
  startTime: string;
  endTime: string;
  location: string;
  orgLocations: string[];
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveLabel: string;
}) {
  const [showCustom, setShowCustom] = useState(
    !!location && !orgLocations.includes(location) && location !== "__none__"
  );
  const [customLoc, setCustomLoc] = useState(
    !orgLocations.includes(location) && location !== "__none__" ? location : ""
  );

  const handleLocChange = (val: string) => {
    if (val === "__other__") {
      setShowCustom(true);
      onLocationChange(customLoc);
    } else if (val === "__none__") {
      setShowCustom(false);
      onLocationChange("");
    } else {
      setShowCustom(false);
      onLocationChange(val);
    }
  };

  const selectVal = showCustom ? "__other__" : (orgLocations.includes(location) ? location : (location ? "__other__" : "__none__"));

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[120px]">
          <Label className="text-xs mb-1 block">Start Time</Label>
          <Select value={startTime} onValueChange={onStartChange}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-inline-start">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {TIMES.map(t => <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <Label className="text-xs mb-1 block">End Time</Label>
          <Select value={endTime} onValueChange={onEndChange}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-inline-end">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {TIMES.map(t => <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <Label className="text-xs mb-1 block">Location</Label>
          <Select value={selectVal} onValueChange={handleLocChange}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-inline-location">
              <SelectValue placeholder="No location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No location</SelectItem>
              {orgLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              <SelectItem value="__other__">Other (custom)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showCustom && (
          <div className="flex-1 min-w-[150px]">
            <Label className="text-xs mb-1 block">Custom Location</Label>
            <Input
              className="h-8 text-sm"
              placeholder="Enter location..."
              value={customLoc}
              onChange={e => { setCustomLoc(e.target.value); onLocationChange(e.target.value); }}
            />
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          <X className="h-3 w-3 mr-1" />Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onSave} disabled={isSaving} data-testid="button-save-block">
          <Check className="h-3 w-3 mr-1" />
          {isSaving ? "Saving..." : saveLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── Day Section ──────────────────────────────────────────────────────────────

function DaySection({
  dayIndex,
  dayName,
  dayBlocks,
  orgLocations,
  activeCoachId,
  onDuplicateRequest,
}: {
  dayIndex: number;
  dayName: string;
  dayBlocks: AvailabilityBlock[];
  orgLocations: string[];
  activeCoachId: string;
  onDuplicateRequest: (block: AvailabilityBlock) => void;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [newStart, setNewStart] = useState("06:00");
  const [newEnd, setNewEnd] = useState("14:00");
  const [newLocation, setNewLocation] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editLocation, setEditLocation] = useState("");

  const startEdit = (block: AvailabilityBlock) => {
    setEditingId(block.id);
    setEditStart(block.startTime);
    setEditEnd(block.endTime);
    setEditLocation(block.location || "");
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      if (newStart >= newEnd) throw new Error("End time must be after start time");
      const payload: any = { dayOfWeek: dayIndex, startTime: newStart, endTime: newEnd };
      if (activeCoachId) payload.coachId = activeCoachId;
      if (newLocation) payload.location = newLocation;
      return apiRequest("POST", "/api/coach/availability", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
      setAddingNew(false);
      setNewStart("06:00");
      setNewEnd("14:00");
      setNewLocation("");
      toast({ title: "Block added" });
    },
    onError: (e: Error) => {
      if (isUnauthorizedError(e)) { window.location.href = "/"; return; }
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (editStart >= editEnd) throw new Error("End time must be after start time");
      return apiRequest("PATCH", `/api/coach/availability/${id}`, {
        startTime: editStart,
        endTime: editEnd,
        location: editLocation,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
      setEditingId(null);
      toast({ title: "Block updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/coach/availability/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
      toast({ title: "Block removed" });
    },
    onError: (e: Error) => {
      if (isUnauthorizedError(e)) { window.location.href = "/"; return; }
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const totalHours = dayBlocks.reduce((s, b) => s + blockDurationHours(b), 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-xl overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted/50 ${
              dayBlocks.length > 0 ? "bg-muted/20" : "bg-background"
            }`}
            data-testid={`toggle-day-${dayIndex}`}
          >
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold bg-primary/10 text-primary">
                {dayName.charAt(0)}
              </span>
              <span>{dayName}</span>
              {dayBlocks.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {dayBlocks.length} block{dayBlocks.length !== 1 ? "s" : ""} · {totalHours.toFixed(1)}h
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {dayBlocks.length === 0 && (
                <span className="text-xs text-muted-foreground">No availability set</span>
              )}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-2 space-y-2 bg-background">
            {dayBlocks.map(block => (
              editingId === block.id ? (
                <InlineBlockForm
                  key={block.id}
                  startTime={editStart}
                  endTime={editEnd}
                  location={editLocation}
                  orgLocations={orgLocations}
                  onStartChange={setEditStart}
                  onEndChange={setEditEnd}
                  onLocationChange={setEditLocation}
                  onSave={() => updateMutation.mutate({ id: block.id })}
                  onCancel={() => setEditingId(null)}
                  isSaving={updateMutation.isPending}
                  saveLabel="Save Changes"
                />
              ) : (
                <BlockCard
                  key={block.id}
                  block={block}
                  onEdit={() => startEdit(block)}
                  onDuplicate={() => onDuplicateRequest(block)}
                  onDelete={() => deleteMutation.mutate(block.id)}
                  isDeleting={deleteMutation.isPending}
                />
              )
            ))}

            {addingNew ? (
              <InlineBlockForm
                startTime={newStart}
                endTime={newEnd}
                location={newLocation}
                orgLocations={orgLocations}
                onStartChange={setNewStart}
                onEndChange={setNewEnd}
                onLocationChange={setNewLocation}
                onSave={() => addMutation.mutate()}
                onCancel={() => { setAddingNew(false); }}
                isSaving={addMutation.isPending}
                saveLabel="Add Block"
              />
            ) : (
              <button
                className="w-full flex items-center gap-2 py-2 px-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-muted/30 transition-colors"
                onClick={() => setAddingNew(true)}
                data-testid={`button-add-block-day-${dayIndex}`}
              >
                <Plus className="h-3.5 w-3.5" />
                Add block
              </button>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab({
  activeCoachId,
  existingBlocks,
  orgLocations,
}: {
  activeCoachId: string;
  existingBlocks: AvailabilityBlock[];
  orgLocations: string[];
}) {
  const { toast } = useToast();
  const [applyingTemplate, setApplyingTemplate] = useState<Template | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customTemplateName, setCustomTemplateName] = useState("");

  const applyMutation = useMutation({
    mutationFn: async (template: Template) => {
      // Delete all existing blocks first
      await Promise.all(existingBlocks.map(b =>
        apiRequest("DELETE", `/api/coach/availability/${b.id}`)
      ));
      // Create all new blocks
      await Promise.all(template.blocks.map(b =>
        apiRequest("POST", "/api/coach/availability", {
          coachId: activeCoachId || undefined,
          dayOfWeek: b.dayOfWeek,
          startTime: b.startTime,
          endTime: b.endTime,
          location: b.location || "",
        })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
      setApplyingTemplate(null);
      setConfirmOpen(false);
      toast({ title: "Template applied", description: "Your availability schedule has been updated." });
    },
    onError: (e: Error) => {
      toast({ title: "Error applying template", description: e.message, variant: "destructive" });
    },
  });

  const handleApplyClick = (t: Template) => {
    setApplyingTemplate(t);
    setConfirmOpen(true);
  };

  const schedulePreview = (blocks: TemplateBlock[]) => {
    const byDay = DAYS.map((d, i) => ({
      day: d.slice(0, 3),
      blocks: blocks.filter(b => b.dayOfWeek === i),
    })).filter(d => d.blocks.length > 0);
    return byDay.map(d => (
      `${d.day}: ${d.blocks.map(b => `${formatTime(b.startTime)}–${formatTime(b.endTime)}`).join(", ")}`
    )).join(" · ");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Applying a template will <strong>replace</strong> the coach's current availability schedule. This cannot be undone.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map(t => (
          <Card key={t.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden>{t.icon}</span>
                  <div>
                    <h3 className="font-semibold text-sm">{t.name}</h3>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => handleApplyClick(t)}
                  disabled={applyMutation.isPending}
                  data-testid={`button-apply-template-${t.id}`}
                >
                  Apply
                </Button>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                {schedulePreview(t.blocks)}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs">
                  {t.blocks.length} block{t.blocks.length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {t.blocks.reduce((s, b) => {
                    const [sh, sm] = b.startTime.split(":").map(Number);
                    const [eh, em] = b.endTime.split(":").map(Number);
                    return s + (eh * 60 + em - (sh * 60 + sm)) / 60;
                  }, 0).toFixed(0)}h/wk
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply "{applyingTemplate?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all existing availability blocks and replace them with the template schedule.
              {existingBlocks.length > 0 && (
                <span className="block mt-1 font-medium text-destructive">
                  {existingBlocks.length} existing block{existingBlocks.length !== 1 ? "s" : ""} will be removed.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applyingTemplate && applyMutation.mutate(applyingTemplate)}
              disabled={applyMutation.isPending}
              data-testid="button-confirm-apply-template"
            >
              {applyMutation.isPending ? "Applying..." : "Apply Template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Duplicate Dialog ─────────────────────────────────────────────────────────

function DuplicateDialog({
  block,
  activeCoachId,
  onClose,
}: {
  block: AvailabilityBlock | null;
  activeCoachId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [targetDay, setTargetDay] = useState<string>("");

  const dupMutation = useMutation({
    mutationFn: async () => {
      if (!block || targetDay === "") throw new Error("Select a day");
      const payload: any = {
        dayOfWeek: parseInt(targetDay),
        startTime: block.startTime,
        endTime: block.endTime,
        location: block.location || "",
      };
      if (activeCoachId) payload.coachId = activeCoachId;
      return apiRequest("POST", "/api/coach/availability", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/availability"] });
      toast({ title: "Block duplicated" });
      onClose();
      setTargetDay("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!block} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Copy Block to Another Day</DialogTitle>
          <DialogDescription>
            {block && `${formatTime(block.startTime)} — ${formatTime(block.endTime)}${block.location ? ` · ${block.location}` : ""}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Label>Copy to</Label>
          <Select value={targetDay} onValueChange={setTargetDay}>
            <SelectTrigger data-testid="select-duplicate-day">
              <SelectValue placeholder="Select day..." />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => (
                <SelectItem key={i} value={String(i)} disabled={block?.dayOfWeek === i}>
                  {d}{block?.dayOfWeek === i ? " (current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => dupMutation.mutate()}
            disabled={!targetDay || dupMutation.isPending}
            data-testid="button-confirm-duplicate"
          >
            {dupMutation.isPending ? "Copying..." : "Copy Block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabView = "weekly" | "templates";

export default function AvailabilityManagerPage() {
  const { toast } = useToast();
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabView>("weekly");
  const [duplicatingBlock, setDuplicatingBlock] = useState<AvailabilityBlock | null>(null);

  // ── Data ──
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
  const orgLocations: string[] = avOrg?.locations || [];

  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", avOrgId],
    queryFn: async () => {
      const url = avOrgId ? `/api/coaches?organizationId=${avOrgId}` : "/api/coaches";
      return fetch(url).then(r => r.json());
    },
  });

  const { data: myCoachProfile } = useQuery<{ id: string }>({
    queryKey: ["/api/coach/profile"],
    queryFn: () => fetchWithAuth("/api/coach/profile"),
  });

  const activeCoachId = selectedCoachId || myCoachProfile?.id || "";
  const selectedCoach = coaches?.find(c => c.id === activeCoachId);
  const selectedCoachName = selectedCoach
    ? `${selectedCoach.user?.firstName || ""} ${selectedCoach.user?.lastName || ""}`.trim()
    : "";

  const { data: blocks = [], isLoading } = useQuery<AvailabilityBlock[]>({
    queryKey: ["/api/coach/availability", activeCoachId],
    queryFn: () => fetchWithAuth(activeCoachId ? `/api/coach/availability?coachId=${activeCoachId}` : "/api/coach/availability"),
    enabled: !!activeCoachId,
  });

  const groupedBlocks = useMemo(() =>
    DAYS.map((day, i) => ({
      day,
      dayIndex: i,
      blocks: blocks.filter(b => b.dayOfWeek === i).sort((a, b2) => a.startTime.localeCompare(b2.startTime)),
    })),
    [blocks]
  );

  const TABS = [
    { key: "weekly" as TabView, label: "Weekly Builder", icon: LayoutList },
    { key: "templates" as TabView, label: "Templates", icon: Sparkles },
  ];

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-availability-title">Availability</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCoachId && selectedCoachId !== myCoachProfile?.id
              ? `Managing schedule for ${selectedCoachName}`
              : "Manage your weekly recurring schedule"}
          </p>
        </div>
        {coaches && coaches.length > 1 && (
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            <Select value={activeCoachId} onValueChange={setSelectedCoachId}>
              <SelectTrigger className="w-52" data-testid="select-coach-availability">
                <SelectValue placeholder="Select a coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.filter(c => c.isActive).map(coach => (
                  <SelectItem key={coach.id} value={coach.id} data-testid={`option-avail-coach-${coach.id}`}>
                    {coach.user?.firstName} {coach.user?.lastName}
                    {coach.id === myCoachProfile?.id ? " (You)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
              <Badge variant="secondary" className="text-xs">Editing {selectedCoachName}</Badge>
            )}
          </div>
        )}
      </div>

      {/* ── Capacity Bar ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <CapacityBar blocks={blocks} coachId={activeCoachId} />
      )}

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${tab.key}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : activeTab === "weekly" ? (
        <div className="space-y-2">
          {groupedBlocks.map(({ day, dayIndex, blocks: dayBlocks }) => (
            <DaySection
              key={dayIndex}
              dayIndex={dayIndex}
              dayName={day}
              dayBlocks={dayBlocks}
              orgLocations={orgLocations}
              activeCoachId={activeCoachId}
              onDuplicateRequest={setDuplicatingBlock}
            />
          ))}
        </div>
      ) : (
        <TemplatesTab
          activeCoachId={activeCoachId}
          existingBlocks={blocks}
          orgLocations={orgLocations}
        />
      )}

      {/* ── Duplicate Dialog ── */}
      <DuplicateDialog
        block={duplicatingBlock}
        activeCoachId={activeCoachId}
        onClose={() => setDuplicatingBlock(null)}
      />
    </div>
  );
}
