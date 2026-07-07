import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import {
  TrendingUp, DollarSign, Clock, Users, CheckCircle2,
  AlertCircle, Zap, BarChart3, RefreshCw, Send,
  Lightbulb, Target, Star, Calendar, User, ChevronRight,
  Award, Activity, Settings, Play, Brain, ArrowRight,
  Loader2, RotateCcw, FileText
} from "lucide-react";
import { useState } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  org_id: string;
  booking_id: string;
  session_name: string;
  coach_name: string;
  session_start: string;
  open_spots: number;
  total_spots: number;
  session_price_cents: number;
  utilization_pct: number;
  revenue_impact: string;
  urgency: string;
  fill_probability: number;
  overall_priority: number;
  detection_triggers: string[];
  recommendations: Array<{ strategy: string; description: string; priority: string }>;
  auto_draft_id: string | null;
  auto_draft_status: string;
  status: string;
  detected_at: string;
  last_scanned_at: string;
  has_submission: boolean;
}

interface OpportunitiesData {
  opportunities: Opportunity[];
  totalCount: number;
  scannedAt: string;
}

interface ExecutiveBriefData {
  brief: string;
  stats: {
    opportunitiesToday: number;
    potentialRevenueCents: number;
    campaignsAwaitingApproval: number;
    revenueRecoveredThisMonthCents: number;
    avgFillRatePct: number;
    coachUtilizationPct: number;
  };
}

interface LearningData {
  bestDayOfWeek: { day: string; avgFillRate: number } | null;
  bestHourOfDay: { hour: string; avgFillRate: number } | null;
  bestAudienceSize: { range: string; avgFillRate: number } | null;
  coachPerformance: Array<{ coachName: string; campaigns: number; avgFillRate: number; totalRevenueCents: number }>;
  bestSubjectLines: Array<{ subject: string; avgFillRate: number; campaigns: number }>;
  campaignTypeBreakdown: Array<{ type: string; count: number; avgFillRate: number }>;
  totalInsights: number;
}

