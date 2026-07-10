import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import {
  Clock, Users, DollarSign, TrendingUp, Calendar,
  BarChart3, Activity, AlertTriangle, CheckCircle2, AlertCircle,
  Heart, Brain, TrendingDown, Search, Zap,
  Target, X, ThumbsUp, History, Flame,
  ChevronDown, ChevronUp, Award, Shield, Layers,
  ArrowRight, BarChart2, Crosshair, GitBranch
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt$(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface CoachIntelligence {
  coachId: string;
  name: string;
  sessionsThisWeek: number;
  sessions30Days: number;
  revenue30DayCents: number;
  avgSessionsPerWeek: number;
  status: "optimal" | "underutilized" | "overloaded" | "near_capacity" | "inactive";
  recommendations: string[];
}

interface CoachCapacity {
  coachId: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  sessionCount: number;
  bookedHours: number;
  availableHours: number;
  utilizationPct: number;
  openSpots: number;
  totalCapacity: number;
  totalRegistered: number;
  revenueCents: number;
}

interface CapacityResponse {
  coaches: CoachCapacity[];
  period: string;
  startDate: string;
  endDate: string;
}

// ─── Status Helpers ───────────────────────────────────────────────────────────
function statusIcon(status: string) {
  switch (status) {
    case "optimal": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "overloaded": return <Flame className="h-4 w-4 text-red-500" />;
    case "near_capacity": return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case "underutilized": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    default: return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "optimal": return <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20">Optimal</Badge>;
    case "overloaded": return <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20">Overloaded</Badge>;
    case "near_capacity": return <Badge className="text-xs bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20">Near Capacity</Badge>;
    case "underutilized": return <Badge className="text-xs bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">Underutilized</Badge>;
    default: return <Badge variant="secondary" className="text-xs">Inactive</Badge>;
  }
}

// ─── Deterministic coach explainability ──────────────────────────────────────
// All logic flows from observed session counts and thresholds — no AI fabrication.
const WEEKLY_CAPACITY = 30;

function coachExplainability(intel: CoachIntelligence, idleRevenueCents: number) {
  const { status, sessionsThisWeek, sessions30Days, revenue30DayCents } = intel;
  const remaining = WEEKLY_CAPACITY - sessionsThisWeek;
  const confidence = sessions30Days >= 10 ? "High" : sessions30Days >= 4 ? "Medium" : "Low";
  const confidenceColor = confidence === "High" ? "text-green-600 dark:text-green-400"
    : confidence === "Medium" ? "text-yellow-600 dark:text-yellow-400"
    : "text-muted-foreground";

  let why = "";
  let signals: string[] = [];
  let expectedImpact = "";
  let downsideIfIgnored = "";
  let recommendedAction = "";

  switch (status) {
    case "overloaded":
      why = `This coach has ${sessionsThisWeek} sessions this week — ${sessionsThisWeek - WEEKLY_CAPACITY} above the ${WEEKLY_CAPACITY}-session full-time ceiling.`;
      signals = [
        `${sessionsThisWeek} sessions scheduled this week (ceiling: ${WEEKLY_CAPACITY})`,
        sessions30Days > 0 ? `${sessions30Days} sessions in the last 30 days` : "",
        revenue30DayCents > 0 ? `${fmt$(revenue30DayCents)} revenue generated (30d)` : "",
      ].filter(Boolean);
      expectedImpact = "Redistributing load reduces burnout risk and protects session quality for athletes.";
      downsideIfIgnored = "Continued overload increases coach burnout, degrades session quality, and risks athlete churn as service quality declines.";
      recommendedAction = "Immediately pause new bookings and redistribute sessions to coaches with available capacity.";
      break;

    case "near_capacity":
      why = `At ${sessionsThisWeek} sessions this week, this coach is within ${remaining} sessions of maximum capacity and approaching a critical threshold.`;
      signals = [
        `${sessionsThisWeek} sessions this week (${remaining} remaining before ceiling)`,
        sessions30Days > 0 ? `${sessions30Days} sessions in the last 30 days` : "",
        revenue30DayCents > 0 ? `${fmt$(revenue30DayCents)} 30-day revenue` : "",
      ].filter(Boolean);
      expectedImpact = "Proactive schedule management prevents cascading overload in the following week.";
      downsideIfIgnored = "Without intervention, new bookings or cancellations will push this coach into overload territory, triggering burnout risk.";
      recommendedAction = "Accept only high-priority bookings. Monitor next week's load before adding sessions.";
      break;

    case "underutilized":
      why = `This coach has only ${sessionsThisWeek} sessions this week against a ${WEEKLY_CAPACITY}-session capacity — ${remaining} slots are unfilled.`;
      signals = [
        `${sessionsThisWeek} sessions this week (${remaining} slots unfilled)`,
        idleRevenueCents > 0 ? `${fmt$(idleRevenueCents)} in unrealized idle revenue` : "",
        sessions30Days > 0 ? `${sessions30Days} sessions over the last 30 days` : "No sessions in 30 days",
        revenue30DayCents > 0 ? `${fmt$(revenue30DayCents)} 30-day revenue` : "",
      ].filter(Boolean);
      expectedImpact = `Filling open slots could recover up to ${idleRevenueCents > 0 ? fmt$(idleRevenueCents) : "significant"} in idle revenue this period.`;
      downsideIfIgnored = "Persistent underutilization leads to revenue loss, coach disengagement, and organizational inefficiency.";
      recommendedAction = "Run a fill campaign for this coach's open slots. Consider assigning athletes from overloaded coaches.";
      break;

    case "inactive":
      why = "No sessions have been recorded for this coach in the past 30 days.";
      signals = ["0 sessions this week", "0 sessions in the last 30 days"];
      expectedImpact = "Activating this coach creates new revenue-generating capacity without hiring.";
      downsideIfIgnored = "An inactive coach represents a fully idle payroll cost with zero revenue offset.";
      recommendedAction = "Verify availability status. Set up session availability and assign the next incoming athlete.";
      break;

    default:
      return null;
  }

  return { why, signals, expectedImpact, downsideIfIgnored, recommendedAction, confidence, confidenceColor };
}

// ─── Utilization Bar ──────────────────────────────────────────────────────────
function UtilizationBar({ pct }: { pct: number }) {
  const color = pct >= 67 ? "bg-red-500" : pct >= 37 ? "bg-green-500" : "bg-yellow-500";
  const label = pct >= 67 ? "High" : pct >= 37 ? "Healthy" : "Low";
  const labelColor = pct >= 67 ? "text-red-600 dark:text-red-400" : pct >= 37 ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Utilization</span>
        <span className={`font-semibold ${labelColor}`}>{pct}% · {label}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

// ─── Health Score Banner ─────────────────────────────────────────────────────
function HealthScoreBanner() {
  const { data, isLoading } = useQuery<{ score: number; label: string; summary: string }>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/health-score").catch(() => null),
    retry: false,
  });
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data) return null;

  const score = data.score;
  const barColor = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  const labelColor = score >= 75 ? "text-green-700 dark:text-green-400" : score >= 50 ? "text-yellow-700 dark:text-yellow-400" : "text-red-700 dark:text-red-400";

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/20" data-testid="health-score-banner">
      <div className="flex items-center gap-2 shrink-0">
        <Heart className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">Schedule Health</p>
          <p className={`text-2xl font-bold leading-none ${labelColor}`}>{score}</p>
        </div>
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold">{data.label}</p>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${score}%` }} />
        </div>
        {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
      </div>
    </div>
  );
}

