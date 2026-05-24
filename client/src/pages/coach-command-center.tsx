import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { navigateWithContext } from "@/lib/navigateWithContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { ActivityFeed } from "@/components/activity-feed";
import { InterventionPriorityQueue } from "@/components/intervention-priority-queue";
import { InterventionEffectivenessDashboard } from "@/components/intervention-effectiveness-dashboard";
import { OrgHealthOverview } from "@/components/org-health-overview";
import { DailyOperationsPanel } from "@/components/daily-operations-panel";
import { EventStreamPanel } from "@/components/event-stream-panel";
import {
  Brain,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Users,
  Activity,
  BookOpen,
  Star,
  Clock,
  ChevronRight,
  Loader2,
  Flame,
  Target,
  BarChart3,
  ListChecks,
  Sparkles,
  ArrowRight,
  Circle,
  MessageSquare,
  Dumbbell,
  UserCircle,
} from "lucide-react";

// ─── Auth helper ─────────────────────────────────────────────────────────────

function getOrgToken(orgId: string): string | null {
  return localStorage.getItem(`orgToken_${orgId}`);
}

function getHeaders(orgToken: string | null, authHeaders: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };
  if (orgToken) h["X-Org-Auth-Token"] = orgToken;
  return h;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function riskColor(level: string) {
  if (level === "red") return "text-rose-400";
  if (level === "yellow") return "text-amber-400";
  return "text-emerald-400";
}

function riskBg(level: string) {
  if (level === "red") return "bg-rose-500/10 border-rose-500/25";
  if (level === "yellow") return "bg-amber-500/10 border-amber-500/25";
  return "bg-emerald-500/10 border-emerald-500/25";
}

function urgencyBadgeClass(urgency: string) {
  if (urgency === "high") return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  if (urgency === "medium") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

function severityDot(severity: string) {
  if (severity === "high" || severity === "critical") return "bg-rose-400";
  if (severity === "medium" || severity === "moderate") return "bg-amber-400";
  return "bg-emerald-400";
}

function scoreColor(score: number) {
  if (score >= 65) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#f43f5e";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={4} fill="none" className="text-muted/20" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={4} fill="none"
        strokeDasharray={circ} strokeDashoffset={fill}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={size < 50 ? 10 : 12} fontWeight="700" fill={color}>
        {score}
      </text>
    </svg>
  );
}

