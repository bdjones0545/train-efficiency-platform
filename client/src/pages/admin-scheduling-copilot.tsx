import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  Bot, Send, User, Sparkles, TrendingUp, Users,
  DollarSign, Calendar, RefreshCw, Lightbulb, Mic, MicOff,
  AlertTriangle, Zap, Target, BarChart3, CheckCircle2,
  Clock, ChevronRight, Activity, Brain,
  ShieldCheck, UserCheck, AlertCircle, Eye,
  CheckSquare, Cpu, GitBranch, Gauge,
  ThumbsUp, ThumbsDown, X, Check, Star,
  TrendingDown, History, BookOpen, Flame, Award,
  MessageSquare, Layers
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportingData {
  sessionsThisWeek: number;
  cancellationsThisWeek: number;
  sessions30Days: number;
  upcomingSessions: { name: string; coach: string; start: string; registered: number; capacity: number }[];
  recentClients: { name: string; lastBooking: string; totalBookings: number }[];
  generatedAt: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  supportingData?: SupportingData;
}

interface HealthScore {
  score: number;
  label: string;
  summary: string;
  breakdown: { utilization: number; revenue: number; attendance: number; retention: number; waitlist: number };
  metrics: { avgUtilization: number; revenueCapturePct: number; attendanceRate: number; cancelRate: number; waitlistCount: number; activeSessionsThisWeek: number };
}

interface Opportunity {
  id: string;
  type: string;
  category: "revenue" | "capacity" | "retention" | "coach";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  estimatedValueCents: number;
  actionLabel: string;
  sessionId?: string;
  clientId?: string;
  openSpots?: number;
  registered?: number;
  capacity?: number;
  waitlistCount?: number;
  daysInactive?: number;
}

interface OpportunityData {
  opportunities: Opportunity[];
  counts: { total: number; critical: number; high: number; byCategory: { revenue: number; capacity: number; retention: number; coach: number } };
  estimatedTotalValueCents: number;
}

interface RetentionSummary {
  summary: { highRisk: number; mediumRisk: number; totalAtRisk: number };
}

interface HistoryAction {
  id: string;
  opportunityId: string;
  title: string;
  type: string;
  category: string;
  action: "approved" | "rejected" | "dismissed";
  estimatedValueCents: number;
  notes: string | null;
  actionedAt: string;
}

interface RecommendationHistory {
  actions: HistoryAction[];
  summary: { total: number; approved: number; rejected: number; dismissed: number; approvalRate: number; totalApprovedValueCents: number };
}

interface AgentReputation {
  recommendations: { total: number; approved: number; rejected: number; dismissed: number; approvalRate: number; avgApprovedValueCents: number; totalApprovedValueCents: number };
  campaigns: { total: number; approved: number; rejected: number; approvalRate: number };
  trustTier: string;
  categoryBreakdown: { category: string; total: number; approved: number; approvalRate: number }[];
  signalVelocity: { day: string; count: number }[];
}

interface LearningInsight {
  type: string;
  insight: string;
  detail: string;
  severity: "info" | "warning" | "success";
}

