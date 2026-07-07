import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import {
  BarChart3, Send, Users, DollarSign, TrendingUp, Clock,
  CheckCircle2, XCircle, RefreshCw, Trophy, Target, Zap,
  Award, AlertCircle, ChevronRight, Calendar, User, Lightbulb,
  Star, Activity
} from "lucide-react";
import { useState } from "react";
import { format, parseISO, subDays } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportSummary {
  totalCampaigns: number;
  campaignsSent: number;
  totalBookings: number;
  totalRevenueCents: number;
  avgFillRatePct: number;
  avgHoursToFill: number;
}

interface CampaignRow {
  id: string;
  session_name: string;
  coach_name: string;
  subject: string;
  recipient_count: number;
  open_spots: number;
  estimated_value_cents: number;
  status: string;
  version: number;
  submitted_at: string;
  sent_at: string | null;
  bookings: number;
  revenue_cents: number;
  fill_rate_pct: number;
  avg_hours_to_fill: number;
}

interface SubjectLine {
  subject: string;
  avgFillRate: number;
  totalBookings: number;
  campaigns: number;
}

interface AudienceType {
  reason: string;
  count: number;
}

interface ReportData {
  summary: ReportSummary;
  campaigns: CampaignRow[];
  topSubjectLines: SubjectLine[];
  topAudienceTypes: AudienceType[];
  coaches: string[];
}