function StatPill({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-muted/20 border border-border/40">
      <span className={`text-lg font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary flex-shrink-0" />
      <h3 className="text-sm font-semibold tracking-wide uppercase text-foreground/80">{title}</h3>
      {count !== undefined && (
        <Badge className="ml-auto text-[10px] px-1.5 py-0 h-4 bg-primary/15 text-primary border-primary/30">{count}</Badge>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-3 px-3 rounded-lg bg-muted/10 border border-dashed border-border/40">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
      <span className="text-xs text-muted-foreground">{message}</span>
    </div>
  );
}

// ─── Heatmap Grid ─────────────────────────────────────────────────────────────

function AthleteHeatmap({ snapshots }: { snapshots: any[] }) {
  if (!snapshots || snapshots.length === 0) {
    return <EmptyState message="No athlete data available yet." />;
  }
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="grid-athlete-heatmap">
      {snapshots.map((s, i) => (
        <div
          key={s.id ?? i}
          title={`${s.athleteName}: ${s.statusScore} (${s.riskLevel})`}
          data-testid={`cell-heatmap-${s.athleteUserId}`}
          className={`h-7 w-7 rounded-md border text-[9px] font-bold flex items-center justify-center cursor-default transition-opacity hover:opacity-80 ${riskBg(s.riskLevel)} ${riskColor(s.riskLevel)}`}
        >
          {(s.athleteName?.[0] ?? "?").toUpperCase()}
        </div>
      ))}
    </div>
  );
}

// ─── AI Briefing Block ────────────────────────────────────────────────────────

function AIBriefingPanel({ briefing, isLoading, onRegenerate, isPending }: {
  briefing: any | null;
  isLoading: boolean;
  onRegenerate: () => void;
  isPending: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-6 px-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading briefing…</span>
      </div>
    );
  }

  const content = briefing?.briefing;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight">Today's AI Briefing</span>
          {briefing?.generatedAt && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRegenerate}
          disabled={isPending}
          data-testid="button-regenerate-briefing"
          className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {isPending ? "Generating…" : "Regenerate"}
        </Button>
      </div>

      {!content ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Brain className="h-8 w-8 text-primary/40" />
          <p className="text-sm text-muted-foreground">No briefing generated yet for today.</p>
          <Button
            onClick={onRegenerate}
            disabled={isPending}
            data-testid="button-generate-first-briefing"
            className="gap-2"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Today's Briefing
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Top Priorities */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-xs uppercase tracking-wide">
              <AlertTriangle className="h-3.5 w-3.5" />
              Top Priorities
            </div>
            <ul className="space-y-1.5">
              {(content.topPriorities ?? []).map((p: string, i: number) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* Positive Wins */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs uppercase tracking-wide">
              <Star className="h-3.5 w-3.5" />
              Positive Wins
            </div>
            <ul className="space-y-1.5">
              {(content.positiveWins ?? []).map((w: string, i: number) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </div>

          {/* Recommended Actions */}
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-xs uppercase tracking-wide">
              <Target className="h-3.5 w-3.5" />
              Recommended Actions
            </div>
            <ul className="space-y-1.5">
              {(content.recommendedActions ?? []).map((a: any, i: number) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${severityDot(a.urgency)}`} />
                  {a.action}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {content?.summary && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
          <Brain className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-foreground/70 italic">{content.summary}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoachCommandCenterPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, "pending" | "done" | "snoozed">>({});

  // Centralized permissions — resolves role via OIDC session, Bearer token, or org token
  const permissions = usePermissions(slug);

  // Resolve orgId and optional org-specific token from nav-context
  const { data: navCtx } = useQuery<{ orgId: string; effectiveRole: string | null }>({
    queryKey: [`/api/org/by-slug/${slug}/nav-context`],
    queryFn: () =>
      fetch(`/api/org/by-slug/${slug}/nav-context`, {
        headers: getAuthHeaders(),
        credentials: "include",
      }).then((r) => r.json()),
  });

  useEffect(() => {
    if (navCtx?.orgId) {
      setOrgId(navCtx.orgId);
      const tok = getOrgToken(navCtx.orgId);
      setOrgToken(tok);
    }
  }, [navCtx?.orgId]);

  // Build request headers: always include platform auth, optionally org token
  const headers = getHeaders(orgToken, getAuthHeaders());

  // Enable query as soon as we have orgId and the user has permission
  // (orgToken not required — backend now accepts OIDC/Bearer auth too)
  const hasAccess = !permissions.isLoading && permissions.canAccessCommandCenter;

  // Fetch command center data
  const {
    data,
    isLoading,
    refetch,
  } = useQuery<{ commandCenter: any; briefing: any | null; briefingGeneratedAt: string | null }>({
    queryKey: [`/api/org/command-center`, orgId],
    queryFn: () =>
      fetch("/api/org/command-center", { headers, credentials: "include" }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    enabled: !!orgId && hasAccess,
    refetchInterval: 60_000,
  });

  // Regenerate briefing
  const regenerateMutation = useMutation({
    mutationFn: () =>
      fetch("/api/org/command-center/regenerate-briefing", {
        method: "POST",
        headers,
        credentials: "include",
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: "Briefing updated", description: "Today's AI briefing has been regenerated." });
      queryClient.invalidateQueries({ queryKey: [`/api/org/command-center`, orgId] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message ?? "Failed to generate briefing.", variant: "destructive" });
    },
  });

  const cc = data?.commandCenter;
  const briefing = data?.briefing;

  const toggleTask = (taskKey: string) => {
    setTaskStatuses((prev) => ({
      ...prev,
      [taskKey]: prev[taskKey] === "done" ? "pending" : "done",
    }));
  };

  const snoozeTask = (taskKey: string) => {
    setTaskStatuses((prev) => ({ ...prev, [taskKey]: "snoozed" }));
  };

  // Show loading state during auth hydration to prevent permission flicker
  if (permissions.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Only block if permissions are fully loaded and access is denied
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="p-8 text-center max-w-sm">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Access Required</p>
          <p className="text-sm text-muted-foreground">
            You need coach, staff, or admin access to view the Command Center.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10" data-testid="page-coach-command-center">
      {/* ── Page Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="text-command-center-title">
            <Zap className="h-5 w-5 text-primary" />
            Coach Command Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          data-testid="button-refresh-command-center"
          className="h-8 gap-1.5 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* ── Quick Stats ───────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading command center data…
        </div>
      ) : cc ? (
        <div className="flex flex-wrap gap-2" data-testid="section-quick-stats">
          <StatPill label="Athletes" value={cc.totalAthletes} />
          <StatPill label="Avg Score" value={cc.avgStatusScore} color={cc.avgStatusScore >= 65 ? "text-emerald-400" : cc.avgStatusScore >= 40 ? "text-amber-400" : "text-rose-400"} />
          <StatPill label="Avg Readiness" value={`${cc.avgReadiness}%`} color={cc.avgReadiness >= 70 ? "text-emerald-400" : cc.avgReadiness >= 50 ? "text-amber-400" : "text-rose-400"} />
          <StatPill label="On Track" value={cc.riskOverview.green} color="text-emerald-400" />
          <StatPill label="Monitor" value={cc.riskOverview.yellow} color="text-amber-400" />
          <StatPill label="Attention" value={cc.riskOverview.red} color="text-rose-400" />
          <StatPill label="PRs This Week" value={cc.weekPRs} color="text-blue-400" />
          <StatPill label="Edu Compliance" value={`${cc.educationComplianceRate}%`} color={cc.educationComplianceRate >= 70 ? "text-emerald-400" : "text-amber-400"} />
          {cc.prioritySummary?.critical > 0 && (
            <StatPill label="Critical" value={cc.prioritySummary.critical} color="text-red-400" />
          )}
          {cc.prioritySummary?.high > 0 && (
            <StatPill label="High Priority" value={cc.prioritySummary.high} color="text-orange-400" />
          )}
        </div>
      ) : null}

      {/* ── AI Briefing ───────────────────────────────────────────────── */}
      <Card className="p-4 border-primary/20 bg-card" data-testid="section-ai-briefing">
        <AIBriefingPanel
          briefing={briefing}
          isLoading={isLoading}
          onRegenerate={() => regenerateMutation.mutate()}
          isPending={regenerateMutation.isPending}
        />
      </Card>

      {/* ── Main Grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Athlete Risk Overview */}
        <Card className="p-4" data-testid="section-athlete-risk-overview">
          <SectionHeader icon={ShieldAlert} title="Athlete Risk Overview" count={cc?.riskFlags?.length} />
          <div className="flex gap-4 mb-3">
            <div className="flex items-center gap-1.5 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="font-semibold text-emerald-400">{cc?.riskOverview.green ?? 0}</span>
              <span className="text-muted-foreground text-xs">On Track</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Shield className="h-4 w-4 text-amber-400" />
              <span className="font-semibold text-amber-400">{cc?.riskOverview.yellow ?? 0}</span>
              <span className="text-muted-foreground text-xs">Monitor</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <ShieldAlert className="h-4 w-4 text-rose-400" />
              <span className="font-semibold text-rose-400">{cc?.riskOverview.red ?? 0}</span>
              <span className="text-muted-foreground text-xs">Attention</span>
            </div>
          </div>

          {/* Highest risk athletes */}
          <div className="space-y-1.5">
            {(cc?.highestRiskAthletes ?? []).length === 0 ? (
              <EmptyState message="All athletes are on track — great coaching!" />
            ) : (
              (cc?.highestRiskAthletes ?? []).map((a: any, i: number) => (
                <div
                  key={a.id ?? i}
                  data-testid={`row-risk-athlete-${a.athleteUserId}`}
                  className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${riskBg(a.riskLevel)}`}
                >
                  <ScoreRing score={a.statusScore ?? 0} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{a.athleteName}</p>
                    <p className={`text-[10px] capitalize ${riskColor(a.riskLevel)}`}>{a.riskLevel === "red" ? "Needs Attention" : "Monitor"}</p>
                    <div className="flex gap-1 mt-1.5">
                      <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 gap-0.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        data-testid={`button-message-risk-${a.athleteUserId}`}
                        onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: a.athleteUserId, source: "command-center" })}>
                        <MessageSquare className="h-2.5 w-2.5" />Message
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 gap-0.5 text-muted-foreground hover:text-foreground"
                        data-testid={`button-profile-risk-${a.athleteUserId}`}
                        onClick={() => setLocation(`/org/${slug}/coach/athletes/${a.athleteUserId}`)}>
                        <UserCircle className="h-2.5 w-2.5" />Profile
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground flex-shrink-0">
                    {a.readinessScore != null && <span>R: {a.readinessScore}</span>}
                    {a.adherenceScore != null && <span>A: {a.adherenceScore}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Today's Alerts */}
        <Card className="p-4" data-testid="section-todays-alerts">
          <SectionHeader icon={AlertTriangle} title="Today's Alerts" count={(cc?.activeRiskFlagCount ?? 0) + (cc?.lowReadinessAthleteCount ?? 0)} />
          <div className="space-y-2">
            {cc?.lowReadinessAthleteCount > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20" data-testid="alert-low-readiness">
                <Activity className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-300">{cc.lowReadinessAthleteCount} athlete{cc.lowReadinessAthleteCount !== 1 ? "s" : ""} with low readiness scores</p>
                  <p className="text-[10px] text-muted-foreground">Check recovery & workload this week</p>
                </div>
              </div>
            )}
            {cc?.inactiveAthleteCount > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-rose-500/8 border border-rose-500/20" data-testid="alert-inactive-athletes">
                <Users className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-rose-300">{cc.inactiveAthleteCount} athlete{cc.inactiveAthleteCount !== 1 ? "s" : ""} with no workouts in 7 days</p>
                  <p className="text-[10px] text-muted-foreground">Consider follow-up or re-engagement</p>
                </div>
              </div>
            )}
            {(cc?.riskFlags ?? []).slice(0, 4).map((flag: any, i: number) => (
              <div
                key={flag.id ?? i}
                data-testid={`alert-risk-flag-${flag.id}`}
                className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-muted/10 border border-border/40"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${severityDot(flag.severity)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{flag.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{flag.summary}</p>
                </div>
                <Badge className={`text-[9px] px-1 py-0 h-4 capitalize flex-shrink-0 ${urgencyBadgeClass(flag.severity)}`}>
                  {flag.severity}
                </Badge>
              </div>
            ))}
            {!cc?.activeRiskFlagCount && !cc?.lowReadinessAthleteCount && !cc?.inactiveAthleteCount && (
              <EmptyState message="No active alerts — all systems look good." />
            )}
          </div>
        </Card>

        {/* Team Readiness Heatmap */}
        <Card className="p-4" data-testid="section-heatmap">
          <SectionHeader icon={BarChart3} title="Team Readiness Heatmap" count={cc?.allSnapshots?.length} />
          <div className="mb-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/40 inline-block" />On Track</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/30 border border-amber-500/40 inline-block" />Monitor</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500/30 border border-rose-500/40 inline-block" />Attention</span>
          </div>
          {isLoading ? (
            <div className="flex gap-1 flex-wrap">
              {[...Array(12)].map((_, i) => <div key={i} className="h-7 w-7 rounded-md bg-muted/30 animate-pulse" />)}
            </div>
          ) : (
            <AthleteHeatmap snapshots={cc?.allSnapshots ?? []} />
          )}
        </Card>

        {/* Intervention Queue */}
        <Card className="p-4" data-testid="section-intervention-queue">
          <SectionHeader icon={ListChecks} title="Intervention Queue" count={cc?.pendingInterventionCount} />
          <div className="space-y-1.5">
            {(cc?.interventions ?? []).length === 0 ? (
              <EmptyState message="No pending interventions." />
            ) : (
              (cc?.interventions ?? []).slice(0, 5).map((intv: any, i: number) => (
                <div
                  key={intv.id ?? i}
                  data-testid={`row-intervention-${intv.id}`}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-muted/10 border border-border/40"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${severityDot(intv.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{intv.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{intv.summary}</p>
                    {intv.suggestedAction && (
                      <p className="text-[10px] text-primary/70 mt-0.5 flex items-center gap-0.5">
                        <ArrowRight className="h-2.5 w-2.5" />{intv.suggestedAction}
                      </p>
                    )}
                    {intv.athleteUserId && (
                      <div className="flex gap-1 mt-1.5">
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 gap-0.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          data-testid={`button-message-intv-${intv.id}`}
                          onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: intv.athleteUserId, source: "command-center", interventionId: intv.id })}>
                          <MessageSquare className="h-2.5 w-2.5" />Message
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 gap-0.5 text-muted-foreground hover:text-foreground"
                          data-testid={`button-profile-intv-${intv.id}`}
                          onClick={() => setLocation(`/org/${slug}/coach/athletes/${intv.athleteUserId}`)}>
                          <UserCircle className="h-2.5 w-2.5" />Profile
                        </Button>
                      </div>
                    )}
                  </div>
                  <Badge className={`text-[9px] px-1 py-0 h-4 capitalize flex-shrink-0 ${urgencyBadgeClass(intv.severity)}`}>
                    {intv.severity}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Intervention Priority Queue ───────────────────────────────── */}
      {orgId && (
        <Card className="p-4" data-testid="section-priority-queue">
          <InterventionPriorityQueue orgId={orgId} headers={headers} />
        </Card>
      )}

      {/* ── Phase 4: Daily Ops + Org Health ──────────────────────────── */}
      {orgId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4" data-testid="section-daily-ops">
            <DailyOperationsPanel orgId={orgId} headers={headers} />
          </Card>
          <Card className="p-4" data-testid="section-org-health">
            <OrgHealthOverview orgId={orgId} headers={headers} />
          </Card>
        </div>
      )}

      {/* ── Second row ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Performance Highlights */}
        <Card className="p-4" data-testid="section-performance-highlights">
          <SectionHeader icon={TrendingUp} title="Performance Highlights" />
          <div className="space-y-2">
            {cc?.weekPRs > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-blue-500/8 border border-blue-500/20" data-testid="stat-prs-this-week">
                <TrendingUp className="h-4 w-4 text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium">{cc.weekPRs} PR{cc.weekPRs !== 1 ? "s" : ""} set this week</p>
                  <p className="text-[10px] text-muted-foreground">Personal records achieved</p>
                </div>
              </div>
            )}
            {/* Top streaks */}
            {(cc?.topStreaks ?? []).filter((s: any) => s.currentStreak > 0).slice(0, 3).map((s: any, i: number) => (
              <div
                key={s.id ?? i}
                data-testid={`row-streak-${s.athleteUserId}`}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/10 border border-border/40"
              >
                <Flame className="h-4 w-4 text-orange-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{s.currentStreak}-day streak</p>
                  <p className="text-[10px] text-muted-foreground">{s.totalSessionsCompleted} total sessions</p>
                </div>
              </div>
            ))}
            {cc?.recentCompletions > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20" data-testid="stat-completions">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium">{cc.recentCompletions} workout{cc.recentCompletions !== 1 ? "s" : ""} completed</p>
                  <p className="text-[10px] text-muted-foreground">Last 7 days</p>
                </div>
              </div>
            )}
            {!cc?.weekPRs && !cc?.recentCompletions && (cc?.topStreaks ?? []).length === 0 && (
              <EmptyState message="No performance data this week yet." />
            )}
          </div>
        </Card>

        {/* Education Compliance */}
        <Card className="p-4" data-testid="section-education-compliance">
          <SectionHeader icon={BookOpen} title="Education Compliance" />
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Compliance Rate</span>
              <span className={`text-lg font-bold ${cc?.educationComplianceRate >= 70 ? "text-emerald-400" : cc?.educationComplianceRate >= 40 ? "text-amber-400" : "text-rose-400"}`} data-testid="stat-edu-compliance">
                {cc?.educationComplianceRate ?? 0}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${cc?.educationComplianceRate ?? 0}%`,
                  backgroundColor: scoreColor(cc?.educationComplianceRate ?? 0),
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{cc?.completedModules ?? 0} completed</span>
              <span>{cc?.totalModuleEnrollments ?? 0} enrolled</span>
            </div>
            {cc?.educationComplianceRate < 70 && (
              <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-amber-500/8 border border-amber-500/20 mt-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-amber-300">Consider assigning overdue pathways to improve compliance.</p>
              </div>
            )}
          </div>
        </Card>

        {/* AI Insight Cards */}
        <Card className="p-4" data-testid="section-ai-insights">
          <SectionHeader icon={Sparkles} title="AI Insights" />
          <div className="space-y-2">
            {!(briefing?.briefing?.insightCards?.length) ? (
              <EmptyState message="Generate a briefing to see AI insights." />
            ) : (
              (briefing.briefing.insightCards ?? []).map((card: any, i: number) => (
                <div
                  key={i}
                  data-testid={`card-ai-insight-${i}`}
                  className="px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/15"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="h-3 w-3 text-primary" />
                    <span className="text-[9px] text-primary/60 uppercase tracking-wide font-medium">{card.type}</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{card.insight}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Follow-Up Priority + Coach Tasks ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Follow-Up Prioritization */}
        <Card className="p-4" data-testid="section-follow-up-priority">
          <SectionHeader icon={Clock} title="Follow-Up Priority" />
          <div className="space-y-1.5">
            {!(briefing?.briefing?.followUpPriority?.length) ? (
              <EmptyState message="Generate a briefing to see follow-up priorities." />
            ) : (
              (briefing.briefing.followUpPriority ?? []).map((item: any, i: number) => (
                <div
                  key={i}
                  data-testid={`row-followup-${i}`}
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-muted/10 border border-border/40"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${severityDot(item.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug">{item.reason}</p>
                    {item.athleteCount > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        <Users className="h-2.5 w-2.5 inline mr-0.5" />{item.athleteCount} athlete{item.athleteCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                  <Badge className={`text-[9px] px-1.5 py-0 h-4 capitalize flex-shrink-0 ${urgencyBadgeClass(item.severity)}`}>
                    {item.severity}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Intervention Effectiveness Dashboard */}
        {orgId && (
          <Card className="p-4" data-testid="section-effectiveness-dashboard">
            <InterventionEffectivenessDashboard orgId={orgId} headers={headers} compact />
          </Card>
        )}

        {/* Coach Tasks */}
        <Card className="p-4" data-testid="section-coach-tasks">
          <SectionHeader icon={CheckCircle2} title="Coach Tasks" />
          <div className="space-y-1.5">
            {!(briefing?.briefing?.coachTasks?.length) ? (
              <EmptyState message="Generate a briefing to see today's tasks." />
            ) : (
              (briefing.briefing.coachTasks ?? []).map((task: any, i: number) => {
                const key = `task-${i}`;
                const status = taskStatuses[key] ?? "pending";
                return (
                  <div
                    key={i}
                    data-testid={`row-coach-task-${i}`}
                    className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition-opacity ${
                      status === "done"
                        ? "bg-emerald-500/5 border-emerald-500/20 opacity-60"
                        : status === "snoozed"
                        ? "bg-muted/5 border-border/30 opacity-40"
                        : "bg-muted/10 border-border/40"
                    }`}
                  >
                    <button
                      onClick={() => toggleTask(key)}
                      data-testid={`button-task-toggle-${i}`}
                      className="mt-0.5 flex-shrink-0"
                    >
                      {status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium leading-snug ${status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {task.task}
                      </p>
                      <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{task.type?.replace("_", " ")}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Badge className={`text-[9px] px-1.5 py-0 h-4 ${urgencyBadgeClass(task.priority)}`}>
                        {task.priority}
                      </Badge>
                      {status !== "snoozed" && status !== "done" && (
                        <button
                          onClick={() => snoozeTask(key)}
                          data-testid={`button-task-snooze-${i}`}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                          title="Snooze"
                        >
                          <Clock className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* ── Recent Activity ────────────────────────────────────────────── */}
      <Card className="p-4" data-testid="section-recent-activity">
        <SectionHeader icon={Activity} title="Recent Activity" />
        <ActivityFeed compact limit={15} days={7} />
      </Card>

      {/* ── Phase 4: Event Stream ──────────────────────────────────────── */}
      {orgId && (
        <Card className="p-4" data-testid="section-event-stream">
          <EventStreamPanel orgId={orgId} headers={headers} />
        </Card>
      )}
    </div>
  );
}
