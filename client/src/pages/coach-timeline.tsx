import { TrainLogo } from "@/components/train-logo";
import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Calendar, Trophy, Heart, Zap, MessageSquare,
  TrendingUp, Bell, ArrowLeft, Search, Activity,
  ChevronDown,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";

const SOURCE_CFG: Record<string, { Icon: any; color: string; bg: string; label: string }> = {
  booking:      { Icon: Calendar,      color: "text-blue-400",   bg: "bg-blue-400/10",    label: "Booking" },
  workout:      { Icon: TrainLogo, color: "text-green-400",  bg: "bg-green-400/10",   label: "Workout" },
  readiness:    { Icon: Heart,         color: "text-rose-400",   bg: "bg-rose-400/10",    label: "Readiness" },
  pr:           { Icon: Trophy,        color: "text-amber-400",  bg: "bg-amber-400/10",   label: "PR" },
  alert:        { Icon: Zap,           color: "text-orange-400", bg: "bg-orange-400/10",  label: "Alert" },
  message:      { Icon: MessageSquare, color: "text-violet-400", bg: "bg-violet-400/10",  label: "Message" },
  intelligence: { Icon: TrendingUp,    color: "text-cyan-400",   bg: "bg-cyan-400/10",    label: "Intelligence" },
  system:       { Icon: Bell,          color: "text-muted-foreground", bg: "bg-muted/30", label: "System" },
};

const SEVERITY_MAP: Record<string, string> = {
  high:     "border-red-500/30 bg-red-500/[0.02]",
  positive: "border-emerald-500/30 bg-emerald-500/[0.02]",
  medium:   "border-orange-500/30 bg-orange-500/[0.02]",
};

const DAY_LABELS = [
  { value: 7,  label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const FILTER_OPTS = [
  { value: "all",         label: "All" },
  { value: "workout",     label: "Workouts" },
  { value: "pr",          label: "PRs" },
  { value: "readiness",   label: "Readiness" },
  { value: "booking",     label: "Bookings" },
  { value: "alert",       label: "Alerts" },
  { value: "message",     label: "Messages" },
  { value: "intelligence",label: "Intelligence" },
];

function dateHeader(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d");
}

function TimelineCard({ event }: { event: any }) {
  const cfg = SOURCE_CFG[event.sourceType] ?? SOURCE_CFG.system;
  const meta = (event.metadata ?? {}) as any;
  const severity = meta.severity as string | undefined;
  const borderClass = severity ? (SEVERITY_MAP[severity] ?? "") : "";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border border-border/30 transition-colors hover:border-border/60 ${borderClass}`}
      data-testid={`card-timeline-event-${event.id}`}
    >
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
        <cfg.Icon className={`h-4 w-4 ${cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug">{event.title}</p>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {format(new Date(event.eventDate), "h:mm a")}
          </span>
        </div>
        {event.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{event.description}</p>
        )}
        <div className="flex items-center flex-wrap gap-2 mt-1.5">
          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${cfg.color} border-current/30`}>
            {cfg.label}
          </Badge>
          {meta.athleteName && (
            <span className="text-[10px] text-muted-foreground">{meta.athleteName}</span>
          )}
          {meta.teamName && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{meta.teamName}</Badge>
          )}
          {severity === "high" && (
            <Badge className="text-[10px] h-4 px-1.5 bg-red-500/15 text-red-400 border-red-500/30">Alert</Badge>
          )}
          {severity === "positive" && (
            <Badge className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Positive</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CoachTimelinePage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";

  const [days, setDays] = useState(14);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/activity/coach/timeline", days, slug],
    queryFn: () => fetchJson(`/api/org/activity/coach/timeline?days=${days}`, { headers: { "X-Org-Auth-Token": orgToken } }),
    refetchInterval: 60000,
  });

  const allEvents: any[] = data?.events ?? [];
  const byType: Record<string, number> = data?.byType ?? {};

  const filtered = allEvents.filter((e) => {
    if (sourceFilter !== "all" && e.sourceType !== sourceFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q) ||
        ((e.metadata as any)?.athleteName ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const grouped: { date: string; items: any[] }[] = [];
  for (const ev of filtered) {
    const d = new Date(ev.eventDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== key) grouped.push({ date: key, items: [ev] });
    else last.items.push(ev);
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/portal`} data-testid="link-timeline-back">
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </a>
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="font-semibold flex-1">Team Timeline</h1>
          {/* Day range selector */}
          <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
            {DAY_LABELS.map((d) => (
              <button
                key={d.value}
                onClick={() => setDays(d.value)}
                data-testid={`button-days-${d.value}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${days === d.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Stats row */}
        {!isLoading && Object.keys(byType).length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(byType).slice(0, 4).map(([type, count]) => {
              const cfg = SOURCE_CFG[type] ?? SOURCE_CFG.system;
              return (
                <Card key={type} className={`p-2.5 text-center border-border/30 ${cfg.bg}`}>
                  <cfg.Icon className={`h-3.5 w-3.5 mx-auto mb-0.5 ${cfg.color}`} />
                  <p className="text-sm font-bold">{count}</p>
                  <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                </Card>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by athlete, event…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            data-testid="input-timeline-search"
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_OPTS.map((opt) => (
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

        {/* Results count */}
        {!isLoading && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {filtered.length} event{filtered.length !== 1 ? "s" : ""} in last {days} days
            </span>
          </div>
        )}

        {/* Timeline */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No activity found</p>
            <p className="text-sm mt-1">Events appear as athletes train, log PRs, and book sessions.</p>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            {grouped.map((group) => (
              <div key={group.date}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {dateHeader(group.date)}
                  </span>
                  <div className="flex-1 h-px bg-border/30" />
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">{group.items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {group.items.map((ev: any) => <TimelineCard key={ev.id} event={ev} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
