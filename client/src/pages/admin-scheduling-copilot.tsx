import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  Bot, Send, User, Sparkles, TrendingUp, Users,
  DollarSign, Calendar, RefreshCw, Lightbulb, Mic, MicOff,
  AlertTriangle, Zap, Target, BarChart3, CheckCircle2,
  Clock, ChevronRight, Activity, ArrowUpRight, Brain,
  ShieldCheck, UserCheck, AlertCircle, TrendingDown,
  Eye, CheckSquare, Cpu, GitBranch, Gauge
} from "lucide-react";
import { format, parseISO } from "date-fns";

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
  breakdown: {
    utilization: number;
    revenue: number;
    attendance: number;
    retention: number;
    waitlist: number;
  };
  metrics: {
    avgUtilization: number;
    revenueCapturePct: number;
    attendanceRate: number;
    cancelRate: number;
    waitlistCount: number;
    activeSessionsThisWeek: number;
  };
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
  counts: {
    total: number;
    critical: number;
    high: number;
    byCategory: { revenue: number; capacity: number; retention: number; coach: number };
  };
  estimatedTotalValueCents: number;
}

interface RetentionSummary {
  summary: { highRisk: number; mediumRisk: number; totalAtRisk: number };
}

interface ExecutiveBrief {
  revenueAtRisk: number;
  pendingApprovals: number;
  recoveredRevenue: number;
  avgFillRate: number;
}

// ── Workflow Stage ─────────────────────────────────────────────────────────────

function deriveWorkflowStage(health: HealthScore | undefined, opps: OpportunityData | undefined): {
  stage: string; icon: typeof Eye; color: string; description: string;
} {
  const criticalCount = opps?.counts?.critical ?? 0;
  const totalOpps = opps?.counts?.total ?? 0;
  const score = health?.score ?? 0;

  if (criticalCount > 0) {
    return { stage: "Detect Issues", icon: AlertTriangle, color: "text-red-600 dark:text-red-400", description: `${criticalCount} critical issue${criticalCount !== 1 ? "s" : ""} need immediate action` };
  }
  if (totalOpps > 5) {
    return { stage: "Analyze", icon: Brain, color: "text-orange-600 dark:text-orange-400", description: `${totalOpps} opportunities detected for review` };
  }
  if (totalOpps > 0) {
    return { stage: "Recommend", icon: Lightbulb, color: "text-yellow-600 dark:text-yellow-400", description: "Recommendations ready for review and approval" };
  }
  if (score >= 80) {
    return { stage: "Optimize", icon: TrendingUp, color: "text-green-600 dark:text-green-400", description: "Schedule is healthy — focus on continuous improvement" };
  }
  return { stage: "Observe", icon: Eye, color: "text-blue-600 dark:text-blue-400", description: "Monitoring schedule health and collecting signals" };
}

// ── Category helpers ────────────────────────────────────────────────────────────

function categoryIcon(category: string) {
  switch (category) {
    case "revenue": return <DollarSign className="h-3.5 w-3.5 text-green-500" />;
    case "capacity": return <BarChart3 className="h-3.5 w-3.5 text-purple-500" />;
    case "retention": return <UserCheck className="h-3.5 w-3.5 text-blue-500" />;
    case "coach": return <Activity className="h-3.5 w-3.5 text-orange-500" />;
    default: return <Zap className="h-3.5 w-3.5 text-muted-foreground" />;
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
    case "recover_cancellation": return "Scheduling + Revenue Agent";
    case "waitlist_demand": return "Scheduling Agent";
    case "reactivation": return "Retention + AgentMail";
    case "coach_underutilized":
    case "coach_overloaded": return "Scheduling Agent";
    default: return "Scheduling Agent";
  }
}

// ── Critical Alert Banner ─────────────────────────────────────────────────────