interface LearningInsightsData {
  insights: LearningInsight[];
  dataSourcesSampled: Record<string, number>;
  generatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function deriveWorkflowStage(health: HealthScore | undefined, opps: OpportunityData | undefined) {
  const criticalCount = opps?.counts?.critical ?? 0;
  const totalOpps = opps?.counts?.total ?? 0;
  const score = health?.score ?? 0;
  if (criticalCount > 0) return { stage: "Detect Issues", icon: AlertTriangle, color: "text-red-600 dark:text-red-400", description: `${criticalCount} critical issue${criticalCount !== 1 ? "s" : ""} need immediate action` };
  if (totalOpps > 5) return { stage: "Analyze", icon: Brain, color: "text-orange-600 dark:text-orange-400", description: `${totalOpps} opportunities detected for review` };
  if (totalOpps > 0) return { stage: "Recommend", icon: Lightbulb, color: "text-yellow-600 dark:text-yellow-400", description: "Recommendations ready for review and approval" };
  if (score >= 80) return { stage: "Optimize", icon: TrendingUp, color: "text-green-600 dark:text-green-400", description: "Schedule is healthy — focus on continuous improvement" };
  return { stage: "Observe", icon: Eye, color: "text-blue-600 dark:text-blue-400", description: "Monitoring schedule health and collecting signals" };
}

function categoryIcon(category: string, size = "h-3.5 w-3.5") {
  switch (category) {
    case "revenue": return <DollarSign className={`${size} text-green-500`} />;
    case "capacity": return <BarChart3 className={`${size} text-purple-500`} />;
    case "retention": return <UserCheck className={`${size} text-blue-500`} />;
    case "coach": return <Activity className={`${size} text-orange-500`} />;
    default: return <Zap className={`${size} text-muted-foreground`} />;
  }
}

function priorityColor(priority: string) {
  switch (priority) {
    case "critical": return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20";
    case "high": return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20";
    case "medium": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
    default: return "bg-muted text-muted-foreground";
  }
}

function agentOwner(type: string): string {
  switch (type) {
    case "fill_session":
    case "recover_cancellation": return "Scheduling + Revenue";
    case "waitlist_demand": return "Scheduling Agent";
    case "reactivation": return "Retention + AgentMail";
    case "coach_underutilized":
    case "coach_overloaded": return "Scheduling Agent";
    default: return "Scheduling Agent";
  }
}

function actionBadge(action: string) {
  switch (action) {
    case "approved": return <Badge className="text-[9px] h-4 px-1.5 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20 gap-0.5"><Check className="h-2.5 w-2.5" />Approved</Badge>;
    case "rejected": return <Badge className="text-[9px] h-4 px-1.5 bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 gap-0.5"><X className="h-2.5 w-2.5" />Rejected</Badge>;
    case "dismissed": return <Badge className="text-[9px] h-4 px-1.5 bg-muted text-muted-foreground gap-0.5"><X className="h-2.5 w-2.5" />Dismissed</Badge>;
    default: return null;
  }
}

function insightSeverityStyle(severity: string) {
  switch (severity) {
    case "warning": return "border-orange-500/20 bg-orange-500/5";
    case "success": return "border-green-500/20 bg-green-500/5";
    default: return "border-border bg-muted/20";
  }
}

function insightIcon(type: string, severity: string) {
  const color = severity === "warning" ? "text-orange-600 dark:text-orange-400" :
                severity === "success" ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400";
  switch (type) {
    case "session_type": return <Layers className={`h-3.5 w-3.5 ${color}`} />;
    case "cancellation_pattern": return <TrendingDown className={`h-3.5 w-3.5 ${color}`} />;
    case "coach_performance": return <Activity className={`h-3.5 w-3.5 ${color}`} />;
    case "peak_demand": return <Flame className={`h-3.5 w-3.5 ${color}`} />;
    case "no_show": return <AlertCircle className={`h-3.5 w-3.5 ${color}`} />;
    case "athlete_behavior": return <Users className={`h-3.5 w-3.5 ${color}`} />;
    default: return <Brain className={`h-3.5 w-3.5 ${color}`} />;
  }
}

// ── Critical Alert Banner ─────────────────────────────────────────────────────

function CriticalAlertBanner({ opps, onAsk }: { opps: OpportunityData | undefined; onAsk: (q: string) => void }) {
  const critical = (opps?.opportunities ?? []).filter(o => o.priority === "critical");
  if (critical.length === 0) return null;
  const top = critical[0];
  const value = top.estimatedValueCents > 0 ? ` · $${Math.round(top.estimatedValueCents / 100)} at stake` : "";
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-red-500/8 border-red-500/20 text-xs" data-testid="critical-alert-banner">
      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-red-700 dark:text-red-400">Critical: </span>
        <span className="text-foreground truncate">{top.title}{value}</span>
      </div>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-red-700 dark:text-red-400 hover:bg-red-500/10 shrink-0"
        onClick={() => onAsk(`What should I do about this critical issue: "${top.title}"?`)}
        data-testid="button-ask-critical">
        Ask AI <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
      </Button>
    </div>
  );
}

// ── Health Score Widget ───────────────────────────────────────────────────────

function HealthScoreWidget({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<HealthScore>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/health-score"),
    refetchInterval: 120_000,
  });
  if (isLoading) return <Skeleton className="h-36" />;
  if (!data || typeof data.score !== "number") return null;

  const scoreColor = data.score >= 90 ? "text-green-600 dark:text-green-400" :
                     data.score >= 75 ? "text-blue-600 dark:text-blue-400" :
                     data.score >= 60 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
  const scoreBg = data.score >= 90 ? "bg-green-500/10 border-green-500/20" :
                  data.score >= 75 ? "bg-blue-500/10 border-blue-500/20" :
                  data.score >= 60 ? "bg-yellow-500/10 border-yellow-500/20" : "bg-red-500/10 border-red-500/20";
  const breakdown = [
    { label: "Util", value: data.breakdown?.utilization ?? 0 },
    { label: "Revenue", value: data.breakdown?.revenue ?? 0 },
    { label: "Attend", value: data.breakdown?.attendance ?? 0 },
    { label: "Retain", value: data.breakdown?.retention ?? 0 },
    { label: "WL", value: data.breakdown?.waitlist ?? 0 },
  ];
  const lowestFactor = [...breakdown].sort((a, b) => a.value - b.value)[0];
  const metrics = data.metrics ?? {};

  return (
    <Card className={`p-4 border ${scoreBg}`} data-testid="health-score-widget">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scheduling Health</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-3xl font-bold ${scoreColor}`}>{data.score}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            <Badge className={`text-[10px] ${scoreBg} ${scoreColor} border`}>{data.label}</Badge>
          </div>
        </div>
        <Gauge className={`h-7 w-7 ${scoreColor} opacity-60`} />
      </div>
      <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">{data.summary}</p>
      <div className="grid grid-cols-5 gap-1 mb-2">
        {breakdown.map(b => {
          const barColor = b.value >= 80 ? "bg-green-500" : b.value >= 60 ? "bg-yellow-500" : "bg-red-500";
          return (
            <div key={b.label} className="space-y-0.5" data-testid={`health-factor-${b.label.toLowerCase()}`}>
              <p className="text-[10px] text-muted-foreground text-center">{b.label}</p>
              <div className="bg-muted rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${b.value}%` }} />
              </div>
              <p className="text-[10px] text-center font-medium">{b.value}</p>
            </div>
          );
        })}
      </div>
      {metrics.activeSessionsThisWeek !== undefined && (
        <div className="grid grid-cols-3 gap-1 border-t pt-2">
          <div className="text-center">
            <p className="text-sm font-bold">{metrics.activeSessionsThisWeek}</p>
            <p className="text-[9px] text-muted-foreground">sessions/wk</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold">{metrics.cancelRate ?? 0}%</p>
            <p className="text-[9px] text-muted-foreground">cancel rate</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold">{metrics.waitlistCount ?? 0}</p>
            <p className="text-[9px] text-muted-foreground">waitlisted</p>
          </div>
        </div>
      )}
      {data.score < 80 && lowestFactor && (
        <Button variant="ghost" size="sm" className={`w-full mt-2 h-7 text-[11px] ${scoreColor} hover:bg-current/5`}
          onClick={() => onAsk(`My ${lowestFactor.label} score is ${lowestFactor.value}/100. What specific actions should I take to improve it?`)}
          data-testid="button-ask-improve-score">
          <Lightbulb className="h-3 w-3 mr-1.5" />How to improve {lowestFactor.label}?
        </Button>
      )}
    </Card>
  );
}