// ─── Workforce Agent Reputation Panel ────────────────────────────────────────
function WorkforceAgentReputationPanel() {
  const { data, isLoading } = useQuery<{
    recommendations: any;
    campaigns: any;
    trustTier: string;
    categoryBreakdown: any[];
    signalVelocity: any[];
  }>({
    queryKey: ["/api/scheduling-intelligence/agent-reputation"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/agent-reputation").catch(() => null),
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!data || data.recommendations?.total === 0) return null;

  const r = data.recommendations;
  const trustColor = data.trustTier === "High Trust" ? "text-green-600 dark:text-green-400"
    : data.trustTier === "Moderate Trust" ? "text-yellow-600 dark:text-yellow-400"
    : "text-muted-foreground";
  const trustBg = data.trustTier === "High Trust" ? "bg-green-500/10 border-green-500/20"
    : data.trustTier === "Moderate Trust" ? "bg-yellow-500/10 border-yellow-500/20"
    : "bg-muted border-border";

  const maxVelocity = Math.max(1, ...data.signalVelocity.map((v: any) => v.count));

  return (
    <Card className="p-4" data-testid="panel-agent-reputation">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">Scheduling Agent Reputation</p>
        <Badge className={`ml-auto text-xs border px-2 ${trustBg} ${trustColor}`}>
          {data.trustTier}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {[
          { label: "Recommendations", value: r.total, color: "" },
          { label: "Approved", value: r.approved, color: "text-green-600 dark:text-green-400" },
          { label: "Approval Rate", value: `${r.approvalRate}%`, color: r.approvalRate >= 60 ? "text-green-600 dark:text-green-400" : r.approvalRate >= 30 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400" },
        ].map(stat => (
          <div key={stat.label} className="text-center">
            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {r.totalApprovedValueCents > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-500/5 border border-green-500/20 rounded px-2 py-1.5 mb-4">
          <DollarSign className="h-3.5 w-3.5 text-green-500" />
          <span>{fmt$(r.totalApprovedValueCents)} estimated value from approved recommendations (all time)</span>
        </div>
      )}

      {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-medium text-muted-foreground">Performance by Category</p>
          {data.categoryBreakdown.map((cat: any, i: number) => (
            <div key={i} className="space-y-0.5" data-testid={`reputation-category-${i}`}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground capitalize">{cat.category?.replace(/_/g, " ")}</span>
                <span className={`font-semibold ${cat.approvalRate >= 60 ? "text-green-600 dark:text-green-400" : cat.approvalRate >= 30 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
                  {cat.approvalRate}% ({cat.approved}/{cat.total})
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${cat.approvalRate >= 60 ? "bg-green-500" : cat.approvalRate >= 30 ? "bg-yellow-500" : "bg-muted-foreground"}`}
                  style={{ width: `${cat.approvalRate}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {data.signalVelocity && data.signalVelocity.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Signal Activity (14 days)</p>
          <div className="flex items-end gap-0.5 h-8">
            {data.signalVelocity.map((v: any, i: number) => {
              const h = maxVelocity > 0 ? Math.max(4, Math.round((v.count / maxVelocity) * 32)) : 4;
              return (
                <div
                  key={i}
                  className="flex-1 bg-primary/30 rounded-sm hover:bg-primary/60 transition-colors"
                  style={{ height: `${h}px` }}
                  title={`${v.day}: ${v.count} actions`}
                />
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Predictive Workforce Panel ───────────────────────────────────────────────
// Derives forward-looking signals from real observed data — no AI fabrication.
function PredictiveWorkforcePanel({
  intelligenceData,
  capacityRecs,
}: {
  intelligenceData?: { coaches: CoachIntelligence[] };
  capacityRecs?: { recommendations: any[] };
}) {
  const coaches = intelligenceData?.coaches ?? [];
  const recs = capacityRecs?.recommendations ?? [];
  if (coaches.length === 0 && recs.length === 0) return null;

  const predictions: Array<{ severity: "high" | "medium" | "low"; signal: string; detail: string; source: string }> = [];

  // Predict future overload from near-capacity coaches
  const nearCap = coaches.filter(c => c.status === "near_capacity");
  if (nearCap.length > 0) {
    predictions.push({
      severity: "high",
      signal: `${nearCap.length} coach${nearCap.length !== 1 ? "es are" : " is"} projected to reach overload next week`,
      detail: `${nearCap.map(c => c.name.split(" ")[0]).join(", ")} ${nearCap.length === 1 ? "is" : "are"} at near-capacity. Without load balancing, overload is likely within 7 days.`,
      source: "Utilization trend",
    });
  }

  // Predict continued underutilization from inactive coaches
  const inactive = coaches.filter(c => c.status === "inactive");
  if (inactive.length > 0) {
    predictions.push({
      severity: "medium",
      signal: `${inactive.length} coach${inactive.length !== 1 ? "es" : ""} predicted to remain idle without intervention`,
      detail: `${inactive.map(c => c.name.split(" ")[0]).join(", ")} ${inactive.length === 1 ? "has" : "have"} zero sessions in 30 days. Continued inactivity represents a growing payroll efficiency gap.`,
      source: "30-day session history",
    });
  }

  // Predict capacity shortage from oversubscribed sessions
  const expandRec = recs.find((r: any) => r.type === "expand_capacity");
  if (expandRec && expandRec.affectedSessions?.length > 0) {
    predictions.push({
      severity: "high",
      signal: `Demand is outpacing capacity — ${expandRec.affectedSessions.length} session type${expandRec.affectedSessions.length !== 1 ? "s" : ""} consistently at full capacity`,
      detail: `These sessions show persistent high fill rates. Without additional sessions or expanded capacity, new athlete demand will go unmet and revenue will be lost.`,
      source: "30-day session performance",
    });
  }

  // Predict revenue gap from waitlist pressure
  const waitlistRec = recs.find((r: any) => r.type === "add_session");
  if (waitlistRec) {
    predictions.push({
      severity: "medium",
      signal: `Waitlist pressure signals future session demand at ${waitlistRec.suggestedDay ?? "a peak time slot"}`,
      detail: `${waitlistRec.waitlistSize ?? "Multiple"} athletes are waiting. Adding a session at this time would immediately convert waitlist demand into bookings.`,
      source: "Waitlist holds",
    });
  }

  // Predict revenue loss from underutilized upcoming sessions
  const underutilRec = recs.find((r: any) => r.type === "reduce_capacity");
  if (underutilRec && underutilRec.affectedSessions?.length > 0) {
    predictions.push({
      severity: "low",
      signal: `${underutilRec.affectedSessions.length} upcoming sessions are predicted to underfill without outreach`,
      detail: `These sessions are currently below 30% fill with no fill campaign in progress. Without intervention, idle capacity will persist through the session date.`,
      source: "Upcoming session fill rates",
    });
  }

  if (predictions.length === 0) return null;

  const severityIcon = (s: string) =>
    s === "high" ? <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
    : s === "medium" ? <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
    : <BarChart2 className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />;

  return (
    <Card className="p-4" data-testid="panel-predictive-workforce">
      <div className="flex items-center gap-2 mb-4">
        <Crosshair className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">Predictive Workforce Signals</p>
        <Badge variant="secondary" className="ml-auto text-xs">{predictions.length} forward signal{predictions.length !== 1 ? "s" : ""}</Badge>
      </div>
      <div className="space-y-3">
        {predictions.map((p, i) => (
          <div key={i} className="flex items-start gap-2.5" data-testid={`prediction-${i}`}>
            {severityIcon(p.severity)}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium leading-snug">{p.signal}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{p.detail}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Source: {p.source}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Capacity Optimization Panel ──────────────────────────────────────────────
function CapacityOptimizationPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ recommendations: any[] }>({
    queryKey: ["/api/scheduling-intelligence/capacity-optimization"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/capacity-optimization").catch(() => ({ recommendations: [] })),
    retry: false,
  });

  const actionMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/scheduling-intelligence/recommendation-action", body),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/recommendation-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/agent-reputation"] });
      toast({ title: vars.action === "approved" ? "Recommendation approved" : "Recommendation dismissed", description: vars.opportunityTitle });
    },
  });

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const recs = (data?.recommendations ?? []).filter((r: any) => !dismissed.has(r.type));
  if (recs.length === 0) return null;

  function handleAction(rec: any, action: "approved" | "dismissed") {
    if (action === "dismissed") setDismissed(prev => new Set(prev).add(rec.type));
    actionMutation.mutate({
      opportunityId: `capacity-${rec.type}-${Date.now()}`,
      opportunityTitle: rec.title,
      opportunityType: rec.type,
      opportunityCategory: "capacity",
      action,
      estimatedValueCents: 0,
    });
  }

  function handleApproveAll() {
    recs.forEach((rec: any) => {
      actionMutation.mutate({
        opportunityId: `capacity-${rec.type}-${Date.now()}`,
        opportunityTitle: rec.title,
        opportunityType: rec.type,
        opportunityCategory: "capacity",
        action: "approved",
        estimatedValueCents: 0,
      });
    });
    toast({ title: "All recommendations approved", description: `${recs.length} capacity signal${recs.length !== 1 ? "s" : ""} noted` });
  }

  const priorityColor = (p: string) =>
    p === "high" ? "text-red-600 dark:text-red-400 border-red-500/20 bg-red-500/10"
    : p === "medium" ? "text-yellow-600 dark:text-yellow-400 border-yellow-500/20 bg-yellow-500/10"
    : "text-blue-600 dark:text-blue-400 border-blue-500/20 bg-blue-500/10";

  // Deterministic explainability per type
  const explainability: Record<string, { why: string; downsideIfIgnored: string; owner: string }> = {
    expand_capacity: {
      why: "Sessions are consistently at or above 90% fill. Demand is outpacing available spots.",
      downsideIfIgnored: "Unmet demand converts to athlete frustration and missed revenue. Competitors may absorb displaced athletes.",
      owner: "Scheduling Agent",
    },
    reduce_capacity: {
      why: "Upcoming sessions are below 30% fill. Open spots represent idle revenue that expires at session time.",
      downsideIfIgnored: "Idle capacity incurs coach cost with no revenue offset. Fill probability decreases as session date approaches.",
      owner: "Revenue Agent",
    },
    add_session: {
      why: "Waitlist entries exceed 2 for this time slot, indicating demand that cannot be served.",
      downsideIfIgnored: "Athletes on the waitlist may book with competitors or disengage if they cannot secure a spot.",
      owner: "Scheduling Agent",
    },
  };

  return (
    <Card className="p-4" data-testid="panel-capacity-optimization">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">Capacity Optimization</p>
        <Badge variant="secondary" className="ml-auto text-xs">{recs.length} signal{recs.length !== 1 ? "s" : ""}</Badge>
        {recs.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-500/10"
            data-testid="btn-approve-all-recs"
            onClick={handleApproveAll}
            disabled={actionMutation.isPending}
          >
            <ThumbsUp className="h-3 w-3" />Approve All
          </Button>
        )}
      </div>
      <div className="space-y-5">
        {recs.map((rec: any, i: number) => {
          const exp = explainability[rec.type];
          return (
            <div key={i} className="space-y-2.5 pb-5 border-b last:border-0 last:pb-0" data-testid={`capacity-rec-${i}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <Badge className={`text-xs border ${priorityColor(rec.priority)}`}>{rec.priority}</Badge>
                {exp && (
                  <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/5 gap-1">
                    <GitBranch className="h-2.5 w-2.5" />{exp.owner}
                  </Badge>
                )}
                <p className="text-sm font-medium leading-snug flex-1">{rec.title}</p>
              </div>

              {rec.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{rec.description}</p>
              )}

              {exp && (
                <div className="bg-muted/40 rounded-lg px-3 py-2.5 space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-20">Why:</span>
                    <span className="text-xs text-muted-foreground">{exp.why}</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-20">If ignored:</span>
                    <span className="text-xs text-muted-foreground">{exp.downsideIfIgnored}</span>
                  </div>
                </div>
              )}

              {rec.affectedSessions && rec.affectedSessions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rec.affectedSessions.slice(0, 3).map((s: any, j: number) => (
                    <span key={j} className="text-xs bg-muted rounded px-2 py-0.5">
                      {s.name} · {s.registered}/{s.capacity}
                      {s.coach ? ` · ${s.coach}` : ""}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-500/10"
                  data-testid={`btn-approve-rec-${i}`}
                  onClick={() => handleAction(rec, "approved")}
                  disabled={actionMutation.isPending}
                >
                  <ThumbsUp className="h-3 w-3" />Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  data-testid={`btn-dismiss-rec-${i}`}
                  onClick={() => handleAction(rec, "dismissed")}
                  disabled={actionMutation.isPending}
                >
                  <X className="h-3 w-3" />Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Retention Risk Panel ─────────────────────────────────────────────────────
function RetentionRiskPanel() {
  const { data, isLoading } = useQuery<{ atRisk: any[] }>({
    queryKey: ["/api/scheduling-intelligence/retention-risk"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/retention-risk").catch(() => ({ atRisk: [] })),
    retry: false,
  });
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const atRisk = data?.atRisk ?? [];
  const highRisk = atRisk.filter((c: any) => c.riskLevel === "high");
  if (atRisk.length === 0) return null;

  return (
    <div className="rounded-lg border p-4" data-testid="retention-risk-panel">
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="h-4 w-4 text-red-500" />
        <p className="font-semibold text-sm">Retention Risk</p>
        {highRisk.length > 0 && (
          <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 ml-auto">
            {highRisk.length} high risk
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        {atRisk.slice(0, 5).map((client: any, i: number) => (
          <div key={i} className="flex items-center justify-between text-sm gap-2" data-testid={`retention-risk-${i}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{client.name || "Client"}</p>
              <p className="text-xs text-muted-foreground">
                {client.daysSinceLastBooking != null ? `${client.daysSinceLastBooking}d inactive` : "—"}
                {client.cancellationRate != null ? ` · ${Math.round(client.cancellationRate)}% cancel rate` : ""}
              </p>
            </div>
            <Badge className={`text-xs shrink-0 ${
              client.riskLevel === "high" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20"
              : client.riskLevel === "medium" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
              : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20"
            }`}>
              {client.riskLevel}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Organizational Learning Panel ────────────────────────────────────────────
function OrganizationalLearningPanel() {
  const { data: insights, isLoading: insightsLoading } = useQuery<{ insights: any[] }>({
    queryKey: ["/api/scheduling-intelligence/learning-insights"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/learning-insights").catch(() => ({ insights: [] })),
    retry: false,
  });
  const { data: reputation } = useQuery<{ categoryBreakdown: any[]; trustTier: string }>({
    queryKey: ["/api/scheduling-intelligence/agent-reputation"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/agent-reputation").catch(() => null),
    retry: false,
  });

  if (insightsLoading) return <Skeleton className="h-32 w-full" />;
  const allInsights = insights?.insights ?? [];
  if (allInsights.length === 0) return null;

  const successInsights = allInsights.filter((i: any) => i.severity === "success");
  const warningInsights = allInsights.filter((i: any) => i.severity === "warning");
  const bestCategories = (reputation?.categoryBreakdown ?? [])
    .filter((c: any) => c.approvalRate >= 60)
    .slice(0, 2);
  const worstCategories = (reputation?.categoryBreakdown ?? [])
    .filter((c: any) => c.approvalRate < 30 && c.total >= 2)
    .slice(0, 2);

  const severityIcon = (s: string) =>
    s === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
    : s === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
    : <BarChart2 className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />;

  return (
    <Card className="p-4" data-testid="panel-organizational-learning">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">Organizational Learning</p>
        <Badge variant="secondary" className="ml-auto text-xs">{allInsights.length} pattern{allInsights.length !== 1 ? "s" : ""}</Badge>
      </div>

      {(bestCategories.length > 0 || worstCategories.length > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {bestCategories.length > 0 && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2.5">
              <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1.5 flex items-center gap-1">
                <Award className="h-3 w-3" />Consistently Works
              </p>
              {bestCategories.map((c: any, i: number) => (
                <p key={i} className="text-xs text-muted-foreground capitalize">{c.category?.replace(/_/g, " ")} · {c.approvalRate}% approval</p>
              ))}
            </div>
          )}
          {worstCategories.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1.5 flex items-center gap-1">
                <X className="h-3 w-3" />Consistently Rejected
              </p>
              {worstCategories.map((c: any, i: number) => (
                <p key={i} className="text-xs text-muted-foreground capitalize">{c.category?.replace(/_/g, " ")} · {c.approvalRate}% approval</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {[...successInsights, ...warningInsights].slice(0, 6).map((ins: any, i: number) => (
          <div key={i} className="flex items-start gap-2" data-testid={`org-insight-${i}`}>
            {severityIcon(ins.severity)}
            <div className="min-w-0">
              <p className="text-xs font-medium leading-snug">{ins.insight}</p>
              {ins.detail && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ins.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Recommendation History Panel ─────────────────────────────────────────────
function RecommendationHistoryPanel() {
  const { data, isLoading } = useQuery<{ actions: any[]; summary: any }>({
    queryKey: ["/api/scheduling-intelligence/recommendation-history"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/recommendation-history").catch(() => ({ actions: [], summary: {} })),
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const summary = data?.summary;
  if (!summary || summary.total === 0) return null;

  const pct = summary.approvalRate;
  const barColor = pct >= 60 ? "bg-green-500" : pct >= 30 ? "bg-yellow-500" : "bg-red-500";

  // Lifecycle stages: Detected → Recommended → Reviewed → Actioned
  const stages = [
    { label: "Detected", count: summary.total, active: true },
    { label: "Recommended", count: summary.total, active: true },
    { label: "Reviewed", count: summary.approved + summary.rejected + summary.dismissed, active: summary.total > 0 },
    { label: "Approved", count: summary.approved, active: summary.approved > 0 },
  ];

  return (
    <Card className="p-4" data-testid="panel-recommendation-history">
      <div className="flex items-center gap-2 mb-4">
        <History className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold text-sm">Recommendation Lifecycle</p>
        <span className="text-xs text-muted-foreground ml-1">30 days</span>
      </div>

      {/* Lifecycle pipeline */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {stages.map((stage, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <div className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg text-center min-w-[64px] ${stage.active ? "bg-primary/10 border border-primary/20" : "bg-muted border border-border"}`}>
              <p className={`text-base font-bold ${stage.active ? "text-primary" : "text-muted-foreground"}`}>{stage.count}</p>
              <p className="text-xs text-muted-foreground">{stage.label}</p>
            </div>
            {i < stages.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          </div>
        ))}
      </div>

      {/* Approval rate bar */}
      <div className="space-y-1 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Approval Rate</span>
          <span className={`font-semibold ${pct >= 60 ? "text-green-600 dark:text-green-400" : pct >= 30 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>{pct}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="text-green-600 dark:text-green-400">{summary.approved} approved</span>
          <span className="text-red-600 dark:text-red-400">{summary.rejected} rejected</span>
          <span>{summary.dismissed} dismissed</span>
        </div>
      </div>

      {summary.totalApprovedValueCents > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-500/5 border border-green-500/20 rounded px-2 py-1.5 mb-3">
          <DollarSign className="h-3.5 w-3.5 text-green-500" />
          <span>{fmt$(summary.totalApprovedValueCents)} estimated value from approved recommendations</span>
        </div>
      )}

      {data?.actions && data.actions.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          {data.actions.slice(0, 6).map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs" data-testid={`history-action-${i}`}>
              <Badge variant="outline" className={`text-xs px-1.5 py-0 h-4 shrink-0 ${
                a.action === "approved" ? "border-green-500/40 text-green-700 dark:text-green-400"
                : a.action === "rejected" ? "border-red-500/40 text-red-600 dark:text-red-400"
                : "border-muted text-muted-foreground"
              }`}>{a.action}</Badge>
              <span className="truncate text-muted-foreground flex-1">{a.title}</span>
              <span className="shrink-0 text-muted-foreground">{new Date(a.actionedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Coach Card ───────────────────────────────────────────────────────────────
function CoachCard({
  coach,
  intelligence,
  isNextAthlete,
}: {
  coach: CoachCapacity;
  intelligence?: CoachIntelligence;
  isNextAthlete: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const name = `${coach.firstName || ""} ${coach.lastName || ""}`.trim() || "Coach";
  const initials = `${(coach.firstName || "")[0] || ""}${(coach.lastName || "")[0] || ""}`.toUpperCase();
  const hasRecs = intelligence && intelligence.status !== "optimal" && intelligence.recommendations.length > 0;
  const isBurnoutRisk = (intelligence?.sessionsThisWeek ?? 0) >= 40 || intelligence?.status === "overloaded";
  const revenuePerSession = coach.sessionCount > 0 ? Math.round(coach.revenueCents / coach.sessionCount) : 0;
  const avgSessionPrice = coach.totalRegistered > 0 ? Math.round(coach.revenueCents / coach.totalRegistered) : 0;
  const idleRevenueCents = coach.openSpots > 0 && avgSessionPrice > 0 ? coach.openSpots * avgSessionPrice : 0;

  const explain = intelligence && intelligence.status !== "optimal"
    ? coachExplainability(intelligence, idleRevenueCents)
    : null;

  const actionMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/scheduling-intelligence/recommendation-action", body),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/recommendation-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/agent-reputation"] });
      toast({ title: vars.action === "approved" ? "Recommendation accepted" : "Recommendation dismissed" });
    },
  });

  function handleRecAction(rec: string, action: "approved" | "dismissed") {
    actionMutation.mutate({
      opportunityId: `coach-${coach.coachId}-${Date.now()}`,
      opportunityTitle: rec,
      opportunityType: "coach_workload",
      opportunityCategory: "capacity",
      action,
      estimatedValueCents: idleRevenueCents,
    });
  }

  return (
    <Card
      className={`p-5 space-y-4 relative ${isNextAthlete ? "ring-2 ring-green-500/40" : ""}`}
      data-testid={`card-coach-capacity-${coach.coachId}`}
    >
      {isNextAthlete && (
        <div className="absolute top-3 right-3">
          <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 gap-1">
            <Zap className="h-2.5 w-2.5" />Next Athlete
          </Badge>
        </div>
      )}
      {isBurnoutRisk && !isNextAthlete && (
        <div className="absolute top-3 right-3">
          <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 gap-1">
            <Flame className="h-2.5 w-2.5" />Burnout Risk
          </Badge>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 pr-20">
        <Avatar className="h-11 w-11 shrink-0">
          <AvatarImage src={coach.photoUrl || undefined} />
          <AvatarFallback className="text-sm bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-semibold text-sm">{name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {intelligence ? statusBadge(intelligence.status) : <Badge variant="secondary" className="text-xs">Loading…</Badge>}
          </div>
        </div>
      </div>

      <UtilizationBar pct={coach.utilizationPct} />

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Booked Hours</p>
          <p className="font-semibold">{coach.bookedHours}h <span className="text-xs text-muted-foreground font-normal">/ {coach.availableHours}h</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Revenue</p>
          <p className="font-semibold">{fmt$(coach.revenueCents)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Registered</p>
          <p className="font-semibold">{coach.totalRegistered} <span className="text-xs text-muted-foreground font-normal">/ {coach.totalCapacity} cap.</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />Open Spots</p>
          <p className={`font-semibold ${coach.openSpots > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>{coach.openSpots}</p>
        </div>
        {revenuePerSession > 0 && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Rev / Session</p>
            <p className="font-semibold">{fmt$(revenuePerSession)}</p>
          </div>
        )}
        {idleRevenueCents > 0 && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3 w-3 text-yellow-500" />Idle Revenue</p>
            <p className="font-semibold text-yellow-600 dark:text-yellow-400">{fmt$(idleRevenueCents)}</p>
          </div>
        )}
        {intelligence && intelligence.sessions30Days > 0 && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />30d Sessions</p>
            <p className="font-semibold">{intelligence.sessions30Days}</p>
          </div>
        )}
        {intelligence && intelligence.revenue30DayCents > 0 && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" />30d Revenue</p>
            <p className="font-semibold">{fmt$(intelligence.revenue30DayCents)}</p>
          </div>
        )}
      </div>

      {/* Explainability — collapsible optimization analysis */}
      {explain && (
        <div className="border-t pt-3">
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground w-full text-left transition-colors"
            onClick={() => setExpanded(v => !v)}
            data-testid={`btn-expand-explain-${coach.coachId}`}
          >
            <Layers className="h-3.5 w-3.5 text-primary" />
            Optimization Analysis
            {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>

          {expanded && (
            <div className="mt-3 space-y-2.5" data-testid={`explain-${coach.coachId}`}>
              <div className="bg-muted/40 rounded-lg px-3 py-2.5 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Why</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{explain.why}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Signals Observed</p>
                  <ul className="space-y-0.5">
                    {explain.signals.map((s, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-0.5 shrink-0">·</span><span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Expected Impact</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{explain.expectedImpact}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5">If Ignored</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{explain.downsideIfIgnored}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-0.5">Recommended Action</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{explain.recommendedAction}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Signal Confidence:</p>
                  <span className={`text-xs font-semibold ${explain.confidenceColor}`}>{explain.confidence}</span>
                  <span className="text-xs text-muted-foreground">({intelligence!.sessions30Days} sessions, 30d)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recommendations with approve/dismiss */}
      {hasRecs && (
        <div className={`${explain ? "" : "border-t"} pt-3 space-y-3`} data-testid={`coach-recommendations-${coach.coachId}`}>
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-primary" />Recommendations
          </p>
          <div className="space-y-2">
            {intelligence!.recommendations.slice(0, 3).map((r, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-primary mt-0.5 shrink-0">→</span><span>{r}</span>
                </p>
                <div className="flex items-center gap-1.5 ml-4">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs gap-1 px-2 border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-500/10"
                    data-testid={`btn-approve-coach-rec-${coach.coachId}-${i}`}
                    onClick={() => handleRecAction(r, "approved")}
                    disabled={actionMutation.isPending}
                  >
                    <ThumbsUp className="h-2.5 w-2.5" />Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
                    data-testid={`btn-dismiss-coach-rec-${coach.coachId}-${i}`}
                    onClick={() => handleRecAction(r, "dismissed")}
                    disabled={actionMutation.isPending}
                  >
                    <X className="h-2.5 w-2.5" />Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Utilization Intelligence Panel ──────────────────────────────────────────
function UtilizationIntelligencePanel({ intelligence }: { intelligence?: { coaches: CoachIntelligence[] } }) {
  if (!intelligence || intelligence.coaches.length === 0) return null;
  const needsAttention = intelligence.coaches.filter(c => c.status !== "optimal");
  if (needsAttention.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 p-4 rounded-lg border bg-green-500/5 border-green-500/20">
        <CheckCircle2 className="h-4 w-4" />
        All coaches are optimally utilized — no workforce action required.
      </div>
    );
  }
  return (
    <Card className="p-4" data-testid="panel-utilization-intelligence">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">Workforce Attention Summary</p>
        <Badge variant="secondary" className="ml-auto text-xs">{needsAttention.length} coach{needsAttention.length !== 1 ? "es" : ""}</Badge>
      </div>
      <div className="space-y-3">
        {needsAttention.map(coach => (
          <div key={coach.coachId} className="space-y-1.5" data-testid={`intelligence-${coach.coachId}`}>
            <div className="flex items-center gap-2">
              {statusIcon(coach.status)}
              <span className="font-medium text-sm">{coach.name}</span>
              {statusBadge(coach.status)}
              <span className="text-xs text-muted-foreground ml-auto">{coach.sessionsThisWeek} sess/wk</span>
            </div>
            {coach.recommendations.length > 0 && (
              <p className="ml-6 text-xs text-muted-foreground">{coach.recommendations[0]}</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type StatusFilter = "all" | "overloaded" | "near_capacity" | "optimal" | "underutilized" | "inactive";
type SortKey = "utilization" | "revenue" | "hours" | "name" | "open_spots";

export default function AdminCoachCapacityPage() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [sortBy, setSortBy] = useState<SortKey>("utilization");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<CapacityResponse>({
    queryKey: ["/api/scheduling/coach-capacity", period],
    queryFn: () => authenticatedFetch(`/api/scheduling/coach-capacity?period=${period}`),
  });

  const { data: intelligenceData } = useQuery<{ coaches: CoachIntelligence[] }>({
    queryKey: ["/api/scheduling-intelligence/utilization-intelligence"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/utilization-intelligence").catch(() => ({ coaches: [] })),
    retry: false,
  });

  const { data: capacityRecs } = useQuery<{ recommendations: any[] }>({
    queryKey: ["/api/scheduling-intelligence/capacity-optimization"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/capacity-optimization").catch(() => ({ recommendations: [] })),
    retry: false,
  });

  const intelligenceById = useMemo(() =>
    new Map<string, CoachIntelligence>((intelligenceData?.coaches || []).map(c => [c.coachId, c])),
    [intelligenceData]
  );
  const intelligenceByName = useMemo(() =>
    new Map<string, CoachIntelligence>((intelligenceData?.coaches || []).map(c => [c.name.toLowerCase(), c])),
    [intelligenceData]
  );

  const coaches = data?.coaches || [];

  const sorted = useMemo(() => {
    let list = [...coaches];
    if (statusFilter !== "all") {
      list = list.filter(c => {
        const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim().toLowerCase();
        const intel = intelligenceById.get(c.coachId) ?? intelligenceByName.get(fullName);
        return intel?.status === statusFilter;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortBy === "utilization") return b.utilizationPct - a.utilizationPct;
      if (sortBy === "revenue") return b.revenueCents - a.revenueCents;
      if (sortBy === "hours") return b.bookedHours - a.bookedHours;
      if (sortBy === "open_spots") return b.openSpots - a.openSpots;
      if (sortBy === "name") return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      return 0;
    });
    return list;
  }, [coaches, sortBy, statusFilter, search, intelligenceById, intelligenceByName]);

  const totalRevenue = coaches.reduce((s, c) => s + c.revenueCents, 0);
  const totalHours = coaches.reduce((s, c) => s + c.bookedHours, 0);
  const totalSessions = coaches.reduce((s, c) => s + c.sessionCount, 0);
  const totalOpenSpots = coaches.reduce((s, c) => s + c.openSpots, 0);
  const avgUtilization = coaches.length > 0 ? Math.round(coaches.reduce((s, c) => s + c.utilizationPct, 0) / coaches.length) : 0;
  const totalRegistered = coaches.reduce((s, c) => s + c.totalRegistered, 0);
  const avgRevenuePerReg = totalRegistered > 0 ? totalRevenue / totalRegistered : 0;
  const idleRevenueCents = Math.round(totalOpenSpots * avgRevenuePerReg);

  const highUtil = coaches.filter(c => c.utilizationPct >= 67).length;
  const midUtil = coaches.filter(c => c.utilizationPct >= 37 && c.utilizationPct < 67).length;
  const lowUtil = coaches.filter(c => c.utilizationPct < 37).length;

  const nextAthleteCoachId = useMemo(() => {
    const eligible = coaches.filter(c => {
      const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim().toLowerCase();
      const intel = intelligenceById.get(c.coachId) ?? intelligenceByName.get(fullName);
      const status = intel?.status ?? "inactive";
      return (status === "optimal" || status === "underutilized") && c.openSpots > 0;
    });
    if (eligible.length === 0) return null;
    return eligible.sort((a, b) => b.openSpots - a.openSpots)[0]?.coachId ?? null;
  }, [coaches, intelligenceById, intelligenceByName]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: coaches.length, optimal: 0, overloaded: 0, near_capacity: 0, underutilized: 0, inactive: 0 };
    coaches.forEach(c => {
      const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim().toLowerCase();
      const intel = intelligenceById.get(c.coachId) ?? intelligenceByName.get(fullName);
      const status = intel?.status ?? "inactive";
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [coaches, intelligenceById, intelligenceByName]);

  const overloadedCount = statusCounts["overloaded"] ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold">Coach Capacity</h1>
          <p className="text-muted-foreground mt-1 text-sm">Workforce optimization · utilization · revenue · burnout prevention · predictive signals</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={period} onValueChange={v => setPeriod(v as any)}>
            <SelectTrigger className="w-[110px] h-9" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
            <SelectTrigger className="w-[140px] h-9" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utilization">By Utilization</SelectItem>
              <SelectItem value="revenue">By Revenue</SelectItem>
              <SelectItem value="hours">By Hours</SelectItem>
              <SelectItem value="open_spots">By Open Spots</SelectItem>
              <SelectItem value="name">By Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Burnout Alert ── */}
      {overloadedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-700 dark:text-red-400" data-testid="burnout-alert-banner">
          <Flame className="h-4 w-4 shrink-0" />
          <p><strong>{overloadedCount} coach{overloadedCount !== 1 ? "es are" : " is"} overloaded.</strong> Redistribute sessions now to prevent burnout and protect athlete experience.</p>
        </div>
      )}

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Total Revenue", value: fmt$(totalRevenue), icon: DollarSign, sub: period === "week" ? "this week" : "this month", highlight: false },
          { label: "Booked Hours", value: `${totalHours.toFixed(1)}h`, icon: Clock, sub: `across ${coaches.length} coaches`, highlight: false },
          { label: "Sessions", value: String(totalSessions), icon: Calendar, sub: period === "week" ? "this week" : "this month", highlight: false },
          { label: "Open Spots", value: String(totalOpenSpots), icon: Users, sub: "unfilled capacity", highlight: false },
          { label: "Idle Revenue", value: idleRevenueCents > 0 ? fmt$(idleRevenueCents) : "—", icon: AlertCircle, sub: "recoverable from open spots", highlight: idleRevenueCents > 0 },
        ].map(stat => (
          <Card key={stat.label} className={`p-4 space-y-1 ${stat.highlight ? "border-yellow-500/40" : ""}`} data-testid={`stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}>
            <div className={`flex items-center gap-2 ${stat.highlight ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
              <stat.icon className="h-4 w-4" />
              <span className="text-xs font-medium">{stat.label}</span>
            </div>
            <p className={`text-2xl font-bold ${stat.highlight ? "text-yellow-600 dark:text-yellow-400" : ""}`}>{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      {/* ── Utilization Distribution ── */}
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-muted-foreground" />Utilization Distribution</p>
        <div className="flex items-center gap-4 flex-wrap mb-3">
          {[
            { dot: "bg-red-500", label: "High Risk (21+ sess)", count: highUtil },
            { dot: "bg-green-500", label: "Healthy (11–20)", count: midUtil },
            { dot: "bg-yellow-500", label: "Low (≤10 sess)", count: lowUtil },
          ].map(d => (
            <div key={d.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${d.dot}`} />
              <span className="text-sm">{d.label}: <strong>{d.count}</strong></span>
            </div>
          ))}
          <div className="ml-auto">
            <Badge variant="outline" className="text-xs">Avg: {avgUtilization}%</Badge>
          </div>
        </div>
        <div className="flex gap-0.5 rounded-full overflow-hidden h-3">
          {coaches.length > 0 ? (
            [...coaches].sort((a, b) => b.utilizationPct - a.utilizationPct).map(c => {
              const color = c.utilizationPct >= 67 ? "bg-red-500" : c.utilizationPct >= 37 ? "bg-green-500" : "bg-yellow-500";
              return <div key={c.coachId} className={color} style={{ flex: 1 }} title={`${c.firstName}: ${c.utilizationPct}%`} />;
            })
          ) : (
            <div className="bg-muted w-full rounded-full" />
          )}
        </div>
      </Card>

      {/* ── Schedule Health ── */}
      <HealthScoreBanner />

      {/* ── Predictive Workforce Signals (Phase 2) ── */}
      <PredictiveWorkforcePanel intelligenceData={intelligenceData} capacityRecs={capacityRecs} />

      {/* ── Capacity Optimization ── */}
      <CapacityOptimizationPanel />

      {/* ── Retention Risk ── */}
      <RetentionRiskPanel />

      {/* ── Workforce Attention Summary ── */}
      <UtilizationIntelligencePanel intelligence={intelligenceData} />

      {/* ── Search + Status Filter ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search coaches…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-coaches"
          />
        </div>
        <div className="overflow-x-auto">
          <Tabs value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
            <TabsList className="h-9" data-testid="tabs-status-filter">
              <TabsTrigger value="all" className="text-xs px-2.5">All ({statusCounts.all})</TabsTrigger>
              {(statusCounts.overloaded ?? 0) > 0 && (
                <TabsTrigger value="overloaded" className="text-xs px-2.5">Overloaded ({statusCounts.overloaded})</TabsTrigger>
              )}
              {(statusCounts.near_capacity ?? 0) > 0 && (
                <TabsTrigger value="near_capacity" className="text-xs px-2.5">Near Cap. ({statusCounts.near_capacity})</TabsTrigger>
              )}
              {(statusCounts.optimal ?? 0) > 0 && (
                <TabsTrigger value="optimal" className="text-xs px-2.5">Optimal ({statusCounts.optimal})</TabsTrigger>
              )}
              {(statusCounts.underutilized ?? 0) > 0 && (
                <TabsTrigger value="underutilized" className="text-xs px-2.5">Underused ({statusCounts.underutilized})</TabsTrigger>
              )}
              {(statusCounts.inactive ?? 0) > 0 && (
                <TabsTrigger value="inactive" className="text-xs px-2.5">Inactive ({statusCounts.inactive})</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* ── Coach Cards ── */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground font-medium">
            {search || statusFilter !== "all" ? "No coaches match this filter" : "No coach data available for this period"}
          </p>
          {(search || statusFilter !== "all") && (
            <Button variant="ghost" size="sm" className="mt-3 text-xs" onClick={() => { setSearch(""); setStatusFilter("all"); }}>
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(coach => {
            const fullName = `${coach.firstName || ""} ${coach.lastName || ""}`.trim().toLowerCase();
            const intel = intelligenceById.get(coach.coachId) ?? intelligenceByName.get(fullName);
            return (
              <CoachCard
                key={coach.coachId}
                coach={coach}
                intelligence={intel}
                isNextAthlete={coach.coachId === nextAthleteCoachId}
              />
            );
          })}
        </div>
      )}

      {/* ── Agent Reputation (Phase 2) ── */}
      <WorkforceAgentReputationPanel />

      {/* ── Organizational Learning (Phase 2) ── */}
      <OrganizationalLearningPanel />

      {/* ── Recommendation Lifecycle History ── */}
      <RecommendationHistoryPanel />

      {data && (
        <p className="text-xs text-muted-foreground text-right">
          Period: {new Date(data.startDate).toLocaleDateString()} – {new Date(data.endDate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