interface Policy {
  min_fill_threshold_pct: number;
  min_revenue_cents: number;
  campaign_lead_time_hours: number;
  auto_draft_generation: boolean;
  approval_required: boolean;
  waitlist_priority: boolean;
  enabled: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<string, { color: string; bg: string }> = {
  Critical: { color: "text-red-700 dark:text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
  High:     { color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  Medium:   { color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
  Low:      { color: "text-green-700 dark:text-green-400",   bg: "bg-green-500/10 border-green-500/20" },
};

const REVENUE_CONFIG: Record<string, { color: string }> = {
  High:   { color: "text-green-600 dark:text-green-400" },
  Medium: { color: "text-yellow-600 dark:text-yellow-400" },
  Low:    { color: "text-muted-foreground" },
};

const STRATEGY_ICONS: Record<string, typeof Send> = {
  "Fill Campaign":             Send,
  "Waitlist Promotion":        Users,
  "Offer Discount":            DollarSign,
  "Merge Sessions":            Activity,
  "Move Athletes":             ArrowRight,
  "Manual Outreach":           User,
  "Coach Schedule Adjustment": Calendar,
};

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cfg = URGENCY_CONFIG[urgency] ?? URGENCY_CONFIG.Low;
  return (
    <Badge className={`text-[10px] ${cfg.bg} ${cfg.color} border`}>{urgency}</Badge>
  );
}

function PriorityBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-red-500" : score >= 50 ? "bg-yellow-500" : "bg-blue-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold w-7 text-right">{score}</span>
    </div>
  );
}

function DraftStatusChip({ status }: { status: string }) {
  const MAP: Record<string, { label: string; color: string }> = {
    ready:          { label: "Draft Ready",     color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20" },
    generating:     { label: "Generating…",     color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20" },
    not_generated:  { label: "No Draft",        color: "bg-muted text-muted-foreground border-transparent" },
    submitted:      { label: "Submitted",       color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20" },
    error:          { label: "Draft Error",     color: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20" },
    no_recipients:  { label: "No Recipients",   color: "bg-muted text-muted-foreground border-transparent" },
  };
  const cfg = MAP[status] ?? MAP.not_generated;
  return <Badge className={`text-[10px] ${cfg.color} border`}>{cfg.label}</Badge>;
}

// ── Opportunity Card ──────────────────────────────────────────────────────────

function OpportunityCard({
  opp,
  onGenerateDraft,
  isGenerating,
}: {
  opp: Opportunity;
  onGenerateDraft: (id: string) => void;
  isGenerating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const estimatedRevenue = Math.round((opp.open_spots * opp.session_price_cents) / 100);
  const sessionStart = opp.session_start ? parseISO(opp.session_start) : null;
  const revCfg = REVENUE_CONFIG[opp.revenue_impact] ?? REVENUE_CONFIG.Low;

  const primaryRecs = opp.recommendations.filter((r) => r.priority === "primary");
  const secondaryRecs = opp.recommendations.filter((r) => r.priority !== "primary");

  return (
    <Card className="p-4" data-testid={`card-opportunity-${opp.id}`}>
      {/* Header row */}
      <div className="flex items-start gap-3 flex-wrap">
        {/* Priority score */}
        <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex-none">
          <span className="text-lg font-bold text-primary leading-none">{opp.overall_priority}</span>
          <span className="text-[9px] text-muted-foreground">priority</span>
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{opp.session_name}</p>
            <UrgencyBadge urgency={opp.urgency} />
            <DraftStatusChip status={opp.auto_draft_status} />
            {opp.has_submission && (
              <Badge className="text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20 border">Campaign Submitted</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{opp.coach_name}</span>
            {sessionStart && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDistanceToNow(sessionStart, { addSuffix: true })}</span>
            )}
            <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" />{opp.utilization_pct}% filled ({opp.open_spots} open)</span>
            <span className={`flex items-center gap-1 font-medium ${revCfg.color}`}>
              <DollarSign className="h-3 w-3" />${estimatedRevenue.toLocaleString()} potential
            </span>
          </div>
        </div>

        {/* Scores */}
        <div className="flex items-center gap-4 flex-none text-center">
          <div>
            <p className={`text-sm font-bold ${revCfg.color}`}>{opp.revenue_impact}</p>
            <p className="text-[10px] text-muted-foreground">Revenue Impact</p>
          </div>
          <div>
            <p className="text-sm font-bold">{opp.fill_probability}%</p>
            <p className="text-[10px] text-muted-foreground">Fill Probability</p>
          </div>
        </div>
      </div>

      {/* Priority bar */}
      <div className="mt-3">
        <PriorityBar score={opp.overall_priority} />
      </div>

      {/* Detection triggers */}
      {opp.detection_triggers && opp.detection_triggers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opp.detection_triggers.map((t, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">{t}</span>
          ))}
        </div>
      )}

      {/* Recommendations (primary always visible) */}
      {primaryRecs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {primaryRecs.map((rec, i) => {
            const Icon = STRATEGY_ICONS[rec.strategy] ?? Send;
            return (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10 text-xs">
                <Icon className="h-3.5 w-3.5 text-primary flex-none mt-0.5" />
                <div>
                  <span className="font-semibold">{rec.strategy}:</span>{" "}
                  <span className="text-muted-foreground">{rec.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded: secondary recommendations */}
      {expanded && secondaryRecs.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {secondaryRecs.map((rec, i) => {
            const Icon = STRATEGY_ICONS[rec.strategy] ?? Activity;
            return (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/40 text-xs">
                <Icon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
                <div>
                  <span className="font-medium text-muted-foreground">{rec.strategy}:</span>{" "}
                  <span className="text-muted-foreground">{rec.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {secondaryRecs.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            {expanded ? "Less" : `+${secondaryRecs.length} more strategies`}
            <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}

        <div className="flex-1" />

        {opp.auto_draft_status === "ready" && opp.auto_draft_id ? (
          <Link href={`/admin/scheduling-opportunity-inbox?bookingId=${opp.booking_id}`}>
            <a>
              <Button size="sm" className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700" data-testid={`button-view-draft-${opp.id}`}>
                <CheckCircle2 className="h-3 w-3" />
                Review Draft
              </Button>
            </a>
          </Link>
        ) : opp.auto_draft_status === "not_generated" || opp.auto_draft_status === "error" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => onGenerateDraft(opp.id)}
            disabled={isGenerating}
            data-testid={`button-generate-draft-${opp.id}`}
          >
            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            Generate Draft
          </Button>
        ) : opp.auto_draft_status === "generating" ? (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled>
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating…
          </Button>
        ) : null}

        {!opp.has_submission && (
          <Link href={`/admin/scheduling-opportunity-inbox`}>
            <a>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" data-testid={`button-create-campaign-${opp.id}`}>
                <Send className="h-3 w-3" />
                Create Campaign
              </Button>
            </a>
          </Link>
        )}

        {opp.has_submission && (
          <Link href="/admin/fill-campaigns">
            <a>
              <Button size="sm" variant="ghost" className="h-7 text-xs">View Campaign</Button>
            </a>
          </Link>
        )}
      </div>
    </Card>
  );
}

// ── Policy Panel ──────────────────────────────────────────────────────────────

function PolicyPanel({ policy, onSave, isSaving }: { policy: Policy; onSave: (p: Policy) => void; isSaving: boolean }) {
  const [form, setForm] = useState<Policy>(policy);
  const set = (key: keyof Policy, value: any) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs mb-1.5 block">Minimum Fill Threshold (%)</Label>
          <p className="text-[10px] text-muted-foreground mb-1">Generate opportunity when session is below this % full</p>
          <Input
            type="number"
            min={0} max={100}
            value={form.min_fill_threshold_pct}
            onChange={(e) => set("min_fill_threshold_pct", parseInt(e.target.value) || 0)}
            className="h-8 text-sm"
            data-testid="input-min-fill-threshold"
          />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Minimum Revenue Opportunity ($)</Label>
          <p className="text-[10px] text-muted-foreground mb-1">Ignore opportunities worth less than this amount</p>
          <Input
            type="number"
            min={0}
            value={Math.round(form.min_revenue_cents / 100)}
            onChange={(e) => set("min_revenue_cents", (parseInt(e.target.value) || 0) * 100)}
            className="h-8 text-sm"
            data-testid="input-min-revenue"
          />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Campaign Lead Time (hours)</Label>
          <p className="text-[10px] text-muted-foreground mb-1">How far ahead to scan for opportunities</p>
          <Input
            type="number"
            min={1} max={336}
            value={form.campaign_lead_time_hours}
            onChange={(e) => set("campaign_lead_time_hours", parseInt(e.target.value) || 72)}
            className="h-8 text-sm"
            data-testid="input-lead-time"
          />
        </div>
      </div>

      <div className="space-y-3">
        {[
          { key: "auto_draft_generation" as const, label: "Automatic Draft Generation", desc: "Pre-generate campaign drafts when opportunities are detected. Drafts still require human approval before sending." },
          { key: "approval_required" as const, label: "Approval Required", desc: "Campaigns always require manual approval before sending. This setting cannot be disabled.", locked: true },
          { key: "waitlist_priority" as const, label: "Waitlist Priority", desc: "Rank waitlisted athletes higher in recipient scoring." },
          { key: "enabled" as const, label: "Monitoring Enabled", desc: "Enable continuous opportunity monitoring for this organization." },
        ].map((item) => (
          <div key={item.key} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
            <Switch
              checked={form[item.key] as boolean}
              onCheckedChange={(v) => !item.locked && set(item.key, v)}
              disabled={item.locked}
              data-testid={`switch-${item.key}`}
            />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                {item.label}
                {item.locked && <Badge className="text-[9px] bg-muted text-muted-foreground">Locked</Badge>}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={() => onSave(form)}
        disabled={isSaving}
        className="gap-2"
        data-testid="button-save-policy"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Save Policy
      </Button>
    </div>
  );
}

// ── Learning Insights Panel ───────────────────────────────────────────────────

function LearningPanel({ data }: { data: LearningData }) {
  return (
    <div className="space-y-5">
      {/* Best timing cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Best Day", value: data.bestDayOfWeek?.day ?? "—", sub: data.bestDayOfWeek ? `${data.bestDayOfWeek.avgFillRate}% avg fill rate` : "Insufficient data", icon: Calendar },
          { label: "Best Hour", value: data.bestHourOfDay?.hour ?? "—", sub: data.bestHourOfDay ? `${data.bestHourOfDay.avgFillRate}% avg fill rate` : "Insufficient data", icon: Clock },
          { label: "Best Audience Size", value: data.bestAudienceSize?.range ?? "—", sub: data.bestAudienceSize ? `${data.bestAudienceSize.avgFillRate}% avg fill rate` : "Insufficient data", icon: Users },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <s.icon className="h-4 w-4" />
              <span className="text-xs">{s.label}</span>
            </div>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
          </Card>
        ))}
      </div>

      {/* Coach performance */}
      {data.coachPerformance.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Coach Performance</p>
          <div className="space-y-1">
            {data.coachPerformance.map((coach, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/20 text-xs">
                <Award className="h-3.5 w-3.5 text-primary flex-none" />
                <span className="font-medium flex-1">{coach.coachName}</span>
                <span>{coach.campaigns} campaigns</span>
                <span className={`font-bold ${coach.avgFillRate >= 70 ? "text-green-600 dark:text-green-400" : coach.avgFillRate >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                  {coach.avgFillRate}% fill rate
                </span>
                <span className="text-green-600 dark:text-green-400 font-medium">
                  ${Math.round(coach.totalRevenueCents / 100).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Best subject lines */}
      {data.bestSubjectLines.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Top Subject Lines</p>
          <div className="space-y-1.5">
            {data.bestSubjectLines.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/20 text-xs">
                <span className="text-muted-foreground w-5 flex-none">#{i + 1}</span>
                <span className="flex-1 truncate">{s.subject}</span>
                <span className="text-muted-foreground">{s.campaigns} campaign{s.campaigns !== 1 ? "s" : ""}</span>
                <span className={`font-bold ${s.avgFillRate >= 70 ? "text-green-600 dark:text-green-400" : s.avgFillRate >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                  {s.avgFillRate}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.totalInsights === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Complete campaigns and attribute bookings to build learning data.
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "opportunities", label: "Revenue Opportunities", icon: Target },
  { key: "brief", label: "Executive Brief", icon: Brain },
  { key: "learning", label: "Learning Insights", icon: Lightbulb },
  { key: "policy", label: "Policy", icon: Settings },
];

export default function AdminFillRevenueOpsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("opportunities");
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const { data: oppsData, isLoading: oppsLoading, refetch: refetchOpps } = useQuery<OpportunitiesData>({
    queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/opportunities"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-revenue-ops/opportunities"),
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: briefData, isLoading: briefLoading } = useQuery<ExecutiveBriefData>({
    queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/executive-brief"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-revenue-ops/executive-brief"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: learningData, isLoading: learningLoading } = useQuery<LearningData>({
    queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/learning"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-revenue-ops/learning"),
    staleTime: 10 * 60 * 1000,
  });

  const { data: policyData, isLoading: policyLoading } = useQuery<{ policy: Policy }>({
    queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/policy"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-revenue-ops/policy"),
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scheduling-intelligence/fill-revenue-ops/scan", {}),
    onSuccess: async (res) => {
      const d = await res.json();
      toast({ title: "Scan complete", description: `${d.detected ?? 0} opportunities detected.` });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/opportunities"] });
    },
    onError: () => toast({ title: "Scan failed", variant: "destructive" }),
  });

  const generateDraftMutation = useMutation({
    mutationFn: async (opportunityId: string) => {
      setGeneratingId(opportunityId);
      return apiRequest("POST", `/api/scheduling-intelligence/fill-revenue-ops/generate-draft/${opportunityId}`, {});
    },
    onSuccess: () => {
      toast({ title: "Draft generated", description: "Campaign draft is ready for review." });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/opportunities"] });
      setGeneratingId(null);
    },
    onError: () => { toast({ title: "Draft generation failed", variant: "destructive" }); setGeneratingId(null); },
  });

  const savePolicyMutation = useMutation({
    mutationFn: (policy: Policy) => apiRequest("PUT", "/api/scheduling-intelligence/fill-revenue-ops/policy", policy),
    onSuccess: () => {
      toast({ title: "Policy saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-revenue-ops/policy"] });
    },
    onError: () => toast({ title: "Failed to save policy", variant: "destructive" }),
  });

  const opportunities = oppsData?.opportunities ?? [];
  const stats = briefData?.stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Revenue Operations
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Autonomous opportunity detection · Pre-generated drafts · Human approval required
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="gap-2"
            data-testid="button-run-scan"
          >
            {scanMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Run Scan
          </Button>
          <Link href="/admin/fill-campaigns">
            <a>
              <Button variant="outline" size="sm" className="gap-2">
                <Send className="h-3.5 w-3.5" />
                Campaign Queue
              </Button>
            </a>
          </Link>
          <Link href="/admin/fill-campaign-analytics">
            <a>
              <Button variant="outline" size="sm" className="gap-2">
                <BarChart3 className="h-3.5 w-3.5" />
                Analytics
              </Button>
            </a>
          </Link>
        </div>
      </div>

      {/* KPI row */}
      {briefLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Opportunities Today", value: stats.opportunitiesToday, icon: Target, color: "text-primary" },
            { label: "Potential Recovery", value: stats.potentialRevenueCents ? `$${Math.round(stats.potentialRevenueCents / 100).toLocaleString()}` : "$0", icon: DollarSign, color: "text-green-600 dark:text-green-400" },
            { label: "Awaiting Approval", value: stats.campaignsAwaitingApproval, icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
            { label: "Recovered This Month", value: stats.revenueRecoveredThisMonthCents ? `$${Math.round(stats.revenueRecoveredThisMonthCents / 100).toLocaleString()}` : "$0", icon: TrendingUp, color: "text-green-600 dark:text-green-400" },
            { label: "Avg Fill Rate", value: stats.avgFillRatePct ? `${stats.avgFillRatePct}%` : "—", icon: BarChart3, color: "text-blue-600 dark:text-blue-400" },
            { label: "Coach Utilization", value: stats.coachUtilizationPct ? `${stats.coachUtilizationPct}%` : "—", icon: Users, color: "text-muted-foreground" },
          ].map((s) => (
            <Card key={s.label} className="p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <s.icon className="h-3.5 w-3.5" />
                <span className="text-[10px]">{s.label}</span>
              </div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
            }`}
            data-testid={`tab-${tab.key}`}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
            {tab.key === "opportunities" && opportunities.length > 0 && (
              <span className="ml-1 bg-primary/20 text-primary rounded-full px-1.5 text-[9px] font-bold">
                {opportunities.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "opportunities" && (
        <div className="space-y-3">
          {oppsLoading ? (
            <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
          ) : opportunities.length === 0 ? (
            <Card className="p-12 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-500 mb-3" />
              <p className="font-medium">No revenue opportunities detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                All sessions within your monitoring window are above the fill threshold.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
              >
                {scanMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Run Scan Now
              </Button>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{opportunities.length} active opportunities · sorted by priority</span>
                {oppsData?.scannedAt && (
                  <span>Last scanned {formatDistanceToNow(parseISO(oppsData.scannedAt), { addSuffix: true })}</span>
                )}
              </div>
              {opportunities.map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opp={opp}
                  onGenerateDraft={(id) => generateDraftMutation.mutate(id)}
                  isGenerating={generatingId === opp.id && generateDraftMutation.isPending}
                />
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === "brief" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-5 w-5 text-primary" />
              <p className="font-semibold">Executive Summary</p>
              <span className="text-[10px] text-muted-foreground ml-1">Generated from live data — no invented statistics</span>
            </div>
            {briefLoading ? (
              <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-5" />)}</div>
            ) : briefData?.brief ? (
              <p className="text-sm leading-relaxed">{briefData.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No summary available yet. Complete campaigns to generate the executive brief.</p>
            )}
          </Card>

          {/* Quick action links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Revenue Opportunities", href: "#", desc: `${stats?.opportunitiesToday ?? 0} detected`, icon: Target, onClick: () => setActiveTab("opportunities") },
              { label: "Awaiting Approval", href: "/admin/fill-campaigns", desc: `${stats?.campaignsAwaitingApproval ?? 0} campaigns`, icon: Clock },
              { label: "Full Analytics", href: "/admin/fill-campaign-analytics", desc: "Historical reporting", icon: BarChart3 },
            ].map((item) => (
              <Card key={item.label} className="p-3 hover:shadow-md transition-shadow cursor-pointer">
                {item.onClick ? (
                  <button onClick={item.onClick} className="w-full text-left">
                    <div className="flex items-center gap-2 mb-1">
                      <item.icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </button>
                ) : (
                  <Link href={item.href}>
                    <a className="block">
                      <div className="flex items-center gap-2 mb-1">
                        <item.icon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </a>
                  </Link>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === "learning" && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            <p className="font-semibold">Organizational Learning</p>
            <span className="text-[10px] text-muted-foreground ml-1">Deterministic analytics only — no estimated metrics</span>
          </div>
          {learningLoading ? (
            <div className="space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : learningData ? (
            <LearningPanel data={learningData} />
          ) : null}
        </Card>
      )}

      {activeTab === "policy" && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="h-5 w-5 text-primary" />
            <p className="font-semibold">Organization Policy</p>
            <span className="text-[10px] text-muted-foreground ml-1">Controls monitoring behavior · Approval always required</span>
          </div>
          {policyLoading ? (
            <div className="space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : policyData?.policy ? (
            <PolicyPanel
              policy={policyData.policy}
              onSave={(p) => savePolicyMutation.mutate(p)}
              isSaving={savePolicyMutation.isPending}
            />
          ) : null}
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Monitoring runs every 30 minutes · Human approval mandatory on all send paths
      </p>
    </div>
  );
}
