import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Dumbbell, Trophy, Heart, Zap, MessageSquare,
  TrendingUp, Bell, ArrowLeft, ChevronLeft, ChevronRight,
  Filter, CalendarDays, List, Clock,
} from "lucide-react";
import { format, parseISO, addDays, startOfWeek, isToday, isSameDay } from "date-fns";

const SOURCE_ICONS: Record<string, any> = {
  booking:      { Icon: Calendar,      color: "text-blue-400",    bg: "bg-blue-400/10",    label: "Booking" },
  workout:      { Icon: Dumbbell,      color: "text-green-400",   bg: "bg-green-400/10",   label: "Workout" },
  readiness:    { Icon: Heart,         color: "text-rose-400",    bg: "bg-rose-400/10",    label: "Readiness" },
  pr:           { Icon: Trophy,        color: "text-amber-400",   bg: "bg-amber-400/10",   label: "PR" },
  alert:        { Icon: Zap,           color: "text-orange-400",  bg: "bg-orange-400/10",  label: "Alert" },
  message:      { Icon: MessageSquare, color: "text-violet-400",  bg: "bg-violet-400/10",  label: "Message" },
  intelligence: { Icon: TrendingUp,    color: "text-cyan-400",    bg: "bg-cyan-400/10",    label: "Intelligence" },
  system:       { Icon: Bell,          color: "text-muted-foreground", bg: "bg-muted/30",  label: "System" },
};

const FILTER_OPTIONS = [
  { value: "all",         label: "All" },
  { value: "booking",     label: "Bookings" },
  { value: "workout",     label: "Workouts" },
  { value: "pr",          label: "PRs" },
  { value: "readiness",   label: "Readiness" },
  { value: "alert",       label: "Alerts" },
  { value: "message",     label: "Messages" },
  { value: "intelligence",label: "Intelligence" },
];

function EventChip({ event }: { event: any }) {
  const cfg = SOURCE_ICONS[event.sourceType] ?? SOURCE_ICONS.system;
  const { Icon, color, bg } = cfg;
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-lg border border-border/40 ${bg} hover:border-border transition-colors`}
         data-testid={`card-calendar-event-${event.id}`}>
      <div className={`h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 bg-background/50`}>
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
              ${todayDay && !isSelected ? "ring-1 ring-primary" : ""}
            `}
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

export default function OrgCalendarPage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";

  const [view, setView] = useState<"today" | "week" | "month" | "list">("week");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/activity/calendar", view, slug],
    queryFn: () =>
      fetch(`/api/org/activity/calendar?view=${view}`, {
        headers: { "X-Org-Auth-Token": orgToken },
      }).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const allEvents: any[] = data?.events ?? [];
  const filtered = sourceFilter === "all"
    ? allEvents
    : allEvents.filter((e) => e.sourceType === sourceFilter);

  // For week/today view, also filter by selected date
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

  return (
    <div className="min-h-screen bg-background pb-16">
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

        {/* Week strip (week view) */}
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

        {/* Today header */}
        {view === "today" && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{format(new Date(), "EEEE, MMMM d")}</span>
          </div>
        )}

        {/* Month header */}
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
              <p className="text-sm mt-1">Events appear as you train, log PRs, and book sessions.</p>
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
                    {group.items.map((ev: any) => <EventChip key={ev.id} event={ev} />)}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          displayEvents.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No events {view === "week" ? "on this day" : "today"}</p>
              <p className="text-sm mt-1">Events appear as you train, log PRs, and book sessions.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayEvents.map((ev: any) => <EventChip key={ev.id} event={ev} />)}
            </div>
          )
        )}
      </div>
    </div>
  );
}
