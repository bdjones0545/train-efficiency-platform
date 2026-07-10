import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
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
  TrendingUp,
  ArrowLeftRight,
  Sparkles,
  Brain,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Calendar,
  Activity,
  TrendingDown,
  Target,
  Info,
  RefreshCw,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AvailabilityBlock, Organization } from "@shared/schema";
import type { CoachWithUser } from "@/lib/types";
import {
  startOfWeek, endOfWeek, isWithinInterval, differenceInMinutes,
} from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Monday=0 in our system, but JS getDay() returns 0=Sunday,1=Monday...
// Map JS getDay() to our dayOfWeek (0=Mon...6=Sun)
const JS_DAY_TO_IDX: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
const TODAY_IDX = JS_DAY_TO_IDX[new Date().getDay()];

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

// ─── Coverage Quality (deterministic from hours) ─────────────────────────────

function dayeCoverageSignal(hours: number): { label: string; color: string; ring: string; bg: string } {
  if (hours === 0) return { label: "No coverage", color: "text-muted-foreground", ring: "border-border", bg: "bg-muted/20" };
  if (hours < 3) return { label: "Light", color: "text-amber-600 dark:text-amber-400", ring: "border-amber-300 dark:border-amber-700", bg: "bg-amber-50/60 dark:bg-amber-950/20" };
  if (hours <= 8) return { label: "Healthy", color: "text-green-600 dark:text-green-400", ring: "border-green-300 dark:border-green-700", bg: "bg-green-50/60 dark:bg-green-950/20" };
  if (hours <= 12) return { label: "Heavy", color: "text-amber-600 dark:text-amber-400", ring: "border-amber-300 dark:border-amber-700", bg: "bg-amber-50/60 dark:bg-amber-950/20" };
  return { label: "Overloaded", color: "text-red-600 dark:text-red-400", ring: "border-red-300 dark:border-red-700", bg: "bg-red-50/60 dark:bg-red-950/20" };
}

// ─── Workforce Health Banner ──────────────────────────────────────────────────

