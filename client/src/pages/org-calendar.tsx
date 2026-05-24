import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar, Dumbbell, Trophy, Heart, Zap, MessageSquare,
  TrendingUp, Bell, ArrowLeft, ChevronLeft, ChevronRight,
  CalendarDays, List, Clock, Plus, Users, Loader2,
  CalendarPlus, CheckCircle,
} from "lucide-react";
import { format, parseISO, addDays, startOfWeek, isToday, isSameDay } from "date-fns";

// ─── Config ───────────────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, { Icon: any; color: string; bg: string; label: string; actionPath?: string }> = {
  booking:      { Icon: Calendar,      color: "text-blue-400",    bg: "bg-blue-400/10",    label: "Booking",      actionPath: "bookings" },
  workout:      { Icon: Dumbbell,      color: "text-green-400",   bg: "bg-green-400/10",   label: "Workout",      actionPath: "workouts" },
  readiness:    { Icon: Heart,         color: "text-rose-400",    bg: "bg-rose-400/10",    label: "Readiness",    actionPath: "readiness" },
  pr:           { Icon: Trophy,        color: "text-amber-400",   bg: "bg-amber-400/10",   label: "PR",           actionPath: "pr-tracker" },
  alert:        { Icon: Zap,           color: "text-orange-400",  bg: "bg-orange-400/10",  label: "Alert",        actionPath: "athletes" },
  message:      { Icon: MessageSquare, color: "text-violet-400",  bg: "bg-violet-400/10",  label: "Message",      actionPath: "communications" },
  intelligence: { Icon: TrendingUp,    color: "text-cyan-400",    bg: "bg-cyan-400/10",    label: "Intelligence", actionPath: "command-center" },
  system:       { Icon: Bell,          color: "text-muted-foreground", bg: "bg-muted/30",  label: "Note" },
};

const FILTER_OPTIONS = [
  { value: "all",          label: "All" },
  { value: "booking",      label: "Bookings" },
  { value: "workout",      label: "Workouts" },
  { value: "pr",           label: "PRs" },
  { value: "readiness",    label: "Readiness" },
  { value: "alert",        label: "Alerts" },
  { value: "message",      label: "Messages" },
  { value: "intelligence", label: "Intelligence" },
];

const EVENT_TYPE_CONFIG: Record<string, { label: string; Icon: any; color: string; endpoint: string; defaultTitle: string; description: string }> = {
  booking: {
    label: "Booking / Session",
    Icon: Calendar,
    color: "text-blue-400",
    endpoint: "/api/org/calendar/bookings",
    defaultTitle: "Training Session",
    description: "Schedule a 1-on-1 or team training session",
  },
  workout: {
    label: "Workout Assignment",
    Icon: Dumbbell,
    color: "text-green-400",
    endpoint: "/api/org/calendar/workouts",
    defaultTitle: "Workout",
    description: "Assign a workout to an athlete or team",
  },
  message: {
    label: "Message / Outreach",
    Icon: MessageSquare,
    color: "text-violet-400",
    endpoint: "/api/org/calendar/messages",
    defaultTitle: "Check-In",
    description: "Schedule a check-in message or outreach",
  },
  readiness: {
    label: "Readiness Reminder",
    Icon: Heart,
    color: "text-rose-400",
    endpoint: "/api/org/calendar/readiness-reminders",
    defaultTitle: "Readiness Check-In",
    description: "Prompt an athlete to log their daily readiness",
  },
  event: {
    label: "Custom Note",
    Icon: Bell,
    color: "text-muted-foreground",
    endpoint: "/api/org/calendar/events",
    defaultTitle: "Calendar Note",
    description: "Add a custom note or reminder to the calendar",
  },
};