function CriticalAlertBanner({ opps, onAsk }: { opps: OpportunityData | undefined; onAsk: (q: string) => void }) {
  const critical = (opps?.opportunities ?? []).filter(o => o.priority === "critical");
  if (critical.length === 0) return null;

  const top = critical[0];
  const value = top.estimatedValueCents > 0 ? ` · $${Math.round(top.estimatedValueCents / 100)} at stake` : "";

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-red-500/8 border-red-500/20 text-xs"
      data-testid="critical-alert-banner"
    >
      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-red-700 dark:text-red-400">Critical: </span>
        <span className="text-foreground truncate">{top.title}{value}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[10px] text-red-700 dark:text-red-400 hover:bg-red-500/10 shrink-0"
        onClick={() => onAsk(`What should I do about this critical issue: "${top.title}"?`)}
        data-testid="button-ask-critical"
      >
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
                     data.score >= 60 ? "text-yellow-600 dark:text-yellow-400" :
                     "text-red-600 dark:text-red-400";
  const scoreBg = data.score >= 90 ? "bg-green-500/10 border-green-500/20" :
                  data.score >= 75 ? "bg-blue-500/10 border-blue-500/20" :
                  data.score >= 60 ? "bg-yellow-500/10 border-yellow-500/20" :
                  "bg-red-500/10 border-red-500/20";

  const breakdown = [
    { label: "Util", value: data.breakdown?.utilization ?? 0, icon: TrendingUp },
    { label: "Revenue", value: data.breakdown?.revenue ?? 0, icon: DollarSign },
    { label: "Attend", value: data.breakdown?.attendance ?? 0, icon: Users },
    { label: "Retain", value: data.breakdown?.retention ?? 0, icon: RefreshCw },
    { label: "WL", value: data.breakdown?.waitlist ?? 0, icon: Calendar },
  ];

  const metrics = data.metrics ?? {};
  const lowestFactor = [...breakdown].sort((a, b) => a.value - b.value)[0];

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
              <p className="text-[10px] text-muted-foreground text-center leading-tight">{b.label}</p>
              <div className="bg-muted rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${b.value}%` }} />
              </div>
              <p className="text-[10px] text-center font-medium">{b.value}</p>
            </div>
          );
        })}
      </div>
      {metrics.activeSessionsThisWeek !== undefined && (
        <div className="grid grid-cols-3 gap-1 border-t pt-2 mt-1">
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
        <Button
          variant="ghost"
          size="sm"
          className={`w-full mt-2 h-7 text-[11px] ${scoreColor} hover:bg-current/5`}
          onClick={() => onAsk(`My ${lowestFactor.label} score is ${lowestFactor.value}/100. What specific actions should I take to improve it?`)}
          data-testid="button-ask-improve-score"
        >
          <Lightbulb className="h-3 w-3 mr-1.5" />
          How to improve {lowestFactor.label}?
        </Button>
      )}
    </Card>
  );
}

// ── Live Signals Panel ────────────────────────────────────────────────────────

function LiveSignalsPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/opportunities").catch(() => ({ opportunities: [], counts: { total: 0, critical: 0, high: 0, byCategory: {} }, estimatedTotalValueCents: 0 })),
    refetchInterval: 60_000,
  });

  if (isLoading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
    </div>
  );

  const opps = data?.opportunities ?? [];
  if (opps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-5 text-center">
        <CheckCircle2 className="h-7 w-7 text-green-500" />
        <p className="text-sm font-medium text-green-700 dark:text-green-400">No active issues</p>
        <p className="text-xs text-muted-foreground">Your schedule is operating cleanly. AI is monitoring for new signals.</p>
      </div>
    );
  }

  const totalValue = data?.estimatedTotalValueCents ?? 0;

  return (
    <div className="space-y-2" data-testid="live-signals-panel">
      {totalValue > 0 && (
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-muted-foreground">{opps.length} signal{opps.length !== 1 ? "s" : ""} detected</span>
          <span className="font-semibold text-green-700 dark:text-green-400">
            ${Math.round(totalValue / 100).toLocaleString()} recoverable
          </span>
        </div>
      )}
      {opps.slice(0, 6).map((opp, i) => (
        <div
          key={opp.id}
          className="rounded-lg border bg-background p-2.5 space-y-1.5 hover:bg-muted/30 transition-colors"
          data-testid={`signal-card-${i}`}
        >
          <div className="flex items-start gap-1.5">
            {categoryIcon(opp.category)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <p className="text-[11px] font-semibold leading-snug">{opp.title}</p>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{opp.description}</p>
            </div>
            <Badge className={`text-[9px] shrink-0 h-4 px-1.5 ${priorityColor(opp.priority)}`}>
              {opp.priority}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {opp.estimatedValueCents > 0 && (
                <span className="text-[10px] font-medium text-green-700 dark:text-green-400">
                  +${Math.round(opp.estimatedValueCents / 100)}
                </span>
              )}
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Cpu className="h-2.5 w-2.5" />
                {agentOwner(opp.type)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-primary hover:bg-primary/10"
              onClick={() => {
                const valueHint = opp.estimatedValueCents > 0 ? ` (estimated $${Math.round(opp.estimatedValueCents / 100)} at stake)` : "";
                onAsk(`Tell me more about this scheduling signal: "${opp.title}"${valueHint}. What are the specific steps I should take?`);
              }}
              data-testid={`button-ask-signal-${i}`}
            >
              Ask AI <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
            </Button>
          </div>
        </div>
      ))}
      {opps.length > 6 && (
        <Link href="/admin/scheduling-opportunity-inbox">
          <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1" data-testid="button-view-all-signals">
            View all {opps.length} signals <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
      )}
    </div>
  );
}

// ── Retention Risk Widget ─────────────────────────────────────────────────────

function RetentionRiskWidget({ onAsk }: { onAsk: (q: string) => void }) {
  const { data, isLoading } = useQuery<RetentionSummary>({
    queryKey: ["/api/scheduling-intelligence/retention-risk"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/retention-risk").catch(() => null),
    staleTime: 300_000,
  });

  if (isLoading) return <Skeleton className="h-12" />;
  if (!data?.summary || data.summary.totalAtRisk === 0) return null;

  const { highRisk, mediumRisk, totalAtRisk } = data.summary;

  return (
    <div
      className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-blue-500/5 border-blue-500/15 cursor-pointer hover:bg-blue-500/10 transition-colors"
      onClick={() => onAsk(`I have ${highRisk} high-risk and ${mediumRisk} medium-risk clients showing churn signals. Who are they and what outreach should I prioritize?`)}
      data-testid="retention-risk-widget"
    >
      <UserCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Retention Risk</p>
        <p className="text-[10px] text-muted-foreground">
          {highRisk > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{highRisk} high-risk</span>}
          {highRisk > 0 && mediumRisk > 0 && " · "}
          {mediumRisk > 0 && <span>{mediumRisk} medium</span>}
          {" "}· {totalAtRisk} total at risk
        </p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── Dynamic Suggested Questions ────────────────────────────────────────────────

function DynamicQuestions({ opps, onAsk }: { opps: OpportunityData | undefined; onAsk: (q: string) => void }) {
  const staticQuestions = [
    "Which sessions have the lowest fill rates this week?",
    "Which coaches are underutilized right now?",
    "What's my estimated revenue gap for open spots?",
    "What days should I add more sessions based on demand?",
    "How can I improve my scheduling health score?",
    "Who are my most at-risk clients for churning?",
  ];

  const dynamicQuestions: string[] = [];
  const opportunities = opps?.opportunities ?? [];

  const criticalOpp = opportunities.find(o => o.priority === "critical");
  if (criticalOpp) {
    dynamicQuestions.push(`What's the fastest way to address: "${criticalOpp.title}"?`);
  }

  const revenueOpps = opportunities.filter(o => o.category === "revenue");
  if (revenueOpps.length > 0) {
    const totalValue = revenueOpps.reduce((s, o) => s + (o.estimatedValueCents ?? 0), 0);
    if (totalValue > 0) {
      dynamicQuestions.push(`I have $${Math.round(totalValue / 100)} in recoverable revenue across ${revenueOpps.length} sessions. What should I do first?`);
    }
  }

  const waitlistOpps = opportunities.filter(o => o.type === "waitlist_demand");
  if (waitlistOpps.length > 0) {
    dynamicQuestions.push(`${waitlistOpps.length} sessions have waitlisted athletes. Should I expand capacity or add new sessions?`);
  }

  const coachOpps = opportunities.filter(o => o.category === "coach");
  if (coachOpps.length > 0) {
    dynamicQuestions.push(`${coachOpps.length} coach utilization issues detected. How should I rebalance the schedule?`);
  }

  const allQuestions = [...dynamicQuestions, ...staticQuestions].slice(0, 7);

  return (
    <div className="space-y-1" data-testid="dynamic-questions">
      {allQuestions.map((q, i) => (
        <button
          key={i}
          onClick={() => onAsk(q)}
          className="w-full text-left text-[11px] p-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors leading-relaxed"
          data-testid={`button-suggested-${i}`}
        >
          {i < dynamicQuestions.length && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 mb-0.5 align-middle" />}
          {q}
        </button>
      ))}
    </div>
  );
}

// ── Workflow Stage Bar ────────────────────────────────────────────────────────

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
          <div
            key={s}
            className={`flex-1 h-0.5 rounded-full transition-colors ${
              i <= currentIdx ? "bg-primary" : "bg-muted-foreground/20"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Cross-Agent Coordination Strip ────────────────────────────────────────────

function AgentCoordinationStrip({ opps }: { opps: OpportunityData | undefined }) {
  const opportunities = opps?.opportunities ?? [];
  const counts = opps?.counts;
  if (!counts || counts.total === 0) return null;

  const agents: { name: string; role: string; active: boolean; signal: string }[] = [
    {
      name: "Scheduling",
      role: "Conflict & capacity detection",
      active: true,
      signal: `${counts.total} signals`,
    },
    {
      name: "Revenue",
      role: "Revenue gap estimation",
      active: (counts.byCategory?.revenue ?? 0) > 0,
      signal: `$${Math.round((opps?.estimatedTotalValueCents ?? 0) / 100)} gap`,
    },
    {
      name: "Retention",
      role: "At-risk client detection",
      active: (counts.byCategory?.retention ?? 0) > 0,
      signal: `${counts.byCategory?.retention ?? 0} at-risk`,
    },
    {
      name: "AgentMail",
      role: "Outreach drafting",
      active: (counts.byCategory?.revenue ?? 0) > 0 || (counts.byCategory?.retention ?? 0) > 0,
      signal: "Ready to draft",
    },
  ];

  return (
    <div className="px-4 py-2.5 border-b bg-muted/10" data-testid="agent-coordination-strip">
      <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <GitBranch className="h-2.5 w-2.5" />
        Agent Coordination
      </p>
      <div className="flex gap-2 flex-wrap">
        {agents.map(agent => (
          <div
            key={agent.name}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] ${
              agent.active
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-muted/30 border-muted text-muted-foreground"
            }`}
            title={`${agent.role} · ${agent.signal}`}
            data-testid={`agent-pill-${agent.name.toLowerCase()}`}
          >
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

  const signals: { label: string; present: boolean; description: string }[] = [
    { label: "Session utilization", present: data.sessionsThisWeek > 0, description: `${data.sessionsThisWeek} sessions analyzed` },
    { label: "Cancellation rate", present: data.cancellationsThisWeek > 0, description: `${data.cancellationsThisWeek} cancels this week` },
    { label: "30-day trend", present: data.sessions30Days > 0, description: `${data.sessions30Days} sessions last 30 days` },
    { label: "Client activity", present: data.recentClients?.length > 0, description: `${data.recentClients?.length ?? 0} clients reviewed` },
    { label: "Upcoming sessions", present: data.upcomingSessions?.length > 0, description: `${data.upcomingSessions?.length ?? 0} upcoming` },
  ];

  return (
    <div className="ml-11 mt-1.5 rounded-lg border bg-muted/30 text-xs overflow-hidden" data-testid="copilot-supporting-data">
      <div className="px-3 pt-2.5 pb-2 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Evidence — live data used to answer this
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
            <Eye className="h-2.5 w-2.5" />
            Scheduling signals detected
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
            <button
              onClick={() => setShowUpcoming(v => !v)}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
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
          <Brain className="h-2.5 w-2.5" />
          Answer generated from deterministic scheduling data · no fabrication
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
      {!isUser && message.supportingData && (
        <SupportingDataPanel data={message.supportingData} />
      )}
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
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
  }, []);

  const toggle = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (listening) { recognitionRef.current?.stop(); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as SpeechRecognitionResultList)
        .map((r: SpeechRecognitionResult) => r[0].transcript).join(" ").trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast({
          title: "Voice input error",
          description: event.error === "not-allowed"
            ? "Microphone access was denied."
            : `Speech recognition error: ${event.error}`,
          variant: "destructive",
        });
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, [listening, onTranscript, toast]);

  return { listening, supported, toggle };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSchedulingCopilotPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm your Scheduling Intelligence Copilot. I have access to your live scheduling data — sessions, coach utilization, client activity, fill rates, revenue gaps, and retention signals. The left panel shows your current scheduling intelligence. What would you like to optimize?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleVoiceTranscript = useCallback((text: string) => {
    setInput(prev => prev ? `${prev} ${text}` : text);
  }, []);

  const { listening, supported: voiceSupported, toggle: toggleVoice } = useVoiceInput(handleVoiceTranscript);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { data: healthData } = useQuery<HealthScore>({
    queryKey: ["/api/scheduling-intelligence/health-score"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/health-score"),
    staleTime: 120_000,
  });

  const { data: oppsData } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/opportunities").catch(() => ({ opportunities: [], counts: { total: 0, critical: 0, high: 0, byCategory: {} }, estimatedTotalValueCents: 0 })),
    staleTime: 60_000,
  });

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res = await apiRequest("POST", "/api/scheduling-intelligence/copilot", {
        question,
        conversationHistory: history,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? "I couldn't generate a response.",
          timestamp: new Date(),
          supportingData: data.supportingData,
        },
      ]);
    },
    onError: (err: any) => {
      const rawMsg = err?.message ?? "";
      let detail = "Could not reach the AI copilot.";
      try {
        const parsed = JSON.parse(rawMsg.replace(/^\d+:\s*/, ""));
        detail = parsed.error ?? parsed.message ?? detail;
      } catch { if (rawMsg) detail = rawMsg; }
      toast({ title: "Copilot Error", description: detail, variant: "destructive" });
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Sorry, I encountered an error: ${detail}`, timestamp: new Date() },
      ]);
    },
  });

  const handleSend = useCallback((text?: string) => {
    const question = (text ?? input).trim();
    if (!question) return;
    setMessages(prev => [...prev, { role: "user", content: question, timestamp: new Date() }]);
    setInput("");
    askMutation.mutate(question);
  }, [input, askMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stage = deriveWorkflowStage(healthData, oppsData);
  const StageIcon = stage.icon;

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
            Intelligent operational assistant — live signals, ranked recommendations, agent coordination
            <Badge className="text-[10px] flex items-center gap-1 h-4 px-1.5">
              <StageIcon className={`h-2.5 w-2.5 ${stage.color}`} />
              <span>{stage.stage}</span>
            </Badge>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/admin/scheduling-opportunity-inbox">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-opportunity-inbox">
              <Zap className="h-3.5 w-3.5" />
              Opportunity Inbox
            </Button>
          </Link>
          <Link href="/admin/scheduling-command-center">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-command-center">
              <BarChart3 className="h-3.5 w-3.5" />
              Command Center
            </Button>
          </Link>
        </div>
      </div>

      {/* Critical Alert Banner */}
      <CriticalAlertBanner opps={oppsData} onAsk={handleSend} />

      <div className="grid lg:grid-cols-3 gap-5">
        {/* ── Left Intelligence Panel ── */}
        <div className="space-y-3">
          <HealthScoreWidget onAsk={handleSend} />
          <RetentionRiskWidget onAsk={handleSend} />

          <Card className="overflow-hidden">
            <Tabs defaultValue="signals">
              <div className="border-b px-3 pt-3 pb-0">
                <TabsList className="h-7 gap-0.5 w-full">
                  <TabsTrigger value="signals" className="flex-1 text-[11px] h-6 gap-1 data-[state=active]:bg-background">
                    <AlertCircle className="h-3 w-3" />
                    Signals
                    {(oppsData?.counts?.total ?? 0) > 0 && (
                      <Badge className={`text-[9px] h-3.5 px-1 ml-0.5 ${(oppsData?.counts?.critical ?? 0) > 0 ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
                        {oppsData?.counts?.total}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="questions" className="flex-1 text-[11px] h-6 gap-1 data-[state=active]:bg-background">
                    <Lightbulb className="h-3 w-3" />
                    Ask
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="signals" className="p-3 mt-0">
                <LiveSignalsPanel onAsk={handleSend} />
              </TabsContent>
              <TabsContent value="questions" className="p-3 mt-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {(oppsData?.counts?.total ?? 0) > 0 ? "Context-aware questions" : "Suggested questions"}
                </p>
                <DynamicQuestions opps={oppsData} onAsk={handleSend} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* ── Chat Panel ── */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[680px] overflow-hidden">
            {/* Workflow stage bar */}
            <WorkflowStageBar health={healthData} opps={oppsData} />

            {/* Agent coordination strip */}
            <AgentCoordinationStrip opps={oppsData} />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
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
                        <span
                          key={i}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
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
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={listening ? "Listening… speak now" : "Ask about fill rates, revenue gaps, coach utilization, retention risks, or scheduling conflicts…"}
                  className={`resize-none min-h-[44px] max-h-[120px] text-sm transition-colors ${listening ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  rows={1}
                  disabled={askMutation.isPending}
                  data-testid="input-copilot-question"
                />
                {voiceSupported && (
                  <Button
                    size="icon"
                    type="button"
                    variant="outline"
                    className={`h-11 w-11 shrink-0 transition-colors ${listening ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 animate-pulse" : "hover:border-violet-400 hover:text-violet-600"}`}
                    onClick={toggleVoice}
                    disabled={askMutation.isPending}
                    title={listening ? "Stop recording" : "Start voice input"}
                    data-testid="button-voice-input"
                  >
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                )}
                <Button
                  size="icon"
                  className="h-11 w-11 shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || askMutation.isPending}
                  data-testid="button-send-copilot"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Enter to send · Shift+Enter for new line
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
