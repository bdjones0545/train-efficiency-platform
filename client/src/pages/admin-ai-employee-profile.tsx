/**
 * AI Employee Profile — Phase 7
 *
 * Deep-dive profile page for each AI agent.
 * Shows: role, capabilities, integrations, workflow participation,
 * execution stats, confidence trends, governance status, approval history.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, CheckCircle, Shield, Cpu, GitBranch, Globe,
  TrendingUp, Activity, Clock, BarChart2, Star, Zap,
  MessageSquare, Calendar, Search, Target, Brain, Users,
  ShieldCheck, AlertTriangle,
} from "lucide-react";

// ─── Agent catalogue (static definitions) ────────────────────────────────────

const AGENT_PROFILES = [
  {
    id: "relay",
    name: "Relay",
    initials: "RL",
    color: "bg-blue-500",
    lightColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-300 dark:border-blue-700",
    role: "Communication Specialist",
    department: "Communications",
    icon: MessageSquare,
    tagline: "No message goes unnoticed.",
    description: "Relay manages all inbound and outbound email communication for your organization. It classifies incoming replies, manages follow-up sequences, and ensures every conversation gets the right response at the right time.",
    whatItDoes: "Relay reads incoming emails, classifies their sentiment and intent, then decides whether to respond automatically (with approval) or escalate to your team. It tracks conversation threads across your entire client base and surfaces anything that needs your attention.",
    capabilities: [
      "Email reply classification (positive / negative / neutral / question)",
      "Automated follow-up sequence management",
      "Thread summarization and context building",
      "Escalation routing for negative responses",
      "Multi-lead outreach campaign support",
      "Conversation stage tracking",
    ],
    integrations: ["Gmail", "Slack", "OpenAI"],
    governanceZone: "supervised",
    typicalGovernance: "Every outbound email requires approval before sending.",
    trustSignals: [
      "Always pauses before sending — you review first",
      "Tracks confidence score per email",
      "Logs every classification decision",
    ],
  },
  {
    id: "pulse",
    name: "Pulse",
    initials: "PS",
    color: "bg-emerald-500",
    lightColor: "bg-emerald-50 dark:bg-emerald-900/20",
    borderColor: "border-emerald-300 dark:border-emerald-700",
    role: "Retention Specialist",
    department: "Retention",
    icon: TrendingUp,
    tagline: "Prevent churn before it happens.",
    description: "Pulse monitors engagement signals across your entire client base and proactively identifies at-risk clients before they cancel. It triggers retention workflows, personalized outreach, and win-back campaigns.",
    whatItDoes: "Pulse tracks session attendance, booking patterns, and communication frequency. When it detects a client drifting away — fewer bookings, missed sessions, reduced engagement — it automatically surfaces them for a retention workflow. It recommends the right message at the right time.",
    capabilities: [
      "Client engagement signal monitoring",
      "Churn risk scoring and prediction",
      "Retention workflow trigger management",
      "Win-back campaign personalization",
      "Session attendance pattern analysis",
      "Client value and revenue risk assessment",
    ],
    integrations: ["Gmail", "Google Calendar", "Stripe"],
    governanceZone: "collaborative",
    typicalGovernance: "Monitors autonomously. Outreach requires your approval.",
    trustSignals: [
      "Read-only monitoring — never acts without trigger",
      "Shows churn risk score before recommending action",
      "All outreach requires approval before sending",
    ],
  },
  {
    id: "tempo",
    name: "Tempo",
    initials: "TM",
    color: "bg-violet-500",
    lightColor: "bg-violet-50 dark:bg-violet-900/20",
    borderColor: "border-violet-300 dark:border-violet-700",
    role: "Scheduling Coordinator",
    department: "Scheduling",
    icon: Calendar,
    tagline: "Scheduling on autopilot.",
    description: "Tempo handles the full scheduling workflow — from booking requests to session reminders and cancellation management. Coaches focus on coaching; Tempo handles the calendar.",
    whatItDoes: "Tempo reads calendar availability, processes booking requests, sends session reminders, and handles cancellations or rescheduling. It coordinates with clients and coaches to minimize no-shows and maximize session utilization.",
    capabilities: [
      "Session booking and confirmation",
      "Automated reminder sequences (24h, 1h before)",
      "Cancellation and rescheduling management",
      "Calendar conflict detection",
      "Session utilization optimization",
      "Waitlist management",
    ],
    integrations: ["Google Calendar", "Gmail", "Slack"],
    governanceZone: "collaborative",
    typicalGovernance: "Creates bookings autonomously. External comms require approval.",
    trustSignals: [
      "Calendar writes are logged and reversible",
      "Client-facing messages require approval",
      "Never double-books without conflict check",
    ],
  },
  {
    id: "apex",
    name: "Apex",
    initials: "AX",
    color: "bg-amber-500",
    lightColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-300 dark:border-amber-700",
    role: "Growth & Outreach Agent",
    department: "Growth",
    icon: Target,
    tagline: "Find leads. Close deals.",
    description: "Apex researches and qualifies team training leads, manages multi-touch outreach campaigns, and tracks your deal pipeline from prospect to signed client.",
    whatItDoes: "Apex takes inbound leads from your capture forms, enriches them with web research, scores their qualification, and manages the outreach sequence. It tracks every touchpoint and surfaces the highest-priority prospects for your attention.",
    capabilities: [
      "Lead qualification and scoring",
      "Multi-step outreach campaign management",
      "Decision-maker contact discovery",
      "Deal pipeline stage tracking",
      "Follow-up timing optimization",
      "Prospect organization research",
    ],
    integrations: ["Gmail", "OpenAI", "Slack"],
    governanceZone: "supervised",
    typicalGovernance: "All outreach emails require approval before sending.",
    trustSignals: [
      "Shows research sources before acting",
      "Every email is reviewed before sending",
      "Rate limits prevent over-contacting prospects",
    ],
  },
  {
    id: "vector",
    name: "Vector",
    initials: "VC",
    color: "bg-pink-500",
    lightColor: "bg-pink-50 dark:bg-pink-900/20",
    borderColor: "border-pink-300 dark:border-pink-700",
    role: "Research Intelligence Agent",
    department: "Research",
    icon: Search,
    tagline: "Find the right person. Every time.",
    description: "Vector uses live web search to find decision-maker contacts for your prospects. It discovers real, source-backed email addresses and organizational context — no guessing.",
    whatItDoes: "Given a target organization, Vector searches the web in real-time to find the right contact: athletic director, head coach, or department head. It only saves contacts where it found real evidence — never inferred or guessed emails.",
    capabilities: [
      "Live web search for contact discovery",
      "Decision-maker identification (AD, HC, dept head)",
      "Source-backed email discovery with evidence",
      "Contact confidence scoring (0.00–1.00)",
      "Organization structure intelligence",
      "Stale contact freshness tracking",
    ],
    integrations: ["OpenAI (web_search_preview)", "OpenRouter"],
    governanceZone: "autonomous",
    typicalGovernance: "Research runs autonomously. Discovered contacts shown for review before any outreach.",
    trustSignals: [
      "Only saves contacts with real evidence (foundRealEmail=true)",
      "Shows source URL and snippet for every contact",
      "Never infers or guesses email addresses",
    ],
  },
  {
    id: "atlas",
    name: "Atlas",
    initials: "AT",
    color: "bg-slate-600",
    lightColor: "bg-slate-50 dark:bg-slate-900/20",
    borderColor: "border-slate-300 dark:border-slate-700",
    role: "Business Intelligence Agent",
    department: "Executive Intelligence",
    icon: BarChart2,
    tagline: "Your business, clearly understood.",
    description: "Atlas generates daily executive briefings, tracks KPIs, and surfaces strategic recommendations. It turns your operational data into clear business intelligence.",
    whatItDoes: "Every day (or on demand), Atlas analyzes your sessions, revenue, leads, client retention, and AI agent activity. It produces a concise executive summary with the most important signals, anomalies, and recommended actions for your day.",
    capabilities: [
      "Daily executive summary generation",
      "Revenue and retention KPI tracking",
      "Lead pipeline health monitoring",
      "AI agent performance reporting",
      "Anomaly detection and alerting",
      "Strategic recommendation surfacing",
    ],
    integrations: ["OpenAI", "Stripe", "Slack"],
    governanceZone: "autonomous",
    typicalGovernance: "Analysis runs autonomously. Reports posted to Slack or delivered via email.",
    trustSignals: [
      "Analysis only — never modifies data",
      "Reports clearly show data sources",
      "Recommendations are suggestions, not actions",
    ],
  },
];

const GOV_CONFIG: Record<string, { label: string; color: string; badge: string }> = {
  supervised:    { label: "Supervised", color: "text-green-600", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  collaborative: { label: "Collaborative", color: "text-blue-600", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  autonomous:    { label: "Autonomous", color: "text-violet-600", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminAiEmployeeProfilePage({ params }: { params?: { agentId?: string } }) {
  const [location] = useLocation();
  const agentId = params?.agentId ?? location.split("/").pop() ?? "";

  const profile = AGENT_PROFILES.find(a => a.id === agentId) ?? AGENT_PROFILES[0];

  // Stats from live API (best-effort)
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/workforce/agent-stats", agentId],
    queryFn: async () => {
      const r = await fetch(`/api/workforce/agent-stats/${agentId}`);
      if (!r.ok) return null;
      return r.json();
    },
  });

  // Workflow participation
  const { data: graphs } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });
  const participatingWorkflows = (graphs ?? []).filter(g =>
    (g.graphDefinition as any)?.nodes?.some((n: any) => n.data?.agentType === agentId || n.data?.agent === profile.name)
  );

  const govCfg = GOV_CONFIG[profile.governanceZone] ?? GOV_CONFIG.supervised;
  const Icon = profile.icon;

  return (
    <div className="space-y-6" data-testid={`page-agent-profile-${profile.id}`}>
      {/* Back */}
      <div className="flex items-center gap-2">
        <Link href="/admin/ai-workforce">
          <Button variant="ghost" size="sm" className="gap-1.5 h-8">
            <ArrowLeft className="h-4 w-4" />
            AI Workforce
          </Button>
        </Link>
      </div>

      {/* Hero */}
      <div className={`rounded-2xl border-2 ${profile.borderColor} ${profile.lightColor} p-6`}>
        <div className="flex items-start gap-5">
          <div className={`h-16 w-16 rounded-2xl ${profile.color} flex items-center justify-center shadow-lg shrink-0`}>
            <span className="text-xl font-bold text-white">{profile.initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold">{profile.name}</h1>
                  <Badge className={`${govCfg.badge} text-xs`}>
                    <Shield className="h-2.5 w-2.5 mr-1" />{govCfg.label}
                  </Badge>
                </div>
                <p className="text-sm font-medium text-muted-foreground mt-0.5">{profile.role}</p>
                <p className="text-xs text-muted-foreground">{profile.department} Department</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium text-green-600">Active</span>
              </div>
            </div>
            <p className="text-sm font-semibold italic mt-2 text-muted-foreground">"{profile.tagline}"</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">

          {/* What this agent does */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                What {profile.name} does for your organization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed">{profile.description}</p>
              <div className="p-3 rounded-lg bg-muted/40 border">
                <p className="text-xs font-medium mb-1.5">How it works:</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{profile.whatItDoes}</p>
              </div>
            </CardContent>
          </Card>

          {/* Capabilities */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Capabilities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {profile.capabilities.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-muted-foreground">{c}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Execution stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Execution Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Actions Today", value: stats.actionsToday ?? 0 },
                    { label: "Success Rate", value: `${stats.successRate ?? 0}%` },
                    { label: "Avg Confidence", value: `${stats.avgConfidence ?? 0}%` },
                    { label: "Approvals Needed", value: stats.approvalsNeeded ?? 0 },
                  ].map(s => (
                    <div key={s.label} className="text-center p-3 rounded-lg border">
                      <p className="text-xl font-bold">{s.value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {["Actions Today", "Success Rate", "Avg Confidence", "Approvals Needed"].map(l => (
                    <div key={l} className="text-center p-3 rounded-lg border">
                      <p className="text-xl font-bold">—</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{l}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Confidence bar */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Confidence trend</span>
                  <span className="font-medium">{stats?.avgConfidence ?? 0}%</span>
                </div>
                <Progress value={stats?.avgConfidence ?? 0} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          {/* Workflow participation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" />
                Workflow Participation
                {participatingWorkflows.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{participatingWorkflows.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {participatingWorkflows.length > 0 ? (
                <div className="space-y-2">
                  {participatingWorkflows.map(wf => (
                    <div key={wf.id} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-sm font-medium">{wf.name}</p>
                        {wf.published ? (
                          <Badge className="bg-green-100 text-green-700 text-[10px] h-4">Live</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] h-4">Draft</Badge>
                        )}
                      </div>
                      <Link href={`/admin/workflow-builder?graphId=${wf.id}`}>
                        <Button variant="ghost" size="sm" className="h-6 text-xs">View</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-4 rounded-lg border border-dashed text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  <p className="text-xs">Not yet participating in any published workflows.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Integrations */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Integrations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {profile.integrations.map(int => (
                <div key={int} className="flex items-center gap-2 p-2 rounded-lg border text-xs">
                  <div className="h-5 w-5 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                  </div>
                  {int}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Governance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Governance Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge className={`${govCfg.badge} text-xs w-full justify-center py-1`}>
                <Shield className="h-3 w-3 mr-1" />{govCfg.label} Mode
              </Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">{profile.typicalGovernance}</p>
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Trust Signals</p>
                {profile.trustSignals.map((t, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <ShieldCheck className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{t}</span>
                  </div>
                ))}
              </div>
              <Link href="/admin/ai-governance">
                <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Configure Governance
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Quick nav */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Other Agents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {AGENT_PROFILES.filter(a => a.id !== profile.id).map(a => (
                <Link key={a.id} href={`/admin/ai-employee/${a.id}`}>
                  <button className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/40 transition-colors text-left">
                    <div className={`h-6 w-6 rounded-lg ${a.color} flex items-center justify-center shrink-0`}>
                      <span className="text-[10px] font-bold text-white">{a.initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{a.role}</p>
                    </div>
                  </button>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