interface AggregateData {
  summary: any;
  campaigns: any[];
  coachAnalytics: any[];
  topPerformers: {
    byFillRate: any[];
    byRevenue: any[];
    bySpeed: any[];
    byBookings: any[];
  };
  worstPerforming: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color = "text-foreground",
}: {
  label: string; value: string | number; sub?: string; icon: typeof BarChart3; color?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

function fillRateColor(pct: number) {
  if (pct >= 70) return "text-green-600 dark:text-green-400";
  if (pct >= 40) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function statusBadge(status: string) {
  const MAP: Record<string, string> = {
    pending_approval: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    approved:   "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    completed:  "bg-green-500/15 text-green-700 dark:text-green-400",
    rejected:   "bg-red-500/15 text-red-700 dark:text-red-400",
    sending:    "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    superseded: "bg-muted text-muted-foreground",
  };
  return <Badge className={`text-[10px] ${MAP[status] ?? "bg-muted text-muted-foreground"}`}>{status.replace(/_/g, " ")}</Badge>;
}

function TopCampaignRow({ c, rank, metric }: { c: any; rank: number; metric: string }) {
  const value = metric === "fillRate" ? `${c.fill_rate_pct ?? 0}%`
    : metric === "revenue" ? `$${Math.round(Number(c.revenue_cents ?? 0) / 100).toLocaleString()}`
    : metric === "speed" ? `${Math.round(Number(c.avg_hours_to_fill ?? 0) * 10) / 10}h`
    : `${c.bookings ?? 0} booked`;
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0">
      <span className={`text-sm font-bold w-5 flex-none ${rank <= 3 ? "text-primary" : "text-muted-foreground"}`}>
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{c.session_name ?? "—"}</p>
        <p className="text-[10px] text-muted-foreground truncate">{c.subject ?? ""}</p>
      </div>
      <p className={`text-sm font-bold flex-none ${
        metric === "fillRate" ? fillRateColor(Number(c.fill_rate_pct ?? 0)) :
        metric === "revenue" ? "text-green-600 dark:text-green-400" :
        metric === "speed" ? "text-blue-600 dark:text-blue-400" : ""
      }`}>{value}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFillCampaignAnalyticsPage() {
  const [coachFilter, setCoachFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [activeTopTab, setActiveTopTab] = useState<"fillRate" | "revenue" | "speed" | "bookings">("fillRate");

  const qs = new URLSearchParams({
    coachName: coachFilter,
    status: statusFilter,
    startDate,
    endDate,
  }).toString();

  const { data, isLoading, refetch } = useQuery<ReportData>({
    queryKey: ["/api/scheduling-intelligence/fill-campaigns/reporting", coachFilter, statusFilter, startDate, endDate],
    queryFn: () => authenticatedFetch(`/api/scheduling-intelligence/fill-campaigns/reporting?${qs}`),
  });

  const { data: agg, isLoading: aggLoading } = useQuery<AggregateData>({
    queryKey: ["/api/scheduling-intelligence/fill-campaigns/aggregate-analytics"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-campaigns/aggregate-analytics"),
  });

  const { data: insightsData, isLoading: insightsLoading } = useQuery<{ insights: string[] }>({
    queryKey: ["/api/scheduling-intelligence/fill-campaigns/insights"],
    queryFn: () => authenticatedFetch("/api/scheduling-intelligence/fill-campaigns/insights"),
    staleTime: 10 * 60 * 1000,
  });

  const summary = data?.summary;
  const campaigns = data?.campaigns ?? [];
  const coaches = data?.coaches ?? [];
  const topSubjectLines = data?.topSubjectLines ?? [];
  const topAudienceTypes = data?.topAudienceTypes ?? [];
  const coachAnalytics = agg?.coachAnalytics ?? [];
  const topPerformers = agg?.topPerformers;
  const worstPerforming = agg?.worstPerforming ?? [];

  const topTabOptions = [
    { key: "fillRate" as const, label: "Fill Rate", icon: Target },
    { key: "revenue" as const, label: "Revenue", icon: DollarSign },
    { key: "speed" as const, label: "Fastest", icon: Zap },
    { key: "bookings" as const, label: "Bookings", icon: Users },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Fill Campaign Analytics
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Deterministic performance reporting — all metrics sourced from actual booking attributions
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
          data-testid="button-refresh-analytics"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Filters</p>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={coachFilter} onValueChange={setCoachFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="filter-coach">
              <SelectValue placeholder="All coaches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coaches</SelectItem>
              {coaches.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs" data-testid="filter-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending_approval">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs w-36"
              data-testid="filter-start-date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-xs w-36"
              data-testid="filter-end-date"
            />
          </div>
        </div>
      </Card>

      {/* Summary KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Campaigns Created" value={summary?.totalCampaigns ?? 0} icon={Send} />
          <StatCard label="Campaigns Sent" value={summary?.campaignsSent ?? 0} icon={CheckCircle2} color="text-primary" />
          <StatCard label="Total Bookings" value={summary?.totalBookings ?? 0} icon={Users} color="text-blue-600 dark:text-blue-400" />
          <StatCard
            label="Revenue Generated"
            value={summary?.totalRevenueCents ? `$${Math.round(summary.totalRevenueCents / 100).toLocaleString()}` : "$0"}
            icon={DollarSign}
            color="text-green-600 dark:text-green-400"
          />
          <StatCard
            label="Avg Fill Rate"
            value={summary?.avgFillRatePct ? `${summary.avgFillRatePct}%` : "—"}
            icon={Target}
            color={summary?.avgFillRatePct ? fillRateColor(summary.avgFillRatePct) : ""}
          />
          <StatCard
            label="Avg Time to Fill"
            value={summary?.avgHoursToFill ? `${summary.avgHoursToFill}h` : "—"}
            icon={Clock}
            color="text-muted-foreground"
          />
        </div>
      )}

      {/* AI Insights */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4 text-yellow-500" />
          <p className="text-sm font-semibold">AI Insights</p>
          <span className="text-[10px] text-muted-foreground ml-1">Generated from actual performance data only</span>
        </div>
        {insightsLoading ? (
          <div className="space-y-2">
            {[1,2,3].map((i) => <Skeleton key={i} className="h-6" />)}
          </div>
        ) : insightsData?.insights && insightsData.insights.length > 0 ? (
          <ul className="space-y-2">
            {insightsData.insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5 flex-none">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No campaign data available for insights yet. Complete campaigns to generate observations.</p>
        )}
      </Card>

      {/* Top + Worst Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Performers */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Top Performing Campaigns</p>
            </div>
            <div className="flex gap-1">
              {topTabOptions.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTopTab(tab.key)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    activeTopTab === tab.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                  data-testid={`tab-top-${tab.key}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {aggLoading ? (
            <div className="space-y-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (topPerformers?.[activeTopTab === "fillRate" ? "byFillRate" : activeTopTab === "revenue" ? "byRevenue" : activeTopTab === "speed" ? "bySpeed" : "byBookings"] ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No completed campaign data yet.</p>
          ) : (
            <div>
              {(topPerformers?.[activeTopTab === "fillRate" ? "byFillRate" : activeTopTab === "revenue" ? "byRevenue" : activeTopTab === "speed" ? "bySpeed" : "byBookings"] ?? []).map((c: any, i: number) => (
                <TopCampaignRow key={c.id} c={c} rank={i + 1} metric={activeTopTab} />
              ))}
            </div>
          )}
        </Card>

        {/* Worst Performing */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold">Lowest Fill Rate</p>
          </div>
          {aggLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : worstPerforming.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No data yet.</p>
          ) : (
            <div>
              {worstPerforming.map((c: any, i: number) => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.session_name ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{c.coach_name}</p>
                  </div>
                  <div className="text-right flex-none">
                    <p className={`text-sm font-bold ${fillRateColor(Number(c.fill_rate_pct ?? 0))}`}>{c.fill_rate_pct ?? 0}%</p>
                    <p className="text-[10px] text-muted-foreground">{c.bookings ?? 0} booked</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Coach Analytics */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <User className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Coach Performance</p>
        </div>
        {aggLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : coachAnalytics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coach data available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Coach</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Campaigns</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Fill Rate</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-2 pl-3 font-medium text-muted-foreground">Avg Time to Fill</th>
                </tr>
              </thead>
              <tbody>
                {coachAnalytics.map((coach: any, i: number) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2 pr-4 font-medium">{coach.coach_name ?? "—"}</td>
                    <td className="text-right py-2 px-3">{coach.campaigns_sent ?? 0}</td>
                    <td className={`text-right py-2 px-3 font-medium ${fillRateColor(Number(coach.avg_fill_rate_pct ?? 0))}`}>
                      {coach.avg_fill_rate_pct ? `${coach.avg_fill_rate_pct}%` : "—"}
                    </td>
                    <td className="text-right py-2 px-3 text-green-600 dark:text-green-400 font-medium">
                      {coach.total_revenue_cents ? `$${Math.round(Number(coach.total_revenue_cents) / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="text-right py-2 pl-3 text-muted-foreground">
                      {Number(coach.avg_hours_to_fill) > 0 ? `${Math.round(Number(coach.avg_hours_to_fill) * 10) / 10}h` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Top Subject Lines */}
      {topSubjectLines.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Star className="h-4 w-4 text-yellow-500" />
            <p className="text-sm font-semibold">Top Performing Subject Lines</p>
            <span className="text-[10px] text-muted-foreground ml-1">by average fill rate</span>
          </div>
          <div className="space-y-2">
            {topSubjectLines.map((sl, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-5 flex-none">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{sl.subject}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {sl.campaigns} campaign{sl.campaigns !== 1 ? "s" : ""} · {sl.totalBookings} booking{sl.totalBookings !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className={`text-sm font-bold flex-none ${fillRateColor(sl.avgFillRate)}`}>
                  {sl.avgFillRate}%
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Top Audience Types */}
      {topAudienceTypes.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Top Audience Types</p>
            <span className="text-[10px] text-muted-foreground ml-1">by frequency across campaigns</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {topAudienceTypes.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-full border bg-muted/30 px-3 py-1">
                <span className="text-xs">{a.reason}</span>
                <Badge className="text-[10px] bg-primary/10 text-primary border-primary/15">{a.count}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Campaign Detail Table */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Campaign Detail</p>
          <span className="text-[10px] text-muted-foreground ml-1">{campaigns.length} campaigns in selected period</span>
        </div>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No campaigns match the selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 font-medium text-muted-foreground min-w-32">Session</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Coach</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Recipients</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Booked</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Fill %</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-2 pl-3 font-medium text-muted-foreground">Time to Fill</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-campaign-${c.id}`}>
                    <td className="py-2 pr-3">
                      <p className="font-medium truncate max-w-36">{c.session_name}</p>
                      <p className="text-muted-foreground truncate max-w-36">{c.subject}</p>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{c.coach_name}</td>
                    <td className="py-2 px-3">{statusBadge(c.status)}</td>
                    <td className="text-right py-2 px-3">{c.recipient_count}</td>
                    <td className="text-right py-2 px-3 font-medium">{c.bookings}</td>
                    <td className={`text-right py-2 px-3 font-bold ${fillRateColor(Number(c.fill_rate_pct ?? 0))}`}>
                      {c.fill_rate_pct ?? 0}%
                    </td>
                    <td className="text-right py-2 px-3 text-green-600 dark:text-green-400 font-medium">
                      {c.revenue_cents ? `$${Math.round(c.revenue_cents / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="text-right py-2 pl-3 text-muted-foreground">
                      {Number(c.avg_hours_to_fill) > 0 ? `${Math.round(Number(c.avg_hours_to_fill) * 10) / 10}h` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground text-right">
        All metrics sourced from `fill_campaign_attributions` — no estimates used
      </p>
    </div>
  );
}