const FILTER_TO_EVENT_TYPE: Record<string, string> = {
  booking:      "booking",
  workout:      "workout",
  message:      "message",
  readiness:    "readiness",
  all:          "event",
  pr:           "event",
  alert:        "event",
  intelligence: "event",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function EventChip({ event, slug, onClick }: { event: any; slug: string; onClick?: () => void }) {
  const cfg = SOURCE_ICONS[event.sourceType] ?? SOURCE_ICONS.system;
  const { Icon, color, bg } = cfg;

  return (
    <div
      className={`flex items-start gap-2.5 p-3 rounded-lg border border-border/40 ${bg} hover:border-border transition-colors cursor-pointer`}
      data-testid={`card-calendar-event-${event.id}`}
      onClick={onClick}
    >
      <div className="h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 bg-background/50">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{event.title}</p>
        {event.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{event.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${color} border-current/20`}>
            {cfg.label}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(event.eventDate), "h:mm a")}
          </span>
        </div>
      </div>
    </div>
  );
}

function WeekDayStrip({ selectedDate, onSelect, events }: { selectedDate: Date; onSelect: (d: Date) => void; events: any[] }) {
  const monday = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const hasEvents = events.some((e) => isSameDay(new Date(e.eventDate), day));
        const isSelected = isSameDay(day, selectedDate);
        const todayDay = isToday(day);
        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelect(day)}
            data-testid={`button-weekday-${format(day, "yyyy-MM-dd")}`}
            className={`flex flex-col items-center gap-1 py-2 rounded-lg transition-colors
              ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}
              ${todayDay && !isSelected ? "ring-1 ring-primary" : ""}`}
          >
            <span className="text-[10px] uppercase font-medium opacity-70">{format(day, "EEE")}</span>
            <span className="text-sm font-bold">{format(day, "d")}</span>
            {hasEvents && (
              <div className={`h-1.5 w-1.5 rounded-full ${isSelected ? "bg-primary-foreground/60" : "bg-primary"}`} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Event Detail Sheet ───────────────────────────────────────────────────────

function EventDetailSheet({ event, slug, onClose }: { event: any; slug: string; onClose: () => void }) {
  const cfg = SOURCE_ICONS[event.sourceType] ?? SOURCE_ICONS.system;
  const { Icon, color, bg } = cfg;

  const actionLinks: { label: string; href: string }[] = [];
  if (cfg.actionPath) {
    actionLinks.push({ label: `Open ${cfg.label}`, href: `/org/${slug}/${cfg.actionPath}` });
  }
  if (event.userId) {
    actionLinks.push({ label: "View Athlete", href: `/org/${slug}/coach/athletes/${event.userId}` });
  }
  if (event.teamId) {
    actionLinks.push({ label: "View Team", href: `/org/${slug}/coach/teams/${event.teamId}` });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${bg}`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <div>
              <DialogTitle className="text-base leading-tight">{event.title}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(event.eventDate), "EEEE, MMM d · h:mm a")}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3">
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={`text-xs ${color} border-current/20`}>{cfg.label}</Badge>
            {event.eventType && (
              <Badge variant="secondary" className="text-xs">{event.eventType.replace(/_/g, " ")}</Badge>
            )}
          </div>
          {actionLinks.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              {actionLinks.map((link) => (
                <a key={link.href} href={link.href}>
                  <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                    {link.label}
                  </Button>
                </a>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Event Modal ───────────────────────────────────────────────────────

function CreateEventModal({
  open,
  onClose,
  defaultType,
  slug,
  orgToken,
}: {
  open: boolean;
  onClose: () => void;
  defaultType: string;
  slug: string;
  orgToken: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [eventType, setEventType]       = useState(defaultType);
  const [date, setDate]                 = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [time, setTime]                 = useState("09:00");
  const [title, setTitle]               = useState("");
  const [notes, setNotes]               = useState("");
  const [targetMode, setTargetMode]     = useState<"athlete" | "team" | "org">("athlete");
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [selectedTeamId, setSelectedTeamId]       = useState("");

  useEffect(() => {
    if (open) {
      setEventType(defaultType);
      setDate(format(new Date(), "yyyy-MM-dd"));
      setTime("09:00");
      setTitle("");
      setNotes("");
      setTargetMode("athlete");
      setSelectedAthleteId("");
      setSelectedTeamId("");
    }
  }, [open, defaultType]);

  const headers = orgToken ? { "X-Org-Auth-Token": orgToken } : {};

  const { data: targets, isLoading: targetsLoading } = useQuery<any>({
    queryKey: ["/api/org/calendar/targets", slug, orgToken],
    queryFn: () => fetch("/api/org/calendar/targets", { headers, credentials: "include" }).then((r) => r.json()),
    enabled: open,
  });

  const isAdmin  = targets?.isAdmin  ?? false;
  const isCoach  = targets?.isCoach  ?? false;
  const athletes = targets?.athletes ?? [];
  const teams    = targets?.teams    ?? [];
  const canTargetOrg = isAdmin;

  const typeCfg = EVENT_TYPE_CONFIG[eventType] ?? EVENT_TYPE_CONFIG.event;

  // Booking-only types need coach or admin
  const coachOnlyTypes = ["workout", "message", "readiness"];
  const canUseType = !coachOnlyTypes.includes(eventType) || isAdmin || isCoach;

  const { mutate: createEvent, isPending } = useMutation({
    mutationFn: async () => {
      const datetime = `${date}T${time}:00`;
      const body: Record<string, any> = {
        title:       title || typeCfg.defaultTitle,
        description: notes || undefined,
        eventDate:   datetime,
      };

      if (eventType === "booking") {
        body.date      = date;
        body.timeSlot  = time;
        body.trainingType = "strength";
        if (targetMode === "team") {
          body.teamId   = selectedTeamId;
          body.teamName = teams.find((t: any) => t.id === selectedTeamId)?.name || "Team";
        } else {
          body.athleteId = selectedAthleteId || undefined;
        }
      } else if (targetMode === "athlete" && selectedAthleteId) {
        body.athleteId = selectedAthleteId;
      } else if (targetMode === "team" && selectedTeamId) {
        body.teamId = selectedTeamId;
      } else if (targetMode === "org") {
        body.orgWide = true;
      }

      const res = await fetch(typeCfg.endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...headers },
        credentials: "include",
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/activity/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["org-activity"] });
      toast({ title: "Event scheduled", description: `${typeCfg.label} added to the calendar.` });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Failed to schedule event", description: e.message, variant: "destructive" });
    },
  });

  const isValid =
    date &&
    time &&
    (targetMode === "org" ||
      (targetMode === "athlete" && (selectedAthleteId || athletes.length === 0)) ||
      (targetMode === "team"    && (selectedTeamId    || teams.length    === 0)));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-primary" /> Schedule Event
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Event type */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event Type</p>
            <div className="grid grid-cols-1 gap-1.5">
              {Object.entries(EVENT_TYPE_CONFIG).map(([key, cfg]) => {
                const restricted = ["workout", "message", "readiness"].includes(key) && !(isAdmin || isCoach);
                return (
                  <button
                    key={key}
                    onClick={() => !restricted && setEventType(key)}
                    disabled={restricted}
                    data-testid={`event-type-${key}`}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors
                      ${eventType === key
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:border-border hover:bg-muted/30"}
                      ${restricted ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <cfg.Icon className={`h-4 w-4 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{cfg.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{cfg.description}</p>
                    </div>
                    {eventType === key && <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date & Time */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date & Time</p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-sm"
                data-testid="input-event-date"
              />
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="text-sm"
                data-testid="input-event-time"
              />
            </div>
          </div>

          {/* Target */}
          {targetsLoading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target</p>

              {/* Mode toggle */}
              {(isAdmin || isCoach) && (
                <div className="flex gap-1 bg-muted/30 rounded-lg p-0.5">
                  {["athlete", "team"].map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTargetMode(mode as any)}
                      data-testid={`target-mode-${mode}`}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize transition-colors
                        ${targetMode === mode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {mode === "athlete" ? "Athlete" : "Team"}
                    </button>
                  ))}
                  {canTargetOrg && (
                    <button
                      onClick={() => setTargetMode("org")}
                      data-testid="target-mode-org"
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors
                        ${targetMode === "org" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Org-wide
                    </button>
                  )}
                </div>
              )}

              {targetMode === "athlete" && athletes.length > 0 && (
                <Select value={selectedAthleteId} onValueChange={setSelectedAthleteId}>
                  <SelectTrigger data-testid="select-athlete-target" className="text-sm">
                    <SelectValue placeholder="Select athlete…" />
                  </SelectTrigger>
                  <SelectContent>
                    {athletes.map((a: any) => (
                      <SelectItem key={a.id} value={a.id} data-testid={`option-athlete-${a.id}`}>
                        {a.name}
                        {a.email ? ` · ${a.email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {targetMode === "team" && teams.length > 0 && (
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger data-testid="select-team-target" className="text-sm">
                    <SelectValue placeholder="Select team…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t: any) => (
                      <SelectItem key={t.id} value={t.id} data-testid={`option-team-${t.id}`}>
                        {t.name}{t.sport ? ` · ${t.sport}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {targetMode === "org" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                  <Users className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span className="text-xs text-primary font-medium">All org members</span>
                </div>
              )}

              {targetMode === "athlete" && athletes.length === 0 && !isAdmin && !isCoach && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
                  <span className="text-xs text-muted-foreground">Targeting yourself</span>
                </div>
              )}

              {targetMode === "team" && teams.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">No teams available. Create a team first.</p>
              )}
            </div>
          )}

          {/* Title & Notes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
            <Input
              placeholder={typeCfg.defaultTitle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm"
              data-testid="input-event-title"
            />
            <Textarea
              placeholder="Notes or description (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm resize-none"
              rows={2}
              data-testid="input-event-notes"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!isValid || isPending}
              onClick={() => createEvent()}
              data-testid="button-schedule-submit"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrgCalendarPage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";

  const [view, setView]               = useState<"today" | "week" | "month" | "list">("week");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showCreate, setShowCreate]   = useState(false);
  const [detailEvent, setDetailEvent] = useState<any>(null);

  const headers = orgToken ? { "X-Org-Auth-Token": orgToken } : {};

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/activity/calendar", view, slug],
    queryFn: () =>
      fetch(`/api/org/activity/calendar?view=${view}`, { headers, credentials: "include" }).then((r) => r.json()),
    refetchInterval: 60000,
  });

  // Prefetch targets so modal opens fast
  const { data: targets } = useQuery<any>({
    queryKey: ["/api/org/calendar/targets", slug, orgToken],
    queryFn: () => fetch("/api/org/calendar/targets", { headers, credentials: "include" }).then((r) => r.json()),
  });

  const isCoachOrAdmin = targets?.isAdmin || targets?.isCoach;

  const allEvents: any[] = data?.events ?? [];
  const filtered = sourceFilter === "all"
    ? allEvents
    : allEvents.filter((e) => e.sourceType === sourceFilter);

  const displayEvents = view === "today"
    ? filtered.filter((e) => isToday(new Date(e.eventDate)))
    : view === "week"
    ? filtered.filter((e) => isSameDay(new Date(e.eventDate), selectedDate))
    : filtered;

  const grouped: { date: string; items: any[] }[] = view === "list"
    ? (data?.grouped ?? []).map((g: any) => ({
        ...g,
        items: g.items.filter((e: any) => sourceFilter === "all" || e.sourceType === sourceFilter),
      })).filter((g: any) => g.items.length > 0)
    : [];

  const defaultCreateType = FILTER_TO_EVENT_TYPE[sourceFilter] ?? "event";

  function EmptyState() {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No events {view === "week" ? "on this day" : "today"}</p>
        {isCoachOrAdmin ? (
          <div className="mt-3">
            <p className="text-sm mb-3">Schedule a session, workout, or message for your athletes.</p>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              data-testid="button-empty-schedule"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Schedule Event
            </Button>
          </div>
        ) : (
          <p className="text-sm mt-1">Events appear as you train, log PRs, and book sessions.</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/portal`} data-testid="link-calendar-back">
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </a>
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="font-semibold flex-1">Calendar</h1>

          {/* View switcher */}
          <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
            {(["today", "week", "month", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                data-testid={`button-view-${v}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors
                  ${view === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Schedule button */}
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="gap-1.5 flex-shrink-0"
            data-testid="button-schedule"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Schedule</span>
          </Button>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSourceFilter(opt.value)}
              data-testid={`filter-${opt.value}`}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors
                ${sourceFilter === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Week strip */}
        {view === "week" && (
          <Card className="p-3">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setSelectedDate((d) => addDays(d, -7))} data-testid="button-prev-week">
                <ChevronLeft className="h-5 w-5 text-muted-foreground hover:text-foreground" />
              </button>
              <span className="text-sm font-medium">
                {format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "MMM d")}
                {" – "}
                {format(addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), 6), "MMM d, yyyy")}
              </span>
              <button onClick={() => setSelectedDate((d) => addDays(d, 7))} data-testid="button-next-week">
                <ChevronRight className="h-5 w-5 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
            <WeekDayStrip selectedDate={selectedDate} onSelect={setSelectedDate} events={filtered} />
          </Card>
        )}

        {/* Today / Month headers */}
        {view === "today" && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{format(new Date(), "EEEE, MMMM d")}</span>
          </div>
        )}
        {view === "month" && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{format(new Date(), "MMMM yyyy")}</span>
            <Badge variant="outline" className="text-xs">{filtered.length} events</Badge>
          </div>
        )}

        {/* Events */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : view === "list" ? (
          grouped.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No events found</p>
              {isCoachOrAdmin ? (
                <div className="mt-3">
                  <p className="text-sm mb-3">Nothing scheduled yet. Add an event to get started.</p>
                  <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-empty-schedule-list">
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Schedule Event
                  </Button>
                </div>
              ) : (
                <p className="text-sm mt-1">Events appear as you train, log PRs, and book sessions.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.date}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {isToday(parseISO(group.date)) ? "Today" : format(parseISO(group.date), "EEEE, MMM d")}
                    </span>
                    <div className="flex-1 h-px bg-border/40" />
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{group.items.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((ev: any) => (
                      <EventChip key={ev.id} event={ev} slug={slug ?? ""} onClick={() => setDetailEvent(ev)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          displayEvents.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-2">
              {displayEvents.map((ev: any) => (
                <EventChip key={ev.id} event={ev} slug={slug ?? ""} onClick={() => setDetailEvent(ev)} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Floating action button (mobile) */}
      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-6 right-5 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all z-40 sm:hidden"
        data-testid="fab-schedule"
        aria-label="Schedule event"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Create modal */}
      <CreateEventModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultType={defaultCreateType}
        slug={slug ?? ""}
        orgToken={orgToken}
      />

      {/* Event detail sheet */}
      {detailEvent && (
        <EventDetailSheet
          event={detailEvent}
          slug={slug ?? ""}
          onClose={() => setDetailEvent(null)}
        />
      )}
    </div>
  );
}
