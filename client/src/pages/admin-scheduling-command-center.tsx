import { Component, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Calendar, Clock, Users, DollarSign, TrendingUp, AlertCircle,
  CheckCircle2, Clock3, BarChart3, ArrowUpRight, Activity, Flame,
  Sparkles, Target, RefreshCw, ChevronRight, Zap, ChevronDown, Lightbulb,
  LayoutDashboard
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";

// Catches render errors in individual panels — prevents one bad panel from
// crashing the whole page and triggering PageErrorBoundary.
class PanelErrorBoundary extends Component<
  { children: React.ReactNode; label?: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; label?: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.label ?? "unknown"}] Render error:`, error);
    console.error("[PanelErrorBoundary] Component stack:", info.componentStack);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

interface CommandCenterData {
  todaySessions: number;
  tomorrowSessions: number;
  todaySessionList: any[];
  tomorrowSessionList: any[];
  openSessionsCount: number;
  fullSessionsCount: number;
  waitlistedSessionsCount: number;
  waitlistedSessions: any[];
  highestRevenueSessions: any[];
  lowestUtilizationSessions: any[];
  coachUtilization: any[];
  weekRevenueCents: number;
  monthRevenueCents: number;
  weekProjectionCents: number;
  monthProjectionCents: number;
  totalUpcomingSessions: number;
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

// ─── Top-3 Opportunity Preview Strip ─────────────────────────────────────────
function OpportunityPreviewStrip() {
  const { data, isLoading } = useQuery<{ opportunities: any[] }>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling-intelligence/opportunities", { credentials: "include" });
      if (!res.ok) return { opportunities: [] };
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const top = (data?.opportunities ?? []).slice(0, 3);
  if (top.length === 0) return null;

  const typeLabel: Record<string, string> = {
    fill_session: "Fill Session",
    recover_cancellation: "Recover",
    waitlist_demand: "Waitlist",
    reactivation: "Re-engage",
  };
  const typeColor: Record<string, string> = {
    fill_session: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
    recover_cancellation: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
    waitlist_demand: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
    reactivation: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20",
  };

  return (
    <div className="rounded-lg border p-3 bg-primary/3" data-testid="opportunity-preview-strip">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Top Opportunities</span>
          <Badge variant="secondary" className="text-xs ml-1">{data?.opportunities?.length ?? 0} total</Badge>
        </div>
        <Link href="/admin/scheduling-opportunity-inbox">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
            View All <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {top.map((opp: any, i: number) => (
          <div key={i} className="flex items-start gap-2 p-2 rounded bg-background/80 border text-xs" data-testid={`opportunity-item-${i}`}>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{opp.title || opp.serviceName || "Opportunity"}</p>
              {opp.revenuePotentialCents > 0 && (
                <p className="text-green-600 dark:text-green-400 mt-0.5">+${Math.round(opp.revenuePotentialCents / 100)}</p>
              )}
            </div>
            <Badge className={`text-[10px] shrink-0 ${typeColor[opp.type] || "bg-muted text-muted-foreground"}`}>
              {typeLabel[opp.type] || opp.type}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function UtilBadge({ pct }: { pct: number }) {
  const color = pct >= 80
    ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20"
    : pct >= 50
    ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
    : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
  return <Badge className={`text-xs ${color}`}>{pct}%</Badge>;
}

function SessionPerformanceScore({ bookingId }: { bookingId: string }) {
  const { data } = useQuery<{ score: number; label: string } | null>({
    queryKey: ["/api/scheduling-intelligence/session-performance", bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling-intelligence/session-performance/${bookingId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 300000,
  });
  if (!data) return null;
  const color = data.score >= 75
    ? "bg-green-500/15 text-green-700 dark:text-green-400"
    : data.score >= 50
    ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
    : "bg-red-500/15 text-red-700 dark:text-red-400";
  return (
    <div className="flex items-center gap-1 mt-0.5">
      <Zap className="h-2.5 w-2.5 text-muted-foreground" />
      <Badge className={`text-[10px] py-0 h-4 ${color}`}>{data.label} · {data.score}</Badge>
    </div>
  );
}

function DemandForecastBadge({ bookingId }: { bookingId: string }) {
  const { data } = useQuery<{ predictedFillPct: number; predictedRevenueCents: number; confidence: string } | null>({
    queryKey: ["/api/scheduling-intelligence/demand-forecast", bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling-intelligence/demand-forecast/${bookingId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 600000,
  });
  if (!data) return null;
  const pct = data.predictedFillPct;
  const rev = data.predictedRevenueCents > 0 ? `$${Math.round(data.predictedRevenueCents / 100)}` : null;
  const confColor = data.confidence === "high" ? "text-green-600 dark:text-green-400"
    : data.confidence === "medium" ? "text-yellow-600 dark:text-yellow-400"
    : "text-muted-foreground";
  return (
    <div className="flex items-center gap-1 mt-0.5" data-testid={`demand-forecast-${bookingId}`}>
      <TrendingUp className="h-2.5 w-2.5 text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground">
        Forecast: <span className="font-medium">{pct}% fill</span>
        {rev && <span> · {rev} exp.</span>}
        {" · "}<span className={`${confColor}`}>{data.confidence} confidence</span>
      </span>
    </div>
  );
}

function SessionRow({ session }: { session: any }) {
  const start = session.start_at ? new Date(session.start_at) : null;
  const reg = parseInt(session.registered_count || 0);
  const max = parseInt(session.max_participants || 6);
  const isFull = reg >= max;

  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-b-0" data-testid={`row-session-${session.id}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{session.service_name || "Session"}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {start && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(start, "h:mm a")}</span>}
          {session.coach_first && <span>· Coach {session.coach_first} {session.coach_last}</span>}
          {session.location && <span>· {session.location}</span>}
        </div>
        {session.id && <SessionPerformanceScore bookingId={session.id} />}
        {session.id && <DemandForecastBadge bookingId={session.id} />}
      </div>
      <div className="text-right shrink-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
          <Users className="h-3 w-3" />
          <span>{reg}/{max}</span>
        </div>
        <Badge className={`text-xs mt-0.5 ${isFull ? "bg-orange-500/15 text-orange-700 dark:text-orange-400" : "bg-green-500/15 text-green-700 dark:text-green-400"}`}>
          {isFull ? "Full" : `${max - reg} left`}
        </Badge>
      </div>
    </div>
  );
}

