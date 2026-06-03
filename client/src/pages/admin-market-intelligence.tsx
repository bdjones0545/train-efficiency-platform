import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Globe, TrendingUp, Users, Shield, Star, Zap, ChevronRight, Network,
  Building2, MapPin, Heart, AlertTriangle, CheckCircle, ArrowUp, Minus,
  Search, Handshake, Lightbulb, BarChart3, Trophy, Target, Briefcase,
  Activity, RefreshCw, ArrowDown, Eye, Award,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketOverview = {
  marketHealthScore: number; marketHealthLevel: string; summary: string;
  quickStats: { label: string; value: string; trend: string; detail: string }[];
  topOpportunities: { title: string; value: string; confidence: number; window: string }[];
  topThreats: { title: string; severity: string; description: string }[];
  generatedAt: string;
};
type CompetitorData = {
  competitors: { id: string; name: string; distance: string; type: string; alerts: { type: string; title: string; impact: string; date: string }[]; strengthScore: number; ourAdvantage: string }[];
  alertSummary: { high: number; moderate: number; low: number };
  generatedAt: string;
};
type OpportunityData = {
  opportunities: { id: string; type: string; name: string; opportunity: string; estimatedValue: number; likelihood: number; category: string; status: string; actionable: boolean; note: string }[];
  totalPipelineValue: number;
  generatedAt: string;
};
type SentimentData = {
  overall: { positive: number; neutral: number; negative: number };
  npsScore: number; topPraise: string[]; topComplaints: string[]; retentionRisks: number;
  sources: { source: string; count: number; avgRating: number }[];
  trend: string; generatedAt: string;
};
type ReputationData = {
  reputationScore: number; reputationLevel: string;
  sources: { platform: string; rating: number; reviewCount: number; trend: string; lastReview: string }[];
  alerts: { type: string; message: string; severity: string }[];
  recentMentions: { platform: string; snippet: string; sentiment: string; date: string }[];
  generatedAt: string;
};
type HiringData = {
  currentTeamSize: number; hiringRecommendation: string; bestHiringWindow: string; candidatePipeline: number;
  marketInsights: { insight: string; urgency: string }[];
  competitorHiring: { competitor: string; openRoles: number; implication: string }[];
  generatedAt: string;
};
type TrendsData = {
  trends: { id: string; category: string; title: string; momentum: number; direction: string; phase: string; relevance: string; description: string; actionableInsight: string }[];
  lastUpdated: string;
};
type PartnershipsData = {
  partnerships: { id: string; type: string; name: string; strategicFit: number; estimatedValue: number; likelihood: number; contactStatus: string; note: string }[];
  totalPartnershipValue: number;
  generatedAt: string;
};
type GrowthData = {
  opportunities: { id: string; title: string; category: string; expectedRevenue: number; timeframe: string; confidence: number; rationale: string; firstStep: string; effort: string }[];
  focus: string; generatedAt: string;
};
type AdvantageData = {
  strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[];
  competitiveAdvantages: { advantage: string; score: number; sustainability: string }[];
  strategicRecommendations: string[];
  overallPosition: string; generatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ProgressBar({ value, color = "bg-primary", height = "h-2" }: { value: number; color?: string; height?: string }) {
  return (
    <div className={`w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return <span className={`font-bold text-sm ${color}`}>{score}</span>;
}

const IMPACT_CFG: Record<string, { color: string; bg: string; border: string }> = {
  high:     { color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/20",     border: "border-rose-200 dark:border-rose-800" },
  moderate: { color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-800" },
  low:      { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800" },
  info:     { color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20",     border: "border-blue-200 dark:border-blue-800" },
};

const TYPE_ICONS: Record<string, any> = {
  school: Building2, sports_org: Users, business: Briefcase, rec_dept: MapPin,
  event: Star, team: Users, gym: Zap, health: Heart, city: MapPin,
};

function TrendIcon({ direction }: { direction: string }) {
  if (direction === "up")   return <ArrowUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (direction === "down") return <ArrowDown className="h-3.5 w-3.5 text-rose-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview",      icon: Globe },
  { id: "competitors", label: "Competitors",   icon: Eye },
  { id: "opportunities",label: "Opportunities",icon: Target },
  { id: "sentiment",   label: "Sentiment",     icon: Heart },
  { id: "reputation",  label: "Reputation",    icon: Star },
  { id: "hiring",      label: "Hiring Intel",  icon: Users },
  { id: "trends",      label: "Trend Radar",   icon: TrendingUp },
  { id: "partnerships",label: "Partnerships",  icon: Handshake },
  { id: "growth",      label: "Growth Engine", icon: Lightbulb },
  { id: "advantage",   label: "Advantage",     icon: Trophy },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<MarketOverview>({
    queryKey: ["/api/market/overview"],
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>;

  const score = data?.marketHealthScore ?? 0;
  const scoreColor = score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

  return (
    <div className="space-y-4" data-testid="tab-overview">
      {/* Hero */}
      <div className="flex items-start gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5">
        <div className="shrink-0 text-center p-3 rounded-xl bg-card border">
          <p className={`text-4xl font-extrabold ${scoreColor}`}>{score}</p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">Market Health</p>
          <p className={`text-xs font-semibold mt-0.5 ${scoreColor}`}>{data?.marketHealthLevel}</p>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold mb-1">External Market Summary</h2>
          <p className="text-xs text-muted-foreground mb-3">{data?.summary}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(data?.quickStats ?? []).map(s => (
              <div key={s.label} className="p-2.5 rounded-lg bg-background border" data-testid={`market-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <TrendIcon direction={s.trend} />
                  <p className="text-xs font-bold">{s.value}</p>
                </div>
                <p className="text-[9px] text-muted-foreground leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-overview">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Opportunities + Threats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold">Top Opportunities</h3>
          </div>
          <div className="space-y-2.5">
            {(data?.topOpportunities ?? []).map((op, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-200 dark:border-emerald-900" data-testid={`opportunity-top-${i}`}>
                <div className="flex-1">
                  <p className="text-xs font-semibold">{op.title}</p>
                  <p className="text-[10px] text-muted-foreground">{op.window}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{op.value}</p>
                  <p className="text-[9px] text-muted-foreground">{op.confidence}% confidence</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Active Threats</h3>
          </div>
          <div className="space-y-2.5">
            {(data?.topThreats ?? []).map((t, i) => {
              const cfg = IMPACT_CFG[t.severity] ?? IMPACT_CFG.low;
              return (
                <div key={i} className={`p-2.5 rounded-lg border ${cfg.border} ${cfg.bg}`} data-testid={`threat-${i}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 capitalize ${cfg.color}`}>{t.severity}</Badge>
                    <p className="text-xs font-semibold">{t.title}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Competitors ─────────────────────────────────────────────────────────

function CompetitorsTab() {
  const { data, isLoading } = useQuery<CompetitorData>({ queryKey: ["/api/market/competitors"], staleTime: 10 * 60_000 });
  const ALERT_TYPE_ICONS: Record<string, any> = { new_program: Zap, pricing: BarChart3, hiring: Users, marketing: Activity };

  return (
    <div className="space-y-4" data-testid="tab-competitors">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "High Impact",     value: data.alertSummary.high,     color: "text-rose-600 dark:text-rose-400" },
            { label: "Moderate Impact", value: data.alertSummary.moderate, color: "text-amber-600 dark:text-amber-400" },
            { label: "Low Impact",      value: data.alertSummary.low,      color: "text-emerald-600 dark:text-emerald-400" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.label} Alerts</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.competitors ?? []).map(c => (
            <div key={c.id} className="p-4 rounded-xl border bg-card" data-testid={`competitor-${c.id}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-bold">{c.name}</p>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{c.type}</Badge>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{c.distance}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground"><span className="font-medium text-emerald-600 dark:text-emerald-400">Our advantage:</span> {c.ourAdvantage}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] text-muted-foreground">Strength</p>
                  <ScoreBadge score={c.strengthScore} />
                  <p className="text-[9px] text-muted-foreground">/100</p>
                </div>
              </div>
              <div className="space-y-2">
                {c.alerts.map((alert, ai) => {
                  const AlertIcon = ALERT_TYPE_ICONS[alert.type] ?? AlertTriangle;
                  const cfg = IMPACT_CFG[alert.impact] ?? IMPACT_CFG.low;
                  return (
                    <div key={ai} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${cfg.border} ${cfg.bg}`}>
                      <AlertIcon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cfg.color}`} />
                      <div className="flex-1">
                        <p className="text-xs font-medium">{alert.title}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(alert.date), "MMM d, yyyy")}</p>
                      </div>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 shrink-0 capitalize ${cfg.color}`}>{alert.impact}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Opportunities ───────────────────────────────────────────────────────

function OpportunitiesTab() {
  const { data, isLoading } = useQuery<OpportunityData>({ queryKey: ["/api/market/opportunities"], staleTime: 10 * 60_000 });
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? (data?.opportunities ?? []) : (data?.opportunities ?? []).filter(o => o.category === filter);

  return (
    <div className="space-y-4" data-testid="tab-opportunities">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {["all", "contract", "partnership", "sponsorship"].map(f => (
            <button key={f} onClick={() => setFilter(f)} data-testid={`filter-opp-${f}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="text-right">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Total Pipeline</p>
          <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">${(data?.totalPipelineValue ?? 0).toLocaleString()}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(op => {
            const Icon = TYPE_ICONS[op.type] ?? Building2;
            return (
              <div key={op.id} className="p-4 rounded-xl border bg-card" data-testid={`opp-${op.id}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold">{op.name}</p>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{op.category}</Badge>
                      {op.actionable && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Actionable Now</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-1.5">{op.opportunity}</p>
                    <p className="text-[10px] italic text-muted-foreground">{op.note}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] text-muted-foreground">Likelihood</span>
                          <span className="text-[9px] font-semibold">{op.likelihood}%</span>
                        </div>
                        <ProgressBar value={op.likelihood} color={op.likelihood >= 70 ? "bg-emerald-500" : op.likelihood >= 50 ? "bg-amber-500" : "bg-rose-500"} />
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[9px] text-muted-foreground">Est. Value</p>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${op.estimatedValue.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Sentiment ────────────────────────────────────────────────────────────

function SentimentTab() {
  const { data, isLoading } = useQuery<SentimentData>({ queryKey: ["/api/market/sentiment"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-sentiment">
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <>
          {/* NPS + sentiment bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Customer Sentiment</h3>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {data?.trend === "positive" ? "↑ Improving" : data?.trend === "negative" ? "↓ Declining" : "→ Stable"}
                </Badge>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "Positive", value: data?.overall.positive ?? 0, color: "bg-emerald-500" },
                  { label: "Neutral",  value: data?.overall.neutral ?? 0,  color: "bg-amber-400" },
                  { label: "Negative", value: data?.overall.negative ?? 0, color: "bg-rose-500" },
                ].map(s => (
                  <div key={s.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-semibold">{s.value}%</span>
                    </div>
                    <ProgressBar value={s.value} color={s.color} />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-card flex flex-col items-center justify-center text-center gap-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Net Promoter Score</p>
              <p className={`text-5xl font-extrabold ${(data?.npsScore ?? 0) >= 50 ? "text-emerald-600 dark:text-emerald-400" : (data?.npsScore ?? 0) >= 30 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{data?.npsScore ?? 0}</p>
              <p className="text-xs text-muted-foreground">{(data?.npsScore ?? 0) >= 50 ? "Excellent — top quartile" : (data?.npsScore ?? 0) >= 30 ? "Good — above average" : "Below average — focus on retention"}</p>
              {(data?.retentionRisks ?? 0) > 0 && <Badge variant="outline" className="text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 text-[10px]">{data?.retentionRisks} retention risks</Badge>}
            </div>
          </div>

          {/* Praise + Complaints */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">Top Praise Themes</h3>
              </div>
              <div className="space-y-1.5">
                {(data?.topPraise ?? []).map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Top Complaints</h3>
              </div>
              <div className="space-y-1.5">
                {(data?.topComplaints ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Reputation ──────────────────────────────────────────────────────────

function ReputationTab() {
  const { data, isLoading } = useQuery<ReputationData>({ queryKey: ["/api/market/reputation"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-reputation">
      {data && (
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-amber-500/5 to-yellow-500/5">
          <div className="text-center shrink-0">
            <p className={`text-4xl font-extrabold ${data.reputationScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : data.reputationScore >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{data.reputationScore}</p>
            <p className="text-[9px] text-muted-foreground">Reputation Score</p>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{data.reputationLevel}</p>
          </div>
          <div className="flex-1 space-y-1.5">
            {(data?.alerts ?? []).map((alert, i) => {
              const cfg = IMPACT_CFG[alert.severity] ?? IMPACT_CFG.info;
              return (
                <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${cfg.bg}`}>
                  <Activity className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                  <span>{alert.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(data?.sources ?? []).map(s => (
              <div key={s.platform} className="p-4 rounded-xl border bg-card text-center" data-testid={`reputation-${s.platform.toLowerCase()}`}>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{s.platform}</p>
                <div className="flex items-center justify-center gap-1.5 mb-0.5">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <p className="text-xl font-extrabold">{s.rating}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{s.reviewCount} reviews</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <TrendIcon direction={s.trend} />
                  <span className="text-[9px] text-muted-foreground">Trending</span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b">
              <h3 className="text-xs font-semibold">Recent Mentions</h3>
            </div>
            <div className="divide-y">
              {(data?.recentMentions ?? []).map((m, i) => {
                const sentimentColor = m.sentiment === "positive" ? "text-emerald-600 dark:text-emerald-400" : m.sentiment === "negative" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
                return (
                  <div key={i} className="flex items-start gap-3 p-3.5" data-testid={`mention-${i}`}>
                    <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${sentimentColor.replace("text-", "bg-").split(" ")[0]}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-semibold">{m.platform}</span>
                        <span className={`text-[10px] capitalize ${sentimentColor}`}>{m.sentiment}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{format(new Date(m.date), "MMM d")}</span>
                      </div>
                      <p className="text-xs italic text-muted-foreground">"{m.snippet}"</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Hiring Intelligence ─────────────────────────────────────────────────

function HiringTab() {
  const { data, isLoading } = useQuery<HiringData>({ queryKey: ["/api/market/hiring"], staleTime: 10 * 60_000 });
  const URGENCY_COLORS: Record<string, string> = { high: "text-rose-600 dark:text-rose-400", moderate: "text-amber-600 dark:text-amber-400", low: "text-muted-foreground" };

  return (
    <div className="space-y-4" data-testid="tab-hiring">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Team Size",      value: data.currentTeamSize,  color: "text-foreground" },
            { label: "Hire Urgency",   value: data.hiringRecommendation, color: URGENCY_COLORS[data.hiringRecommendation] ?? "text-foreground", capitalize: true },
            { label: "Best Window",    value: "Aug–Sep",              color: "text-blue-600 dark:text-blue-400" },
            { label: "Candidates",     value: data.candidatePipeline, color: data.candidatePipeline > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold capitalize ${s.color}`}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="p-4 rounded-xl border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Hiring Market Insights</h3>
            </div>
            <div className="space-y-2.5">
              {(data?.marketInsights ?? []).map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5" data-testid={`hiring-insight-${i}`}>
                  <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${URGENCY_COLORS[insight.urgency]?.replace("text-", "bg-").split(" ")[0] ?? "bg-muted-foreground"}`} />
                  <div>
                    <p className="text-xs">{insight.insight}</p>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 mt-0.5 capitalize ${URGENCY_COLORS[insight.urgency]}`}>{insight.urgency} urgency</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(data?.competitorHiring ?? []).length > 0 && (
            <div className="p-4 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Competitor Hiring Activity</h3>
              </div>
              {data.competitorHiring.map((c, i) => (
                <div key={i} className="flex items-center gap-3 text-xs" data-testid={`comp-hiring-${i}`}>
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium">{c.competitor}</span>
                  <span className="text-muted-foreground">posting {c.openRoles} roles —</span>
                  <span className="italic text-amber-600 dark:text-amber-400">{c.implication}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Trend Radar ────────────────────────────────────────────────────────

function TrendsTab() {
  const { data, isLoading } = useQuery<TrendsData>({ queryKey: ["/api/market/trends"], staleTime: 15 * 60_000 });
  const [relevanceFilter, setRelevanceFilter] = useState("all");
  const filtered = relevanceFilter === "all" ? (data?.trends ?? []) : (data?.trends ?? []).filter(t => t.relevance === relevanceFilter);

  const PHASE_COLORS: Record<string, string> = { emerging: "text-blue-600 dark:text-blue-400", growth: "text-emerald-600 dark:text-emerald-400", mature: "text-amber-600 dark:text-amber-400", declining: "text-rose-600 dark:text-rose-400" };
  const CATEGORY_ICONS: Record<string, any> = { training: Zap, tech: Activity, recovery: Heart, youth: Users, corporate: Briefcase, online: Globe };

  return (
    <div className="space-y-4" data-testid="tab-trends">
      <div className="flex gap-1.5 flex-wrap">
        {["all", "high", "moderate"].map(f => (
          <button key={f} onClick={() => setRelevanceFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${relevanceFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            data-testid={`trend-filter-${f}`}>
            {f === "all" ? "All Trends" : `${f} Relevance`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(trend => {
            const Icon = CATEGORY_ICONS[trend.category] ?? TrendingUp;
            const phaseColor = PHASE_COLORS[trend.phase] ?? "text-muted-foreground";
            return (
              <div key={trend.id} className="p-4 rounded-xl border bg-card" data-testid={`trend-${trend.id}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold">{trend.title}</p>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 capitalize ${phaseColor}`}>{trend.phase}</Badge>
                      {trend.relevance === "high" && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary">High Relevance</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{trend.description}</p>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[9px] text-muted-foreground">Momentum</span>
                      <div className="flex-1">
                        <ProgressBar value={trend.momentum} color={trend.momentum >= 80 ? "bg-emerald-500" : trend.momentum >= 60 ? "bg-amber-500" : "bg-muted-foreground"} />
                      </div>
                      <span className="text-xs font-bold shrink-0">{trend.momentum}</span>
                    </div>
                    <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                      <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <p className="text-[10px]"><span className="font-semibold text-primary">Action: </span>{trend.actionableInsight}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Partnerships ─────────────────────────────────────────────────────────

function PartnershipsTab() {
  const { data, isLoading } = useQuery<PartnershipsData>({ queryKey: ["/api/market/partnerships"], staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-partnerships">
      {data && (
        <div className="flex items-center justify-between p-3 rounded-xl border bg-card">
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Total Partnership Value</p>
            <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">${data.totalPartnershipValue.toLocaleString()}</p>
          </div>
          <p className="text-xs text-muted-foreground">{data.partnerships.length} partnership opportunities ranked by strategic fit</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.partnerships ?? []).map(p => {
            const Icon = TYPE_ICONS[p.type] ?? Building2;
            return (
              <div key={p.id} className="p-4 rounded-xl border bg-card" data-testid={`partner-${p.id}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted shrink-0"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold">{p.name}</p>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{p.type.replace("_", " ")}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-2 italic">{p.note}</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[9px] text-muted-foreground">Strategic Fit</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ProgressBar value={p.strategicFit} color="bg-primary" />
                          <span className="text-[10px] font-bold shrink-0">{p.strategicFit}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">Likelihood</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ProgressBar value={p.likelihood} color={p.likelihood >= 70 ? "bg-emerald-500" : "bg-amber-500"} />
                          <span className="text-[10px] font-bold shrink-0">{p.likelihood}%</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] text-muted-foreground">Est. Value</p>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${p.estimatedValue.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Growth Engine ────────────────────────────────────────────────────────

function GrowthEngineTab() {
  const { toast } = useToast();
  const [focus, setFocus] = useState("general");
  const [result, setResult] = useState<GrowthData | null>(null);

  const growthMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/market/growth-engine", { focus })).json(),
    onSuccess: (data: GrowthData) => setResult(data),
    onError: () => toast({ title: "Failed to generate growth opportunities", variant: "destructive" }),
  });

  const focusOptions = [
    { value: "general",     label: "General Growth" },
    { value: "youth",       label: "Youth Athletes" },
    { value: "team",        label: "Team Contracts" },
    { value: "corporate",   label: "Corporate Wellness" },
    { value: "partnerships",label: "Partnerships" },
    { value: "retention",   label: "Client Retention" },
  ];

  const EFFORT_COLORS: Record<string, string> = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-growth">
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-r from-emerald-500/5 to-primary/5">
        <Lightbulb className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">AI Growth Opportunity Engine</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Combines market data, revenue data, and competitor intelligence to generate your top growth opportunities with revenue projections.</p>
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-44">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Focus area</label>
          <Select value={focus} onValueChange={setFocus}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-growth-focus"><SelectValue /></SelectTrigger>
            <SelectContent>{focusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => growthMutation.mutate()} disabled={growthMutation.isPending} className="h-8 gap-1.5 shrink-0" data-testid="button-generate-growth">
          <Lightbulb className="h-3.5 w-3.5" />{growthMutation.isPending ? "Generating..." : "Generate Opportunities"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3" data-testid="growth-results">
          {(result.opportunities ?? []).map(op => (
            <div key={op.id} className="p-4 rounded-xl border bg-card" data-testid={`growth-op-${op.id}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-semibold">{op.title}</p>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 capitalize">{op.category.replace("_", " ")}</Badge>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 capitalize ${EFFORT_COLORS[op.effort]}`}>{op.effort} effort</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{op.rationale}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">${op.expectedRevenue.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">{op.timeframe}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[9px] text-muted-foreground shrink-0">Confidence</span>
                <ProgressBar value={op.confidence} color={op.confidence >= 75 ? "bg-emerald-500" : "bg-amber-500"} />
                <span className="text-[10px] font-bold shrink-0">{op.confidence}%</span>
              </div>
              <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5 border border-primary/20">
                <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[10px]"><span className="font-semibold text-primary">First step: </span>{op.firstStep}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Competitive Advantage ───────────────────────────────────────────────

function AdvantageTab() {
  const { toast } = useToast();
  const [result, setResult] = useState<AdvantageData | null>(null);

  const advantageMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/market/advantage", {})).json(),
    onSuccess: (data: AdvantageData) => setResult(data),
    onError: () => toast({ title: "Failed to analyze competitive advantage", variant: "destructive" }),
  });

  const POSITION_CFG: Record<string, { color: string; label: string }> = {
    leader:     { color: "text-emerald-600 dark:text-emerald-400", label: "Market Leader" },
    challenger: { color: "text-blue-600 dark:text-blue-400",       label: "Strong Challenger" },
    follower:   { color: "text-amber-600 dark:text-amber-400",     label: "Market Follower" },
    niche:      { color: "text-violet-600 dark:text-violet-400",   label: "Niche Player" },
  };
  const SUSTAIN_COLORS: Record<string, string> = { high: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", low: "text-rose-600 dark:text-rose-400" };

  return (
    <div className="space-y-4" data-testid="tab-advantage">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Competitive Advantage Analyzer</h3>
          <p className="text-xs text-muted-foreground mt-0.5">AI-powered SWOT analysis comparing your business against the market. Run anytime to get fresh strategic positioning.</p>
        </div>
        <Button onClick={() => advantageMutation.mutate()} disabled={advantageMutation.isPending} className="gap-1.5 shrink-0 h-8" data-testid="button-analyze-advantage">
          <Trophy className="h-3.5 w-3.5" />{advantageMutation.isPending ? "Analyzing..." : "Analyze Now"}
        </Button>
      </div>

      {result && (
        <div className="space-y-4" data-testid="advantage-result">
          {/* Position badge */}
          {result.overallPosition && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              <Trophy className={`h-6 w-6 shrink-0 ${POSITION_CFG[result.overallPosition]?.color ?? "text-primary"}`} />
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Market Position</p>
                <p className={`text-sm font-bold ${POSITION_CFG[result.overallPosition]?.color ?? "text-primary"}`}>{POSITION_CFG[result.overallPosition]?.label ?? result.overallPosition}</p>
              </div>
            </div>
          )}

          {/* SWOT Grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "strengths",    items: result.strengths,     color: "bg-emerald-500/5 border-emerald-200 dark:border-emerald-900", icon: CheckCircle, iconColor: "text-emerald-500", label: "Strengths" },
              { key: "weaknesses",   items: result.weaknesses,    color: "bg-amber-500/5 border-amber-200 dark:border-amber-900",     icon: AlertTriangle, iconColor: "text-amber-500",  label: "Weaknesses" },
              { key: "opportunities",items: result.opportunities, color: "bg-blue-500/5 border-blue-200 dark:border-blue-900",         icon: TrendingUp, iconColor: "text-blue-500",      label: "Opportunities" },
              { key: "threats",      items: result.threats,       color: "bg-rose-500/5 border-rose-200 dark:border-rose-900",         icon: Shield, iconColor: "text-rose-500",           label: "Threats" },
            ].map(q => {
              const Icon = q.icon;
              return (
                <div key={q.key} className={`p-3 rounded-xl border ${q.color}`} data-testid={`swot-${q.key}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon className={`h-3.5 w-3.5 ${q.iconColor}`} />
                    <span className="text-xs font-semibold">{q.label}</span>
                  </div>
                  <div className="space-y-1">
                    {(q.items ?? []).map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <div className="h-1 w-1 rounded-full bg-current mt-1.5 shrink-0 opacity-50" />
                        <p className="text-[10px] text-muted-foreground leading-snug">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Competitive advantages */}
          {(result.competitiveAdvantages ?? []).length > 0 && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Award className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Your Competitive Advantages</h3>
              </div>
              <div className="space-y-2.5">
                {result.competitiveAdvantages.map((a, i) => (
                  <div key={i} className="flex items-center gap-3" data-testid={`advantage-${i}`}>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs">{a.advantage}</p>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className={`text-[9px] font-medium capitalize ${SUSTAIN_COLORS[a.sustainability]}`}>{a.sustainability} sustainability</span>
                          <ScoreBadge score={a.score} />
                        </div>
                      </div>
                      <ProgressBar value={a.score} color={a.score >= 80 ? "bg-primary" : "bg-amber-500"} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategic recommendations */}
          {(result.strategicRecommendations ?? []).length > 0 && (
            <div className="p-4 rounded-xl border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Strategic Recommendations</h3>
              </div>
              <div className="space-y-2">
                {result.strategicRecommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5" data-testid={`strategic-rec-${i}`}>
                    <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminMarketIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const { data: overview } = useQuery<MarketOverview>({
    queryKey: ["/api/market/overview"],
    staleTime: 5 * 60_000,
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-market-intelligence">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/trust-attribution">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Trust & Attribution
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            External Intelligence Network
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Market monitoring, competitor tracking, opportunity discovery, and growth intelligence.
          </p>
        </div>

        {/* Live market health */}
        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Market Health</p>
              <p className={`text-2xl font-extrabold ${overview.marketHealthScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : overview.marketHealthScore >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{overview.marketHealthScore}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Opportunities</p>
              <p className="text-2xl font-extrabold text-primary">{overview.topOpportunities.length}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Threats</p>
              <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{overview.topThreats.length}</p>
            </div>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup Wizard",           href: "/admin/ai-workforce" },
          { label: "Workforce Mgmt",          href: "/admin/ai-workforce/settings" },
          { label: "Operations",              href: "/admin/ai-operations" },
          { label: "Executive Intel",         href: "/admin/executive-intelligence" },
          { label: "Autonomous Mgmt",         href: "/admin/autonomous-management" },
          { label: "Trust & Attribution",     href: "/admin/trust-attribution" },
          { label: "External Intelligence",   href: null, active: true },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href ? (
              <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
            ) : (
              <span className="font-semibold text-foreground">{step.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-market">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "overview"      && <OverviewTab />}
        {activeTab === "competitors"   && <CompetitorsTab />}
        {activeTab === "opportunities" && <OpportunitiesTab />}
        {activeTab === "sentiment"     && <SentimentTab />}
        {activeTab === "reputation"    && <ReputationTab />}
        {activeTab === "hiring"        && <HiringTab />}
        {activeTab === "trends"        && <TrendsTab />}
        {activeTab === "partnerships"  && <PartnershipsTab />}
        {activeTab === "growth"        && <GrowthEngineTab />}
        {activeTab === "advantage"     && <AdvantageTab />}
      </div>

      {/* Forward navigation → Network Intelligence */}
      <Link href="/admin/network-intelligence">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-network-intelligence">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Network className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Network Intelligence</p>
            <p className="text-xs text-muted-foreground mt-0.5">Benchmark against the platform network, discover best practices, replicate top-performer strategies, and generate AI-powered strategic plans.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