// ── Live Signals Panel with Approve / Reject / Dismiss ────────────────────────

function LiveSignalsPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [actioned, setActioned] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/opportunities")
      .catch(() => ({ opportunities: [], counts: { total: 0, critical: 0, high: 0, byCategory: {} }, estimatedTotalValueCents: 0 })),
    refetchInterval: 60_000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ opp, action }: { opp: Opportunity; action: string }) =>
      apiRequest("POST", "/api/scheduling-intelligence/recommendation-action", {
        opportunityId: opp.id,
        opportunityTitle: opp.title,
        opportunityType: opp.type,
        opportunityCategory: opp.category,
        action,
        estimatedValueCents: opp.estimatedValueCents ?? 0,
      }).then(r => r.json()),
    onSuccess: (_, { opp, action }) => {
      setActioned(prev => ({ ...prev, [opp.id]: action }));
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/recommendation-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/agent-reputation"] });
      const labels: Record<string, string> = { approved: "Approved ✓", rejected: "Rejected", dismissed: "Dismissed" };
      toast({ title: labels[action] ?? action, description: opp.title, duration: 2500 });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>;

  const opps = data?.opportunities ?? [];
  if (opps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="h-7 w-7 text-green-500" />
        <p className="text-sm font-medium text-green-700 dark:text-green-400">No active issues</p>
        <p className="text-xs text-muted-foreground">Schedule is operating cleanly. AI is monitoring for new signals.</p>
      </div>
    );
  }

  const totalValue = data?.estimatedTotalValueCents ?? 0;

  return (
    <div className="space-y-2" data-testid="live-signals-panel">
      {totalValue > 0 && (
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-muted-foreground">{opps.length} signal{opps.length !== 1 ? "s" : ""}</span>
          <span className="font-semibold text-green-700 dark:text-green-400">${Math.round(totalValue / 100).toLocaleString()} recoverable</span>
        </div>
      )}
      {opps.slice(0, 6).map((opp, i) => {
        const alreadyActioned = actioned[opp.id];
        const isPending = actionMutation.isPending;
        return (
          <div key={opp.id} className={`rounded-lg border p-2.5 space-y-1.5 transition-colors ${alreadyActioned ? "opacity-50 bg-muted/20" : "bg-background hover:bg-muted/30"}`}
            data-testid={`signal-card-${i}`}>
            <div className="flex items-start gap-1.5">
              {categoryIcon(opp.category)}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold leading-snug">{opp.title}</p>
                <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{opp.description}</p>
              </div>
              <Badge className={`text-[9px] shrink-0 h-4 px-1.5 ${priorityColor(opp.priority)}`}>{opp.priority}</Badge>
            </div>
            {opp.estimatedValueCents > 0 && (
              <div className="flex items-center gap-1 text-[10px]">
                <DollarSign className="h-2.5 w-2.5 text-green-500" />
                <span className="font-medium text-green-700 dark:text-green-400">+${Math.round(opp.estimatedValueCents / 100)} est. value</span>
                <span className="text-muted-foreground ml-1.5">· <Cpu className="h-2.5 w-2.5 inline mr-0.5" />{agentOwner(opp.type)}</span>
              </div>
            )}
            {alreadyActioned ? (
              <p className="text-[10px] text-muted-foreground capitalize">Marked as {alreadyActioned}</p>
            ) : (
              <div className="flex items-center gap-1 pt-0.5">
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-green-700 dark:text-green-400 hover:bg-green-500/10"
                  disabled={isPending}
                  onClick={() => actionMutation.mutate({ opp, action: "approved" })}
                  data-testid={`button-approve-${i}`}>
                  <ThumbsUp className="h-2.5 w-2.5 mr-0.5" />Approve
                </Button>
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-red-700 dark:text-red-400 hover:bg-red-500/10"
                  disabled={isPending}
                  onClick={() => actionMutation.mutate({ opp, action: "rejected" })}
                  data-testid={`button-reject-${i}`}>
                  <ThumbsDown className="h-2.5 w-2.5 mr-0.5" />Reject
                </Button>
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-muted-foreground hover:bg-muted"
                  disabled={isPending}
                  onClick={() => actionMutation.mutate({ opp, action: "dismissed" })}
                  data-testid={`button-dismiss-${i}`}>
                  <X className="h-2.5 w-2.5 mr-0.5" />Dismiss
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-primary hover:bg-primary/10"
                  onClick={() => {
                    const valueHint = opp.estimatedValueCents > 0 ? ` ($${Math.round(opp.estimatedValueCents / 100)} at stake)` : "";
                    onAsk(`Tell me exactly what to do about: "${opp.title}"${valueHint}`);
                  }}
                  data-testid={`button-ask-signal-${i}`}>
                  Ask AI <ChevronRight className="h-2.5 w-2.5" />
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {opps.length > 6 && (
        <Link href="/admin/scheduling-opportunity-inbox">
          <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1">
            View all {opps.length} signals <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
      )}
    </div>
  );
}

// ── Recommendation History Panel ───────────────────────────────────────────────

function RecommendationHistoryPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<RecommendationHistory>({
    queryKey: ["/api/scheduling-intelligence/recommendation-history"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/recommendation-history").catch(() => null),
    staleTime: 30_000,
  });

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}</div>;

  const actions = data?.actions ?? [];
  const summary = data?.summary;

  if (!summary || summary.total === 0) {
    return (
      <div className="py-6 text-center space-y-2">
        <History className="h-7 w-7 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">No actions yet</p>
        <p className="text-xs text-muted-foreground">Approve, reject, or dismiss signals in the Signals tab to build your recommendation history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="recommendation-history-panel">
      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-base font-bold text-green-700 dark:text-green-400">{summary.approved}</p>
          <p className="text-[9px] text-muted-foreground">Approved</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-base font-bold text-red-700 dark:text-red-400">{summary.rejected}</p>
          <p className="text-[9px] text-muted-foreground">Rejected</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-base font-bold">{summary.approvalRate}%</p>
          <p className="text-[9px] text-muted-foreground">Approval rate</p>
        </div>
      </div>
      {summary.totalApprovedValueCents > 0 && (
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-green-500/8 border border-green-500/15 text-xs">
          <DollarSign className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-green-700 dark:text-green-400 font-medium">${Math.round(summary.totalApprovedValueCents / 100).toLocaleString()}</span>
          <span className="text-muted-foreground">in approved recommendation value (30 days)</span>
        </div>
      )}
      {/* Action list */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent decisions</p>
        {actions.slice(0, 10).map((a, i) => (
          <div key={a.id} className="flex items-start gap-2 py-1.5 border-b last:border-b-0" data-testid={`history-row-${i}`}>
            <div className="mt-0.5">{categoryIcon(a.category, "h-3 w-3")}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium leading-snug truncate">{a.title}</p>
              <p className="text-[9px] text-muted-foreground">
                {a.actionedAt ? format(new Date(a.actionedAt), "MMM d, h:mm a") : ""}
                {a.estimatedValueCents > 0 && ` · $${Math.round(a.estimatedValueCents / 100)}`}
              </p>
            </div>
            {actionBadge(a.action)}
          </div>
        ))}
      </div>
      {summary.rejected > 0 && (
        <Button variant="ghost" size="sm" className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => onAsk(`I've rejected ${summary.rejected} scheduling recommendations recently. Help me understand what patterns I should look for that would actually be worth approving.`)}
          data-testid="button-analyze-rejections">
          <Brain className="h-3 w-3 mr-1.5" />Why am I rejecting these?
        </Button>
      )}
    </div>
  );
}

// ── Agent Reputation Panel ─────────────────────────────────────────────────────

function AgentReputationPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<AgentReputation>({
    queryKey: ["/api/scheduling-intelligence/agent-reputation"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/agent-reputation").catch(() => null),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>;
  if (!data) return <p className="text-xs text-muted-foreground text-center py-4">No reputation data yet. Start reviewing signals.</p>;

  const r = data.recommendations;
  const trustColor = data.trustTier === "High Trust" ? "text-green-700 dark:text-green-400" :
                     data.trustTier === "Moderate Trust" ? "text-blue-700 dark:text-blue-400" :
                     "text-muted-foreground";

  return (
    <div className="space-y-3" data-testid="agent-reputation-panel">
      {/* Trust tier */}
      <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Award className={`h-4 w-4 ${trustColor}`} />
          <div>
            <p className="text-xs font-semibold">Scheduling Agent</p>
            <p className={`text-[11px] font-medium ${trustColor}`}>{data.trustTier}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold ${trustColor}`}>{r.approvalRate}%</p>
          <p className="text-[9px] text-muted-foreground">approval rate</p>
        </div>
      </div>

      {/* Recommendations metrics */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="bg-muted/30 rounded-lg p-2 text-center">
          <p className="text-base font-bold">{r.total}</p>
          <p className="text-[9px] text-muted-foreground">Total recommendations</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2 text-center">
          <p className="text-base font-bold">{r.approved}</p>
          <p className="text-[9px] text-muted-foreground">Approved</p>
        </div>
        {r.avgApprovedValueCents > 0 && (
          <div className="bg-green-500/8 rounded-lg p-2 text-center col-span-2">
            <p className="text-base font-bold text-green-700 dark:text-green-400">${Math.round(r.avgApprovedValueCents / 100)}</p>
            <p className="text-[9px] text-muted-foreground">Avg approved value per recommendation</p>
          </div>
        )}
      </div>

      {/* Category breakdown */}
      {data.categoryBreakdown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">By category</p>
          {data.categoryBreakdown.map(cat => (
            <div key={cat.category} className="flex items-center gap-2" data-testid={`cat-breakdown-${cat.category}`}>
              <div className="w-4">{categoryIcon(cat.category, "h-3 w-3")}</div>
              <p className="text-[11px] capitalize flex-1">{cat.category}</p>
              <div className="flex-1 bg-muted rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${cat.approvalRate}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground w-8 text-right">{cat.approvalRate}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Campaign metrics */}
      {data.campaigns.total > 0 && (
        <div className="border-t pt-2.5 space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MessageSquare className="h-2.5 w-2.5" />Fill Campaign Approvals
          </p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{data.campaigns.total} campaigns reviewed</span>
            <span className="font-medium">{data.campaigns.approvalRate}% approved</span>
          </div>
        </div>
      )}

      {r.total === 0 && (
        <p className="text-[11px] text-muted-foreground text-center py-2">
          Start reviewing signals in the Signals tab to build the agent's reputation score.
        </p>
      )}

      {r.rejected > 0 && (
        <Button variant="ghost" size="sm" className="w-full h-7 text-[11px]"
          onClick={() => onAsk(`The Scheduling Agent has been rejected ${r.rejected} times. What should I tell the agent to improve its recommendations?`)}
          data-testid="button-ask-reputation">
          <Brain className="h-3 w-3 mr-1.5" />How can the agent improve?
        </Button>
      )}
    </div>
  );
}

// ── Learning Insights Panel ────────────────────────────────────────────────────

function LearningInsightsPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<LearningInsightsData>({
    queryKey: ["/api/scheduling-intelligence/learning-insights"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/learning-insights").catch(() => null),
    staleTime: 300_000,
  });

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>;

  const insights = data?.insights ?? [];

  if (insights.length === 0) {
    return (
      <div className="py-5 text-center space-y-2">
        <BookOpen className="h-7 w-7 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">Building patterns</p>
        <p className="text-xs text-muted-foreground">Intelligence grows as your scheduling history accumulates. Check back after more sessions are recorded.</p>
      </div>
    );
  }

  const sources = data?.dataSourcesSampled ?? {};

  return (
    <div className="space-y-2.5" data-testid="learning-insights-panel">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Brain className="h-2.5 w-2.5" />Discovered patterns
        </p>
        <span className="text-[9px] text-muted-foreground">{Object.values(sources).reduce((a: any, b: any) => a + b, 0)} data points</span>
      </div>
      {insights.map((ins, i) => (
        <div key={i} className={`rounded-lg border p-2.5 space-y-1 ${insightSeverityStyle(ins.severity)}`}
          data-testid={`insight-card-${i}`}>
          <div className="flex items-start gap-1.5">
            {insightIcon(ins.type, ins.severity)}
            <p className="text-[11px] font-semibold leading-snug flex-1">{ins.insight}</p>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed pl-5">{ins.detail}</p>
          <div className="pl-5">
            <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-primary hover:bg-primary/10 -ml-1"
              onClick={() => onAsk(`Based on this pattern: "${ins.insight}". What specific scheduling changes should I make?`)}
              data-testid={`button-ask-insight-${i}`}>
              What should I do? <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
            </Button>
          </div>
        </div>
      ))}
      <p className="text-[9px] text-muted-foreground flex items-center gap-1 pt-1">
        <ShieldCheck className="h-2.5 w-2.5" />
        Derived from {Object.keys(sources).join(", ")} · deterministic analysis · no fabrication
      </p>
    </div>
  );
}

// ── Retention Risk Widget ─────────────────────────────────────────────────────

function RetentionRiskWidget({ onAsk }: { onAsk: (q: string) => void }) {
  const { data } = useQuery<RetentionSummary>({
    queryKey: ["/api/scheduling-intelligence/retention-risk"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/retention-risk").catch(() => null),
    staleTime: 300_000,
  });
  if (!data?.summary || data.summary.totalAtRisk === 0) return null;
  const { highRisk, mediumRisk, totalAtRisk } = data.summary;
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-blue-500/5 border-blue-500/15 cursor-pointer hover:bg-blue-500/10 transition-colors"
      onClick={() => onAsk(`I have ${highRisk} high-risk and ${mediumRisk} medium-risk clients. Who are they and what outreach should I prioritize?`)}
      data-testid="retention-risk-widget">
      <UserCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Retention Risk</p>
        <p className="text-[10px] text-muted-foreground">
          {highRisk > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{highRisk} high-risk</span>}
          {highRisk > 0 && mediumRisk > 0 && " · "}
          {mediumRisk > 0 && <span>{mediumRisk} medium</span>}
          {" "}· {totalAtRisk} total
        </p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── Dynamic Suggested Questions ────────────────────────────────────────────────

function DynamicQuestions({ opps, onAsk }: { opps: OpportunityData | undefined; onAsk: (q: string) => void }) {
  const staticQs = [
    "Which sessions have the lowest fill rates this week?",
    "Which coaches are underutilized right now?",
    "What's my estimated revenue gap for open spots?",
    "What days should I add more sessions based on demand?",
    "How can I improve my scheduling health score?",
    "Who are my most at-risk clients for churning?",
  ];
  const dynamicQs: string[] = [];
  const opportunities = opps?.opportunities ?? [];
  const criticalOpp = opportunities.find(o => o.priority === "critical");
  if (criticalOpp) dynamicQs.push(`What's the fastest way to address: "${criticalOpp.title}"?`);
  const revenueOpps = opportunities.filter(o => o.category === "revenue");
  if (revenueOpps.length > 0) {
    const totalValue = revenueOpps.reduce((s, o) => s + (o.estimatedValueCents ?? 0), 0);
    if (totalValue > 0) dynamicQs.push(`I have $${Math.round(totalValue / 100)} in recoverable revenue. What should I do first?`);
  }
  const waitlistOpps = opportunities.filter(o => o.type === "waitlist_demand");
  if (waitlistOpps.length > 0) dynamicQs.push(`${waitlistOpps.length} sessions have waitlisted athletes. Should I expand capacity or add new sessions?`);
  const coachOpps = opportunities.filter(o => o.category === "coach");
  if (coachOpps.length > 0) dynamicQs.push(`${coachOpps.length} coach utilization issues detected. How should I rebalance the schedule?`);
  const allQs = [...dynamicQs, ...staticQs].slice(0, 7);

  return (
    <div className="space-y-1">
      {allQs.map((q, i) => (
        <button key={i} onClick={() => onAsk(q)}
          className="w-full text-left text-[11px] p-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors leading-relaxed"
          data-testid={`button-suggested-${i}`}>
          {i < dynamicQs.length && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 mb-0.5 align-middle" />}
          {q}
        </button>
      ))}
    </div>
  );
}

// ── Workflow Stage Bar ─────────────────────────────────────────────────────────

function WorkflowStageBar({ health, opps }: { health: HealthScore | undefined; opps: OpportunityData | undefined }) {
  const stage = deriveWorkflowStage(health, opps);
  const Icon = stage.icon;
  const stages = ["Observe", "Detect Issues", "Analyze", "Recommend", "Optimize"];
  const currentIdx = stages.indexOf(stage.stage);
  return (
    <div className="px-4 pt-3 pb-2 border-b bg-muted/20" data-testid="workflow-stage-bar">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${stage.color}`} />
          <span className={`text-xs font-semibold ${stage.color}`}>{stage.stage}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{stage.description}</span>
      </div>
      <div className="flex gap-1">
        {stages.map((s, i) => (
          <div key={s} className={`flex-1 h-0.5 rounded-full ${i <= currentIdx ? "bg-primary" : "bg-muted-foreground/20"}`} />
        ))}
      </div>
    </div>
  );
}

// ── Agent Coordination Strip ───────────────────────────────────────────────────

function AgentCoordinationStrip({ opps }: { opps: OpportunityData | undefined }) {
  const counts = opps?.counts;
  if (!counts || counts.total === 0) return null;
  const agents = [
    { name: "Scheduling", active: true, signal: `${counts.total} signals` },
    { name: "Revenue", active: (counts.byCategory?.revenue ?? 0) > 0, signal: `$${Math.round((opps?.estimatedTotalValueCents ?? 0) / 100)} gap` },
    { name: "Retention", active: (counts.byCategory?.retention ?? 0) > 0, signal: `${counts.byCategory?.retention ?? 0} at-risk` },
    { name: "AgentMail", active: (counts.byCategory?.revenue ?? 0) > 0 || (counts.byCategory?.retention ?? 0) > 0, signal: "Ready to draft" },
  ];
  return (
    <div className="px-4 py-2 border-b bg-muted/10" data-testid="agent-coordination-strip">
      <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <GitBranch className="h-2.5 w-2.5" />Agent Coordination
      </p>
      <div className="flex gap-2 flex-wrap">
        {agents.map(agent => (
          <div key={agent.name}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] ${agent.active ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted/30 border-muted text-muted-foreground"}`}
            data-testid={`agent-pill-${agent.name.toLowerCase()}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${agent.active ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
            {agent.name}
            {agent.active && <span className="text-[8px] opacity-70">· {agent.signal}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Supporting Data Panel ─────────────────────────────────────────────────────

function SupportingDataPanel({ data }: { data: SupportingData }) {
  const [showUpcoming, setShowUpcoming] = useState(false);
  const signals = [
    { label: "Session utilization", present: data.sessionsThisWeek > 0, description: `${data.sessionsThisWeek} sessions` },
    { label: "Cancellation rate", present: data.cancellationsThisWeek > 0, description: `${data.cancellationsThisWeek} cancels` },
    { label: "30-day trend", present: data.sessions30Days > 0, description: `${data.sessions30Days} sessions` },
    { label: "Client activity", present: data.recentClients?.length > 0, description: `${data.recentClients?.length ?? 0} reviewed` },
    { label: "Upcoming sessions", present: data.upcomingSessions?.length > 0, description: `${data.upcomingSessions?.length ?? 0} upcoming` },
  ];
  return (
    <div className="ml-11 mt-1.5 rounded-lg border bg-muted/30 text-xs overflow-hidden" data-testid="copilot-supporting-data">
      <div className="px-3 pt-2.5 pb-2.5 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />Evidence — live data used to answer this
        </p>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded bg-background border p-1.5">
            <p className="text-sm font-bold">{data.sessionsThisWeek}</p>
            <p className="text-[9px] text-muted-foreground">Sessions/wk</p>
          </div>
          <div className="rounded bg-background border p-1.5">
            <p className="text-sm font-bold">{data.sessions30Days}</p>
            <p className="text-[9px] text-muted-foreground">Last 30d</p>
          </div>
          <div className="rounded bg-background border p-1.5">
            <p className="text-sm font-bold">{data.cancellationsThisWeek}</p>
            <p className="text-[9px] text-muted-foreground">Cancels/wk</p>
          </div>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1 mb-1">
            <Eye className="h-2.5 w-2.5" />Scheduling signals detected
          </p>
          {signals.filter(s => s.present).map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <CheckSquare className="h-2.5 w-2.5 text-green-500 shrink-0" />
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground">· {s.description}</span>
            </div>
          ))}
        </div>
        {data.upcomingSessions.length > 0 && (
          <div>
            <button onClick={() => setShowUpcoming(v => !v)}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
              {showUpcoming ? "Hide" : "Show"} upcoming sessions ({data.upcomingSessions.length})
            </button>
            {showUpcoming && (
              <div className="mt-1 space-y-0.5">
                {data.upcomingSessions.slice(0, 4).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="truncate max-w-[150px] font-medium">{s.name}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{s.registered}/{s.capacity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-[9px] text-muted-foreground flex items-center gap-1 border-t pt-1.5">
          <Brain className="h-2.5 w-2.5" />Grounded in deterministic scheduling data · no fabrication
        </p>
      </div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className="space-y-1" data-testid={`message-${message.role}`}>
      <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isUser ? "bg-primary text-primary-foreground" : "bg-violet-500/20 text-violet-600 dark:text-violet-400"}`}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
        <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
          <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
            {message.content}
          </div>
          <p className="text-[10px] text-muted-foreground px-1">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
      {!isUser && message.supportingData && <SupportingDataPanel data={message.supportingData} />}
    </div>
  );
}

// ── Voice Input ───────────────────────────────────────────────────────────────

function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const toggle = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onstart = () => setListening(true);
    r.onresult = (e: any) => {
      const t = Array.from(e.results as SpeechRecognitionResultList)
        .map((x: SpeechRecognitionResult) => x[0].transcript).join(" ").trim();
      if (t) onTranscript(t);
    };
    r.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        toast({ title: "Voice error", description: e.error === "not-allowed" ? "Microphone denied" : e.error, variant: "destructive" });
      }
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    r.start();
  }, [listening, onTranscript, toast]);

  return { listening, supported, toggle };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSchedulingCopilotPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "Hi! I'm your Scheduling Intelligence Copilot. I have access to live scheduling data — sessions, coach utilization, retention signals, fill rates, and revenue gaps. The left panel shows your current signals and patterns. What would you like to optimize?",
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handleVoiceTranscript = useCallback((text: string) => setInput(prev => prev ? `${prev} ${text}` : text), []);
  const { listening, supported: voiceSupported, toggle: toggleVoice } = useVoiceInput(handleVoiceTranscript);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const { data: healthData } = useQuery<HealthScore>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/health-score"),
    staleTime: 120_000,
  });
  const { data: oppsData } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/opportunities")
      .catch(() => ({ opportunities: [], counts: { total: 0, critical: 0, high: 0, byCategory: {} }, estimatedTotalValueCents: 0 })),
    staleTime: 60_000,
  });

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res = await apiRequest("POST", "/api/scheduling-intelligence/copilot", { question, conversationHistory: history });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.answer ?? "I couldn't generate a response.", timestamp: new Date(), supportingData: data.supportingData }]);
    },
    onError: (err: any) => {
      const rawMsg = err?.message ?? "";
      let detail = "Could not reach the AI copilot.";
      try { const p = JSON.parse(rawMsg.replace(/^\d+:\s*/, "")); detail = p.error ?? p.message ?? detail; } catch { if (rawMsg) detail = rawMsg; }
      toast({ title: "Copilot Error", description: detail, variant: "destructive" });
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, I encountered an error: ${detail}`, timestamp: new Date() }]);
    },
  });

  const handleSend = useCallback((text?: string) => {
    const question = (text ?? input).trim();
    if (!question) return;
    setMessages(prev => [...prev, { role: "user", content: question, timestamp: new Date() }]);
    setInput("");
    askMutation.mutate(question);
  }, [input, askMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const stage = deriveWorkflowStage(healthData, oppsData);
  const StageIcon = stage.icon;
  const criticalCount = oppsData?.counts?.critical ?? 0;
  const totalOpps = oppsData?.counts?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-violet-600 dark:text-violet-400" />
            Scheduling AI Copilot
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm flex items-center gap-2">
            Intelligent operations engine — live signals, learning, outcome tracking, agent coordination
            <Badge className="text-[10px] flex items-center gap-1 h-4 px-1.5">
              <StageIcon className={`h-2.5 w-2.5 ${stage.color}`} />
              {stage.stage}
            </Badge>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {criticalCount > 0 && (
            <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 animate-pulse">
              {criticalCount} critical
            </Badge>
          )}
          <Link href="/admin/scheduling-opportunity-inbox">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-opportunity-inbox">
              <Zap className="h-3.5 w-3.5" />Opportunity Inbox
              {totalOpps > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 ml-0.5">{totalOpps}</Badge>}
            </Button>
          </Link>
          <Link href="/admin/scheduling-command-center">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-command-center">
              <BarChart3 className="h-3.5 w-3.5" />Command Center
            </Button>
          </Link>
        </div>
      </div>

      <CriticalAlertBanner opps={oppsData} onAsk={handleSend} />

      <div className="grid lg:grid-cols-3 gap-5">
        {/* ── Left Intelligence Panel ── */}
        <div className="space-y-3">
          <HealthScoreWidget onAsk={handleSend} />
          <RetentionRiskWidget onAsk={handleSend} />

          <Card className="overflow-hidden">
            <Tabs defaultValue="signals">
              <div className="border-b px-3 pt-3 pb-0">
                <TabsList className="h-7 gap-0 w-full grid grid-cols-4">
                  <TabsTrigger value="signals" className="text-[10px] h-6 data-[state=active]:bg-background">
                    <AlertCircle className="h-3 w-3 mr-0.5" />
                    Signals
                    {totalOpps > 0 && (
                      <Badge className={`text-[9px] h-3.5 px-1 ml-0.5 ${criticalCount > 0 ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
                        {totalOpps}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-[10px] h-6 data-[state=active]:bg-background">
                    <History className="h-3 w-3 mr-0.5" />History
                  </TabsTrigger>
                  <TabsTrigger value="intelligence" className="text-[10px] h-6 data-[state=active]:bg-background">
                    <Brain className="h-3 w-3 mr-0.5" />Learn
                  </TabsTrigger>
                  <TabsTrigger value="ask" className="text-[10px] h-6 data-[state=active]:bg-background">
                    <Lightbulb className="h-3 w-3 mr-0.5" />Ask
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="signals" className="p-3 mt-0">
                <LiveSignalsPanel onAsk={handleSend} />
              </TabsContent>

              <TabsContent value="history" className="p-3 mt-0">
                <RecommendationHistoryPanel onAsk={handleSend} />
              </TabsContent>

              <TabsContent value="intelligence" className="p-3 mt-0">
                <Tabs defaultValue="insights">
                  <TabsList className="h-6 w-full grid grid-cols-2 mb-3">
                    <TabsTrigger value="insights" className="text-[10px] h-5">
                      <BookOpen className="h-2.5 w-2.5 mr-0.5" />Patterns
                    </TabsTrigger>
                    <TabsTrigger value="reputation" className="text-[10px] h-5">
                      <Star className="h-2.5 w-2.5 mr-0.5" />Agent
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="insights" className="mt-0">
                    <LearningInsightsPanel onAsk={handleSend} />
                  </TabsContent>
                  <TabsContent value="reputation" className="mt-0">
                    <AgentReputationPanel onAsk={handleSend} />
                  </TabsContent>
                </Tabs>
              </TabsContent>

              <TabsContent value="ask" className="p-3 mt-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {totalOpps > 0 ? "Context-aware questions" : "Suggested questions"}
                </p>
                <DynamicQuestions opps={oppsData} onAsk={handleSend} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* ── Chat Panel ── */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[680px] overflow-hidden">
            <WorkflowStageBar health={healthData} opps={oppsData} />
            <AgentCoordinationStrip opps={oppsData} />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
              {askMutation.isPending && (
                <div className="flex gap-3">
                  <div className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-violet-500/20 text-violet-600 dark:text-violet-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                    <span className="text-sm text-muted-foreground">Analyzing scheduling data</span>
                    <span className="flex gap-0.5 ml-1">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t p-3">
              <div className="flex gap-2">
                <Textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={listening ? "Listening… speak now" : "Ask about fill rates, revenue gaps, coach utilization, patterns, or specific sessions…"}
                  className={`resize-none min-h-[44px] max-h-[120px] text-sm transition-colors ${listening ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  rows={1} disabled={askMutation.isPending} data-testid="input-copilot-question" />
                {voiceSupported && (
                  <Button size="icon" type="button" variant="outline"
                    className={`h-11 w-11 shrink-0 transition-colors ${listening ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/30 animate-pulse" : "hover:border-violet-400 hover:text-violet-600"}`}
                    onClick={toggleVoice} disabled={askMutation.isPending}
                    title={listening ? "Stop recording" : "Start voice input"} data-testid="button-voice-input">
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                )}
                <Button size="icon" className="h-11 w-11 shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => handleSend()} disabled={!input.trim() || askMutation.isPending}
                  data-testid="button-send-copilot">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Enter to send · Shift+Enter for line break
                {voiceSupported && ` · ${listening ? "🔴 Recording" : "🎙 Voice"}`}
                {" · "}Answers grounded in live scheduling data · GPT-4o mini
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
