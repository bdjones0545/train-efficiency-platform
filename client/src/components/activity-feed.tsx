import { TrainLogo } from "@/components/train-logo";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, MessageSquare, Trophy, Heart, Zap, TrendingUp, Bell,
  BookOpen, GitBranch, Users, Activity,
} from "lucide-react";

// ─── Source config (mirrors server/services/activity-timeline.ts) ─────────────

const SOURCE_CONFIG: Record<string, { color: string; bgColor: string; icon: any; label: string }> = {
  booking:      { color: "text-blue-400",    bgColor: "bg-blue-500/10",    icon: Calendar,      label: "Booking" },
  workout:      { color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: TrainLogo, label: "Workout" },
  readiness:    { color: "text-rose-400",    bgColor: "bg-rose-500/10",    icon: Heart,         label: "Readiness" },
  pr:           { color: "text-amber-400",   bgColor: "bg-amber-500/10",   icon: Trophy,        label: "PR" },
  alert:        { color: "text-orange-400",  bgColor: "bg-orange-500/10",  icon: Zap,           label: "Alert" },
  message:      { color: "text-violet-400",  bgColor: "bg-violet-500/10",  icon: MessageSquare, label: "Message" },
  intelligence: { color: "text-cyan-400",    bgColor: "bg-cyan-500/10",    icon: TrendingUp,    label: "Intel" },
  education:    { color: "text-indigo-400",  bgColor: "bg-indigo-500/10",  icon: BookOpen,      label: "Education" },
  workflow:     { color: "text-teal-400",    bgColor: "bg-teal-500/10",    icon: GitBranch,     label: "Workflow" },
  team:         { color: "text-sky-400",     bgColor: "bg-sky-500/10",     icon: Users,         label: "Team" },
  system:       { color: "text-muted-foreground", bgColor: "bg-muted/20", icon: Bell,           label: "System" },
};

// ─── Source label mapping (from navigateWithContext source params) ─────────────

const ACTION_SOURCE_LABELS: Record<string, string> = {
  "athlete-status":        "From Athlete Status",
  "command-center":        "From Command Center",
  "pr-tracker":            "From PR Tracker",
  "workout-builder":       "From Workout Builder",
  "communications-center": "From Comms Center",
  "team-detail":           "From Team Detail",
};

// ─── Time formatting ──────────────────────────────────────────────────────────

function timeAgo(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ActivityFeedProps {
  athleteId?: string;
  teamId?: string;
  compact?: boolean;
  limit?: number;
  days?: number;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActivityFeed({
  athleteId,
  teamId,
  compact = false,
  limit = 20,
  days = 14,
  className = "",
}: ActivityFeedProps) {
  let url: string;
  let cacheKey: string;

  if (athleteId) {
    url = `/api/org/activity/athlete/${athleteId}?limit=${limit}`;
    cacheKey = `athlete-${athleteId}`;
  } else if (teamId) {
    url = `/api/org/activity/events?teamId=${teamId}&limit=${limit}`;
    cacheKey = `team-${teamId}`;
  } else {
    url = `/api/org/activity/coach/timeline?days=${days}&limit=${limit}`;
    cacheKey = `timeline-${days}`;
  }

  const { data, isLoading } = useQuery<{ events: any[] }>({
    queryKey: ["org-activity", cacheKey, limit],
    queryFn: () => fetchJson(url),
    staleTime: 30_000,
  });

  const events: any[] = data?.events ?? [];

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`} data-testid="activity-feed-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-muted/5 border border-border/30 animate-pulse">
            <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={`flex flex-col items-center gap-2 py-8 text-center ${className}`} data-testid="activity-feed-empty">
        <Activity className="h-8 w-8 text-muted-foreground/25" />
        <p className="text-xs text-muted-foreground">No activity yet — actions across the platform will appear here.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`} data-testid="activity-feed">
      {events.map((ev: any) => {
        const cfg = SOURCE_CONFIG[ev.sourceType as string] ?? SOURCE_CONFIG.system;
        const Icon = cfg.icon;
        const meta = (ev.metadata ?? {}) as Record<string, any>;
        const actionSource = meta.actionSource ?? meta.source ?? null;
        const sourceLabel = actionSource ? (ACTION_SOURCE_LABELS[actionSource] ?? null) : null;

        return (
          <div
            key={ev.id}
            data-testid={`activity-event-${ev.id}`}
            className={`flex items-start gap-2.5 px-3 rounded-lg border border-border/30 bg-card/50 hover:bg-muted/5 transition-colors ${compact ? "py-1.5" : "py-2.5"}`}
          >
            <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bgColor}`}>
              <Icon className={`h-2.5 w-2.5 ${cfg.color}`} />
            </div>

            <div className="flex-1 min-w-0">
              <p className={`font-medium leading-tight truncate ${compact ? "text-[11px]" : "text-xs"}`}>{ev.title}</p>
              {!compact && ev.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{ev.description}</p>
              )}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground/60">{timeAgo(ev.eventDate)}</span>
                {sourceLabel && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5 border-muted/40 text-muted-foreground/60 font-normal">
                    {sourceLabel}
                  </Badge>
                )}
              </div>
            </div>

            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${cfg.bgColor} ${cfg.color}`}>
              {cfg.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