function RevenueSessionRow({ session }: { session: any }) {
  const rev = parseInt(session.sessionRevenue || 0);
  const maxRev = parseInt(session.maxRevenue || 0);
  const pct = parseInt(session.utilizationPct || 0);
  const start = session.start_at ? new Date(session.start_at) : null;

  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{session.service_name || "Session"}</p>
        {start && <p className="text-xs text-muted-foreground mt-0.5">{format(start, "EEE MMM d · h:mm a")}</p>}
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-sm font-semibold text-primary">{formatMoney(rev)}</p>
        <div className="flex items-center gap-1 justify-end">
          <p className="text-xs text-muted-foreground">{formatMoney(maxRev)} max</p>
          <UtilBadge pct={pct} />
        </div>
      </div>
    </div>
  );
}

interface HealthScore {
  score: number;
  label: string;
  summary: string;
  breakdown: { utilization: number; revenue: number; attendance: number; retention: number; waitlist: number };
  metrics: { avgUtilization: number; revenueCapturePct: number; cancelRate: number; waitlistCount: number; activeSessionsThisWeek: number };
}

interface RevenueRecoveryGap {
  sessionId: string;
  serviceName: string;
  startAt: string;
  openSpots: number;
  lostRevenueCents: number;
  utilizationPct: number;
  isUrgent?: boolean;
  urgencyLabel?: string | null;
  recommendations?: { action: string; rationale: string; impact: string }[];
}

interface RevenueRecovery {
  summary: { totalLostRevenueCents: number; totalRecoverableRevenueCents: number; sessionsWithGaps: number; urgentSessions: number };
  gaps: RevenueRecoveryGap[];
}

