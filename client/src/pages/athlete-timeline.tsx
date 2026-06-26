import { TrainLogo } from "@/components/train-logo";
import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Trophy, Heart, Zap, MessageSquare,
  TrendingUp, Bell, ArrowLeft, User, BarChart2,
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

const FILTER_OPTS = [
  { value: "all",       label: "All" },
  { value: "workout",   label: "Workouts" },
  { value: "pr",        label: "PRs" },
  { value: "readiness", label: "Readiness" },
  { value: "booking",   label: "Bookings" },
  { value: "message",   label: "Messages" },
  { value: "alert",     label: "Alerts" },
];

function dateHeader(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d, yyyy");
}

function StoryCard({ event }: { event: any }) {
  const cfg = SOURCE_CFG[event.sourceType] ?? SOURCE_CFG.system;
  const meta = event.metadata as any ?? {};
  const isPr = event.sourceType === "pr";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border border-border/30 hover:border-border/60 transition-colors
        ${isPr ? "border-amber-400/20 bg-amber-400/[0.02]" : ""}
      `}
      data-testid={`card-story-event-${event.id}`}
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center gap-1">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
          <cfg.Icon className={`h-4 w-4 ${cfg.color}`} />
        </div>
      </div>
      <div className="flex-1 min-w-0 pb-1">
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
          {meta.improvement && (
            <Badge className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
              +{meta.improvement}%
            </Badge>
          )}
          {meta.readinessScore !== undefined && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              Readiness {meta.readinessScore}/10
            </Badge>
          )}
          {meta.workoutName && (
            <span className="text-[10px] text-muted-foreground">{meta.workoutName}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AthleteTimelinePage() {
  const { slug, userId } = useParams<{ slug: string; userId: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";

  const [sourceFilter, setSourceFilter] = useState("all");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/activity/athlete", userId, slug],
    queryFn: () =>
      fetchJson(`/api/org/activity/athlete/${userId}`, { headers: { "X-Org-Auth-Token": orgToken } }),
  });

  const allEvents: any[] = data?.events ?? [];
  const stats = data?.stats ?? {};

  const filtered = sourceFilter === "all"
    ? allEvents
    : allEvents.filter((e: any) => e.sourceType === sourceFilter);

  const grouped: { date: string; items: any[] }[] = [];
  for (const ev of filtered) {
    const d = new Date(ev.eventDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== key) grouped.push({ date: key, items: [ev] });
    else last.items.push(ev);
  }

  // Get athlete name from first event with it
  const athleteName = allEvents.find((e: any) => (e.metadata as any)?.athleteName)?.metadata?.athleteName
    ?? "Athlete";

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/coach/athletes/${userId}`} data-testid="link-athlete-timeline-back">
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </a>
          <User className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm leading-tight truncate">{athleteName}</h1>
            <p className="text-[10px] text-muted-foreground">Performance Story</p>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Stats cards */}
        {!isLoading && (
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2.5 text-center border-border/30 bg-green-400/[0.04]">
              <TrainLogo className="h-3.5 w-3.5 text-green-400 mx-auto mb-0.5" />
              <p className="text-sm font-bold">{stats.totalCompletions ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Workouts</p>
            </Card>
            <Card className="p-2.5 text-center border-border/30 bg-amber-400/[0.04]">
              <Trophy className="h-3.5 w-3.5 text-amber-400 mx-auto mb-0.5" />
              <p className="text-sm font-bold">{stats.totalPrs ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">PRs</p>
            </Card>
            <Card className="p-2.5 text-center border-border/30 bg-rose-400/[0.04]">
              <Heart className="h-3.5 w-3.5 text-rose-400 mx-auto mb-0.5" />
              <p className="text-sm font-bold">{stats.totalCheckins ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Check-ins</p>
            </Card>
            <Card className="p-2.5 text-center border-border/30 bg-cyan-400/[0.04]">
              <BarChart2 className="h-3.5 w-3.5 text-cyan-400 mx-auto mb-0.5" />
              <p className="text-sm font-bold">{stats.avgReadiness ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">Avg Ready</p>
            </Card>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_OPTS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSourceFilter(opt.value)}
              data-testid={`filter-story-${opt.value}`}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors
                ${sourceFilter === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Timeline */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <User className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No events yet</p>
            <p className="text-sm mt-1">This athlete's performance story will appear here as they train.</p>
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
                  {group.items.map((ev: any) => <StoryCard key={ev.id} event={ev} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