function WorkforceHealthBanner({ blocks }: { blocks: AvailabilityBlock[] }) {
  const { data: healthData, isLoading } = useQuery<any>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: () => fetchWithAuth("/api/scheduling-intelligence/health-score"),
    staleTime: 60_000,
  });

  // Deterministic signals from blocks
  const todayBlocks = blocks.filter(b => b.dayOfWeek === TODAY_IDX);
  const todayHours = todayBlocks.reduce((s, b) => s + blockDurationHours(b), 0);
  const daysWithNoBlocks = DAYS.filter((_, i) => !blocks.some(b => b.dayOfWeek === i));
  const totalWeekHours = blocks.reduce((s, b) => s + blockDurationHours(b), 0);

  const score = healthData?.score ?? null;
  const grade = healthData?.grade ?? null;

  const gradeColor = grade === "Excellent" ? "text-green-600 dark:text-green-400"
    : grade === "Good" ? "text-green-600 dark:text-green-400"
    : grade === "Fair" ? "text-amber-600 dark:text-amber-400"
    : grade === "Poor" ? "text-red-600 dark:text-red-400"
    : grade === "Critical" ? "text-red-700 dark:text-red-400"
    : "text-muted-foreground";

  const gradeBg = grade === "Excellent" || grade === "Good"
    ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
    : grade === "Fair"
    ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
    : grade === "Poor" || grade === "Critical"
    ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
    : "bg-muted/30 border-border";

  const signals: { icon: any; text: string; color: string }[] = [];

  if (todayHours === 0) {
    signals.push({ icon: AlertTriangle, text: "No availability set for today", color: "text-red-600 dark:text-red-400" });
  } else {
    signals.push({ icon: CheckCircle2, text: `${todayHours.toFixed(1)}h available today`, color: "text-green-600 dark:text-green-400" });
  }

  if (daysWithNoBlocks.length > 0) {
    signals.push({ icon: AlertCircle, text: `${daysWithNoBlocks.length} day${daysWithNoBlocks.length > 1 ? "s" : ""} with no coverage`, color: "text-amber-600 dark:text-amber-400" });
  }

  if (totalWeekHours > 50) {
    signals.push({ icon: AlertTriangle, text: "High weekly hours — burnout risk", color: "text-red-600 dark:text-red-400" });
  }

  if (isLoading) {
    return (
      <div className="flex gap-3">
        {[1,2,3].map(i => <Skeleton key={i} className="h-9 flex-1 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border px-4 py-3 ${gradeBg}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {score !== null && (
          <div className="flex items-center gap-2 shrink-0">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Schedule Health</span>
            <span className={`text-sm font-bold ${gradeColor}`}>{grade} ({score})</span>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">This week</span>
          <span className="text-sm font-semibold">{totalWeekHours.toFixed(1)}h scheduled</span>
        </div>
        {signals.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
            <span className={`text-xs font-medium ${s.color}`}>{s.text}</span>
          </div>
        ))}
        {daysWithNoBlocks.length === 0 && totalWeekHours > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Full week covered</span>
          </div>
        )}
      </div>
    </div>
  );
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

  const utilizationBarColor =
    utilization >= 90 ? "bg-red-500" :
    utilization >= 75 ? "bg-amber-500" :
    "bg-green-500";

  const metrics = [
    { label: "Available / Wk", value: `${availableHours.toFixed(1)}h`, icon: Clock, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Booked This Wk", value: `${bookedHours.toFixed(1)}h`, icon: BarChart3, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
    { label: "Open Capacity", value: `${openHours.toFixed(1)}h`, icon: Zap, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Utilization", value: `${utilization}%`, icon: TrendingUp, color: utilizationColor, bg: "bg-muted/50", bar: true },
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
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                {m.bar && availableHours > 0 && (
                  <div className="mt-1.5">
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${utilizationBarColor}`}
                        style={{ width: `${Math.min(utilization, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
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
  const isToday = dayIndex === TODAY_IDX;
  const [isOpen, setIsOpen] = useState(isToday || dayBlocks.length > 0);
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
  const coverage = dayeCoverageSignal(totalHours);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={`border rounded-xl overflow-hidden ${isToday ? "ring-2 ring-primary/30" : ""}`}>
        <CollapsibleTrigger asChild>
          <button
            className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted/50 ${
              dayBlocks.length > 0 ? "bg-muted/20" : "bg-background"
            }`}
            data-testid={`toggle-day-${dayIndex}`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${
                isToday ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
              }`}>
                {dayName.charAt(0)}
              </span>
              <span>{dayName}</span>
              {isToday && (
                <Badge className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">Today</Badge>
              )}
              {dayBlocks.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {dayBlocks.length} block{dayBlocks.length !== 1 ? "s" : ""} · {totalHours.toFixed(1)}h
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {totalHours > 0 && (
                <span className={`text-xs font-medium ${coverage.color}`}>{coverage.label}</span>
              )}
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

  const applyMutation = useMutation({
    mutationFn: async (template: Template) => {
      await Promise.all(existingBlocks.map(b =>
        apiRequest("DELETE", `/api/coach/availability/${b.id}`)
      ));
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

// ─── Intelligence Tab ─────────────────────────────────────────────────────────

interface RecommendationAction {
  type: string;
  coachId?: string;
  sessionId?: string;
  description: string;
  estimatedRevenueCents?: number;
}

function IntelligenceTab({ blocks }: { blocks: AvailabilityBlock[] }) {
  const { toast } = useToast();

  const { data: capacityData, isLoading: loadingCap, refetch: refetchCap } = useQuery<any>({
    queryKey: ["/api/scheduling-intelligence/capacity-optimization"],
    queryFn: () => fetchWithAuth("/api/scheduling-intelligence/capacity-optimization"),
    staleTime: 60_000,
  });

  const { data: opportunitiesData, isLoading: loadingOpp, refetch: refetchOpp } = useQuery<any>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: () => fetchWithAuth("/api/scheduling-intelligence/opportunities"),
    staleTime: 60_000,
  });

  const { data: healthData, isLoading: loadingHealth } = useQuery<any>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: () => fetchWithAuth("/api/scheduling-intelligence/health-score"),
    staleTime: 60_000,
  });

  const actionMutation = useMutation({
    mutationFn: (body: { recommendationType: string; action: "accepted" | "rejected"; context?: any }) =>
      apiRequest("POST", "/api/scheduling-intelligence/recommendation-action", body),
    onSuccess: (_data, vars) => {
      toast({ title: vars.action === "accepted" ? "Recommendation accepted" : "Recommendation dismissed" });
      refetchCap();
      refetchOpp();
    },
    onError: () => toast({ title: "Error", description: "Could not record action", variant: "destructive" }),
  });

  // Deterministic coverage gap analysis from blocks
  const coverageAnalysis = useMemo(() => {
    return DAYS.map((day, i) => {
      const dayBlocks = blocks.filter(b => b.dayOfWeek === i);
      const hours = dayBlocks.reduce((s, b) => s + blockDurationHours(b), 0);
      const signal = dayeCoverageSignal(hours);
      return { day, dayIndex: i, hours, signal, isToday: i === TODAY_IDX };
    });
  }, [blocks]);

  const gapDays = coverageAnalysis.filter(d => d.hours === 0);
  const lightDays = coverageAnalysis.filter(d => d.hours > 0 && d.hours < 3);
  const overloadedDays = coverageAnalysis.filter(d => d.hours > 12);
  const totalWeekHours = blocks.reduce((s, b) => s + blockDurationHours(b), 0);

  const isLoading = loadingCap || loadingOpp || loadingHealth;

  return (
    <div className="space-y-6">
      {/* ── Health Score Summary ── */}
      {loadingHealth ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : healthData ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Organizational Schedule Health
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{healthData.score ?? "—"}</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                  <Badge className={`text-xs ${
                    healthData.grade === "Excellent" || healthData.grade === "Good"
                      ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20"
                      : healthData.grade === "Fair"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20"
                      : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20"
                  }`}>
                    {healthData.grade ?? "Unknown"}
                  </Badge>
                </div>
              </div>
              {healthData.factors && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                  {Object.entries(healthData.factors as Record<string, number>).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                      <span className="font-semibold">{typeof v === "number" ? Math.round(v) : v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Coverage Gap Analysis (Deterministic) ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          Coverage Analysis
          <Badge variant="outline" className="text-xs font-normal">Deterministic</Badge>
        </h3>
        <div className="grid grid-cols-7 gap-1.5">
          {coverageAnalysis.map(d => (
            <div
              key={d.dayIndex}
              className={`rounded-lg border p-2 text-center ${d.signal.ring} ${d.signal.bg} ${d.isToday ? "ring-2 ring-primary/40" : ""}`}
              data-testid={`coverage-day-${d.dayIndex}`}
            >
              <p className="text-[10px] font-semibold text-muted-foreground mb-1">{d.day.slice(0, 3)}</p>
              <p className={`text-sm font-bold ${d.signal.color}`}>{d.hours.toFixed(0)}h</p>
              <p className={`text-[9px] mt-0.5 ${d.signal.color}`}>{d.signal.label}</p>
              {d.isToday && <p className="text-[9px] text-primary font-medium mt-0.5">Today</p>}
            </div>
          ))}
        </div>

        {(gapDays.length > 0 || lightDays.length > 0 || overloadedDays.length > 0) && (
          <div className="mt-3 space-y-1.5">
            {gapDays.length > 0 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-red-700 dark:text-red-300">
                  <strong>{gapDays.map(d => d.day).join(", ")}</strong> — no availability set. Coverage gap {gapDays.some(d => d.isToday) ? "(includes today)" : ""}.
                </span>
              </div>
            )}
            {lightDays.length > 0 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-amber-700 dark:text-amber-300">
                  <strong>{lightDays.map(d => d.day).join(", ")}</strong> — light coverage (&lt;3h). Consider expanding.
                </span>
              </div>
            )}
            {overloadedDays.length > 0 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-red-700 dark:text-red-300">
                  <strong>{overloadedDays.map(d => d.day).join(", ")}</strong> — heavy schedule (&gt;12h). Burnout risk.
                </span>
              </div>
            )}
            {totalWeekHours > 50 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-red-700 dark:text-red-300">
                  <strong>{totalWeekHours.toFixed(1)}h/week</strong> — exceeds sustainable threshold. Evaluate workload.
                </span>
              </div>
            )}
          </div>
        )}

        {gapDays.length === 0 && lightDays.length === 0 && overloadedDays.length === 0 && totalWeekHours > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-green-700 dark:text-green-300">Coverage is healthy across all scheduled days.</span>
          </div>
        )}
      </div>

      {/* ── Capacity Optimization Recommendations ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Scheduling Intelligence
            <Badge className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20">AI</Badge>
          </h3>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => { refetchCap(); refetchOpp(); }}
            data-testid="button-refresh-intelligence"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>

        {loadingCap ? (
          <div className="space-y-3">
            {[1,2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : capacityData?.recommendations?.length > 0 ? (
          <div className="space-y-3">
            {capacityData.recommendations.map((rec: any, idx: number) => (
              <RecommendationCard
                key={idx}
                rec={rec}
                onAccept={() => actionMutation.mutate({
                  recommendationType: rec.type || "capacity_optimization",
                  action: "accepted",
                  context: rec,
                })}
                onReject={() => actionMutation.mutate({
                  recommendationType: rec.type || "capacity_optimization",
                  action: "rejected",
                  context: rec,
                })}
                isPending={actionMutation.isPending}
              />
            ))}
          </div>
        ) : !loadingCap ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-xl">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-500 opacity-60" />
            No capacity optimization recommendations at this time.
          </div>
        ) : null}
      </div>

      {/* ── Opportunity Inbox ── */}
      {!loadingOpp && opportunitiesData?.opportunities?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Scheduling Opportunities
          </h3>
          <div className="space-y-2">
            {opportunitiesData.opportunities.slice(0, 5).map((opp: any, idx: number) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800"
                data-testid={`opportunity-${idx}`}
              >
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{opp.title ?? opp.type ?? "Opportunity"}</p>
                  {opp.description && <p className="text-xs text-muted-foreground mt-0.5">{opp.description}</p>}
                  {opp.estimatedRevenueCents != null && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">
                      Est. ${Math.round(opp.estimatedRevenueCents / 100).toLocaleString()} revenue opportunity
                    </p>
                  )}
                </div>
                {opp.severity && (
                  <Badge className={`text-xs shrink-0 ${
                    opp.severity === "high" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20"
                    : opp.severity === "medium" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {opp.severity}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Operational Intelligence Summary ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          Operational Summary
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <SummaryCard
            title="Where availability limits growth"
            value={gapDays.length > 0
              ? `${gapDays.length} day${gapDays.length > 1 ? "s" : ""} uncovered — ${gapDays.map(d => d.day).join(", ")}`
              : "No coverage gaps detected"}
            icon={TrendingDown}
            color={gapDays.length > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}
            data-testid="summary-growth-limits"
          />
          <SummaryCard
            title="Where availability is wasted"
            value={overloadedDays.length > 0
              ? `${overloadedDays.length} day${overloadedDays.length > 1 ? "s" : ""} overloaded — ${overloadedDays.map(d => d.day).join(", ")}`
              : totalWeekHours === 0 ? "No availability configured"
              : "No overloaded days"}
            icon={AlertTriangle}
            color={overloadedDays.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}
            data-testid="summary-wasted-availability"
          />
          <SummaryCard
            title="Total weekly capacity configured"
            value={`${totalWeekHours.toFixed(1)} hours across ${blocks.length} block${blocks.length !== 1 ? "s" : ""}`}
            icon={Clock}
            color="text-blue-600 dark:text-blue-400"
            data-testid="summary-weekly-capacity"
          />
          <SummaryCard
            title="Days with healthy coverage"
            value={`${coverageAnalysis.filter(d => d.hours >= 3 && d.hours <= 12).length} of 7 days`}
            icon={CheckCircle2}
            color="text-green-600 dark:text-green-400"
            data-testid="summary-healthy-days"
          />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, color, "data-testid": testId }: {
  title: string; value: string; icon: any; color: string; "data-testid"?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function RecommendationCard({
  rec,
  onAccept,
  onReject,
  isPending,
}: {
  rec: any;
  onAccept: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [accepted, setAccepted] = useState(false);

  if (dismissed || accepted) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/30 text-xs text-muted-foreground">
        {accepted ? <ThumbsUp className="h-3.5 w-3.5 text-green-500" /> : <X className="h-3.5 w-3.5" />}
        {accepted ? "Recommendation accepted — outcome will be tracked." : "Recommendation dismissed."}
      </div>
    );
  }

  const hasRevenue = rec.estimatedRevenueCents != null || rec.potentialRevenueCents != null;
  const revenueCents = rec.estimatedRevenueCents ?? rec.potentialRevenueCents ?? 0;

  return (
    <div
      className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4"
      data-testid={`rec-card-${rec.type ?? "unknown"}`}
    >
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30 shrink-0">
          <Brain className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-semibold">{rec.title ?? rec.type ?? "Recommendation"}</p>
            {rec.priority && (
              <Badge className={`text-[10px] ${
                rec.priority === "high" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20"
                : rec.priority === "medium" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20"
                : "bg-muted text-muted-foreground"
              }`}>
                {rec.priority}
              </Badge>
            )}
            {rec.confidence != null && (
              <span className="text-[10px] text-muted-foreground">
                {Math.round(rec.confidence * 100)}% confidence
              </span>
            )}
          </div>

          {rec.description && (
            <p className="text-xs text-muted-foreground mb-2">{rec.description}</p>
          )}

          {/* Explainability */}
          {(rec.reason || rec.signal || rec.why) && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5 mb-2">
              <span className="font-medium">Why: </span>
              {rec.reason ?? rec.signal ?? rec.why}
            </div>
          )}

          {/* Financial impact */}
          {hasRevenue && revenueCents > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mb-2">
              <TrendingUp className="h-3 w-3" />
              <span>Est. ${Math.round(revenueCents / 100).toLocaleString()} revenue opportunity</span>
            </div>
          )}

          {/* Downside if ignored */}
          {rec.downsideIfIgnored && (
            <div className="text-xs text-amber-700 dark:text-amber-400 mb-2">
              <span className="font-medium">Risk if ignored: </span>
              {rec.downsideIfIgnored}
            </div>
          )}

          {/* Recommended action */}
          {rec.recommendedAction && (
            <div className="text-xs text-blue-700 dark:text-blue-400 mb-3">
              <span className="font-medium">Next step: </span>
              {rec.recommendedAction}
            </div>
          )}

          {/* Human-in-the-loop controls */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              onClick={() => { setAccepted(true); onAccept(); }}
              disabled={isPending}
              data-testid="button-accept-recommendation"
            >
              <ThumbsUp className="h-3 w-3 mr-1" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => { setDismissed(true); onReject(); }}
              disabled={isPending}
              data-testid="button-reject-recommendation"
            >
              <ThumbsDown className="h-3 w-3 mr-1" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
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

type TabView = "weekly" | "templates" | "intelligence";

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
    queryFn: () => {
      const url = avOrgId ? `/api/coaches?organizationId=${avOrgId}` : "/api/coaches";
      return fetchJson(url);
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
    { key: "intelligence" as TabView, label: "Intelligence", icon: Brain },
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

      {/* ── Workforce Health Banner ── */}
      {!isLoading && <WorkforceHealthBanner blocks={blocks} />}

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
            <tab.icon className={`h-4 w-4 ${tab.key === "intelligence" && activeTab !== "intelligence" ? "text-blue-500" : ""}`} />
            {tab.label}
            {tab.key === "intelligence" && activeTab !== "intelligence" && (
              <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
            )}
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
      ) : activeTab === "templates" ? (
        <TemplatesTab
          activeCoachId={activeCoachId}
          existingBlocks={blocks}
          orgLocations={orgLocations}
        />
      ) : (
        <IntelligenceTab blocks={blocks} />
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