function RevenueRecoveryGapCard({ gap }: { gap: RevenueRecoveryGap }) {
  const [expanded, setExpanded] = useState(false);
  const hasRecs = gap.recommendations && gap.recommendations.length > 0;
  const impactColor = (impact: string) =>
    impact === "high" ? "text-red-700 dark:text-red-400" :
    impact === "medium" ? "text-yellow-700 dark:text-yellow-400" : "text-muted-foreground";

  return (
    <div className={`py-2 border-b last:border-b-0 ${gap.isUrgent ? "bg-red-500/5 -mx-1 px-1 rounded" : ""}`}>
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium truncate text-xs">{gap.serviceName}</p>
            {gap.urgencyLabel && (
              <Badge className="text-[10px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 h-4 px-1">{gap.urgencyLabel}</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">{gap.openSpots} open spots · {gap.utilizationPct}% full</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">-${Math.round(gap.lostRevenueCents / 100)}</span>
          {hasRecs && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`btn-expand-recs-${gap.sessionId}`}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      </div>
      {expanded && hasRecs && (
        <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-primary/20">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Lightbulb className="h-3 w-3" />AI Recommendations
          </p>
          {gap.recommendations!.map((rec, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-[11px] font-medium">{rec.action}</p>
              <p className="text-[10px] text-muted-foreground">{rec.rationale} · <span className={impactColor(rec.impact)}>{rec.impact} impact</span></p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthScorePanel() {
  const { data, isLoading } = useQuery<HealthScore>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling-intelligence/health-score", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 120_000,
  });

  if (isLoading) return <Skeleton className="h-36" />;
  // Guard against any API shape — score must be a number, breakdown must exist
  if (!data || typeof data.score !== "number" || !data.breakdown) return null;

  const scoreColor = data.score >= 90 ? "text-green-600 dark:text-green-400" :
                     data.score >= 75 ? "text-blue-600 dark:text-blue-400" :
                     data.score >= 60 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
  const badgeClass = data.score >= 90 ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20" :
                     data.score >= 75 ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20" :
                     data.score >= 60 ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" :
                     "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";

  // Guard each breakdown field individually — API may omit any of these
  const bd = data.breakdown ?? {};
  const factors = [
    { label: "Util",   value: bd.utilization ?? 0 },
    { label: "Rev",    value: bd.revenue     ?? 0 },
    { label: "Attend", value: bd.attendance  ?? 0 },
    { label: "Retain", value: bd.retention   ?? 0 },
    { label: "WL",     value: bd.waitlist    ?? 0 },
  ];

  return (
    <Card className="p-4 space-y-3" data-testid="panel-health-score">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="font-semibold text-sm">Scheduling Health Score</p>
        </div>
        <Link href="/admin/scheduling-copilot">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
            AI Copilot <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <div>
          <span className={`text-4xl font-bold ${scoreColor}`}>{data.score}</span>
          <span className="text-sm text-muted-foreground ml-1">/ 100</span>
        </div>
        <div className="flex-1 space-y-1">
          <Badge className={`text-xs ${badgeClass}`}>{data.label}</Badge>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
        {factors.map(f => {
          const barColor = f.value >= 80 ? "bg-green-500" : f.value >= 60 ? "bg-yellow-500" : "bg-red-500";
          return (
            <div key={f.label} className="space-y-0.5">
              <div className="bg-muted rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${f.value}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground text-center">{f.label} {f.value}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RevenueRecoveryPanel() {
  const { data, isLoading } = useQuery<RevenueRecovery>({
    queryKey: ["/api/scheduling-intelligence/revenue-recovery"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling-intelligence/revenue-recovery", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-36" />;
  // Guard: data.gaps must be an array, data.summary must exist
  const gaps = Array.isArray(data?.gaps) ? data!.gaps : [];
  if (!data || !data.summary || gaps.length === 0) return null;

  const {
    totalLostRevenueCents = 0,
    totalRecoverableRevenueCents = 0,
    sessionsWithGaps = 0,
    urgentSessions = 0,
  } = data.summary;

  return (
    <Card className="p-4 space-y-3" data-testid="panel-revenue-recovery">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-orange-500" />
          <p className="font-semibold text-sm">Revenue Recovery</p>
          {urgentSessions > 0 && (
            <Badge className="text-[10px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 h-4 px-1.5">{urgentSessions} urgent</Badge>
          )}
        </div>
        <Link href="/admin/scheduling-opportunity-inbox">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
            See All <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="bg-muted/40 rounded-lg p-2.5">
          <p className="text-[10px] text-muted-foreground">Revenue Gap</p>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">${Math.round(totalLostRevenueCents / 100).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">{sessionsWithGaps} sessions</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2.5">
          <p className="text-[10px] text-muted-foreground">Recoverable (est.)</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">${Math.round(totalRecoverableRevenueCents / 100).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">with outreach</p>
        </div>
      </div>
      <div>
        {gaps.slice(0, 5).map(g => (
          <RevenueRecoveryGapCard key={g.sessionId} gap={g} />
        ))}
        {urgentSessions > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
            <Lightbulb className="h-3 w-3" />Click the expand arrow on urgent sessions to see AI recovery actions
          </p>
        )}
      </div>
    </Card>
  );
}

export default function AdminSchedulingCommandCenterPage() {
  const { data, isLoading, isError, refetch } = useQuery<CommandCenterData>({
    queryKey: ["/api/scheduling/command-center"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling/command-center", { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="scheduling-dashboard-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6" data-testid="scheduling-dashboard-error">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
              <Flame className="h-6 w-6 text-primary" />
              Scheduling Command Center
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Live operational heartbeat for scheduling across your organization</p>
          </div>
          <Link href="/coach/dashboard">
            <Button variant="outline" size="sm" className="gap-2 shrink-0" data-testid="button-open-scheduling-dashboard">
              <LayoutDashboard className="h-4 w-4" />
              Open Scheduling Dashboard
            </Button>
          </Link>
        </div>
        <Card className="p-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
          <p className="font-semibold">Unable to load command center data</p>
          <p className="text-sm text-muted-foreground">There was a problem fetching scheduling operations data. Please try again.</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => refetch()} className="gap-2" data-testid="button-retry-dashboard">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            <Link href="/coach/dashboard">
              <Button className="gap-2" data-testid="button-go-to-schedule">
                <LayoutDashboard className="h-4 w-4" />
                Go to Scheduling Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Defensive defaults — never crash on missing/empty arrays
  const d: CommandCenterData = {
    todaySessions: data?.todaySessions ?? 0,
    tomorrowSessions: data?.tomorrowSessions ?? 0,
    todaySessionList: data?.todaySessionList ?? [],
    tomorrowSessionList: data?.tomorrowSessionList ?? [],
    openSessionsCount: data?.openSessionsCount ?? 0,
    fullSessionsCount: data?.fullSessionsCount ?? 0,
    waitlistedSessionsCount: data?.waitlistedSessionsCount ?? 0,
    waitlistedSessions: data?.waitlistedSessions ?? [],
    highestRevenueSessions: data?.highestRevenueSessions ?? [],
    lowestUtilizationSessions: data?.lowestUtilizationSessions ?? [],
    coachUtilization: data?.coachUtilization ?? [],
    weekRevenueCents: data?.weekRevenueCents ?? 0,
    monthRevenueCents: data?.monthRevenueCents ?? 0,
    weekProjectionCents: data?.weekProjectionCents ?? 0,
    monthProjectionCents: data?.monthProjectionCents ?? 0,
    totalUpcomingSessions: data?.totalUpcomingSessions ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Flame className="h-6 w-6 text-primary" />
            Scheduling Command Center
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Live operational heartbeat for scheduling across your organization</p>
        </div>
        <Link href="/coach/dashboard">
          <Button variant="outline" size="sm" className="gap-2 shrink-0" data-testid="button-open-scheduling-dashboard">
            <LayoutDashboard className="h-4 w-4" />
            Open Scheduling Dashboard
          </Button>
        </Link>
      </div>

      {/* Session Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Today", value: d.todaySessions, icon: Calendar, color: "text-primary", sub: "sessions" },
          { label: "Tomorrow", value: d.tomorrowSessions, icon: Calendar, color: "text-muted-foreground", sub: "sessions" },
          { label: "Open", value: d.openSessionsCount, icon: CheckCircle2, color: "text-green-600 dark:text-green-400", sub: "need registrations" },
          { label: "Full", value: d.fullSessionsCount, icon: Users, color: "text-orange-600 dark:text-orange-400", sub: "at capacity" },
          { label: "Waitlisted", value: d.waitlistedSessionsCount, icon: Clock3, color: "text-blue-600 dark:text-blue-400", sub: "have waitlists" },
        ].map(stat => (
          <Card key={stat.label} className="p-4 text-center space-y-1" data-testid={`stat-${stat.label.toLowerCase()}`}>
            <stat.icon className={`h-5 w-5 mx-auto ${stat.color}`} />
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-muted-foreground leading-tight">{stat.label}<br />{stat.sub}</p>
          </Card>
        ))}
      </div>

      {/* Revenue Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Week Revenue", value: formatMoney(d.weekRevenueCents), sub: "actual this week", icon: DollarSign },
          { label: "Week Projection", value: formatMoney(d.weekProjectionCents), sub: "projected at current pace", icon: TrendingUp },
          { label: "Month Revenue", value: formatMoney(d.monthRevenueCents), sub: "actual this month", icon: DollarSign },
          { label: "Month Projection", value: formatMoney(d.monthProjectionCents), sub: "projected at current pace", icon: ArrowUpRight },
        ].map(card => (
          <Card key={card.label} className="p-4" data-testid={`revenue-${card.label.toLowerCase().replace(/ /g, "-")}`}>
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <card.icon className="h-3.5 w-3.5" />
              <span className="text-xs">{card.label}</span>
            </div>
            <p className="text-xl font-bold">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
          </Card>
        ))}
      </div>

      {/* Opportunity Preview Strip */}
      <OpportunityPreviewStrip />

      {/* Intelligence Row — Health Score + Revenue Recovery */}
      <div className="grid md:grid-cols-2 gap-4">
        <PanelErrorBoundary label="HealthScore">
          <HealthScorePanel />
        </PanelErrorBoundary>
        <PanelErrorBoundary label="RevenueRecovery">
          <RevenueRecoveryPanel />
        </PanelErrorBoundary>
      </div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Today's Sessions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm">Today's Sessions</p>
            <Badge variant="secondary" className="ml-auto text-xs">{d.todaySessionList.length}</Badge>
          </div>
          {d.todaySessionList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No sessions today</p>
          ) : (
            d.todaySessionList.map(s => <SessionRow key={s.id} session={s} />)
          )}
        </Card>

        {/* Tomorrow's Sessions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <p className="font-semibold text-sm">Tomorrow's Sessions</p>
            <Badge variant="secondary" className="ml-auto text-xs">{d.tomorrowSessionList.length}</Badge>
          </div>
          {d.tomorrowSessionList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No sessions tomorrow</p>
          ) : (
            d.tomorrowSessionList.map(s => <SessionRow key={s.id} session={s} />)
          )}
        </Card>

        {/* Waitlisted Sessions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock3 className="h-4 w-4 text-blue-500" />
            <p className="font-semibold text-sm">Waitlisted Sessions</p>
            <Badge className="ml-auto text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400">{d.waitlistedSessionsCount}</Badge>
          </div>
          {d.waitlistedSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No sessions have waitlists</p>
          ) : (
            d.waitlistedSessions.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                <div>
                  <p className="text-sm font-medium truncate">{s.service_name || "Session"}</p>
                  <p className="text-xs text-muted-foreground">{s.start_at ? format(new Date(s.start_at), "MMM d · h:mm a") : ""}</p>
                </div>
                <Badge className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400 shrink-0">
                  {s.waitlistCount} waiting
                </Badge>
              </div>
            ))
          )}
        </Card>

        {/* Highest Revenue Sessions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-green-500" />
            <p className="font-semibold text-sm">Highest Revenue Sessions</p>
          </div>
          {d.highestRevenueSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No upcoming sessions</p>
          ) : (
            d.highestRevenueSessions.map((s: any) => <RevenueSessionRow key={s.id} session={s} />)
          )}
        </Card>

        {/* Lowest Utilization */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="font-semibold text-sm">Lowest Utilization</p>
            <span className="text-xs text-muted-foreground ml-1">(needs attention)</span>
          </div>
          {d.lowestUtilizationSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No upcoming sessions</p>
          ) : (
            d.lowestUtilizationSessions.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 py-2 border-b last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.service_name || "Session"}</p>
                  {s.start_at && <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(s.start_at), "EEE MMM d · h:mm a")}</p>}
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <UtilBadge pct={s.utilizationPct || 0} />
                  <p className="text-xs text-muted-foreground">
                    {parseInt(s.registered_count || 0)}/{parseInt(s.max_participants || 6)}
                  </p>
                </div>
              </div>
            ))
          )}
        </Card>

        {/* Coach Utilization */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <p className="font-semibold text-sm">Coach Utilization</p>
            <span className="text-xs text-muted-foreground ml-1">(this week)</span>
          </div>
          {d.coachUtilization.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No coach data</p>
          ) : (
            <div className="space-y-3">
              {d.coachUtilization.map((c: any) => {
                const util = Math.min(100, c.utilizationPct || 0);
                const barColor = util >= 80 ? "bg-green-500" : util >= 50 ? "bg-yellow-500" : "bg-red-500";
                return (
                  <div key={c.coachId} className="space-y-1" data-testid={`coach-util-${c.coachId}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[140px]">{c.name || "Coach"}</span>
                      <span className="text-muted-foreground">{c.bookedHours}h · {c.sessionCount} sessions</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${util}%` }} />
                      </div>
                      <span className="text-xs font-semibold w-8 text-right">{util}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs text-muted-foreground text-right">Auto-refreshes every 60 seconds · {format(new Date(), "h:mm a")}</p>
    </div>
  );
}
