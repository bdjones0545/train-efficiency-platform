import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Users, TrendingUp, DollarSign, Calendar, BarChart3, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from "lucide-react";
import { getAuthHeaders } from "@/lib/authToken";
import type { CoachWithUser } from "@/lib/types";
import type { UserProfile } from "@shared/schema";

function fetchWithAuth(url: string) {
  return fetch(url, { headers: getAuthHeaders() }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    return res.json();
  });
}

type ClientSession = {
  date: string;
  status: string;
  serviceName: string;
  priceCents: number;
  paymentMethod: string | null;
};

type BusinessPlanClient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  profileImageUrl: string | null;
  sessions: ClientSession[];
};

type RevenueMonth = {
  month: string;
  revenueCents: number;
};

type BusinessPlanData = {
  coach: {
    id: string;
    name: string;
    photoUrl: string | null;
    specialties: string[] | null;
  };
  clients: BusinessPlanClient[];
  stats: {
    totalClients: number;
    totalSessions: number;
    completedSessions: number;
    totalRevenueCents: number;
    predictedMonthlyRevenueCents: number;
  };
  revenueHistory: RevenueMonth[];
  actualRevenue: {
    walletCents: number;
    venmoCents: number;
    cashCents: number;
  };
};

type TimePeriod = "daily" | "weekly" | "monthly" | "yearly";

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function aggregateRevenue(
  clients: BusinessPlanClient[],
  period: TimePeriod,
  offset: number = 0
): { label: string; revenueCents: number }[] {
  const allSessions: { date: Date; priceCents: number }[] = [];
  for (const c of clients) {
    for (const s of c.sessions) {
      if (s.status === "CANCELLED" || s.status === "NO_SHOW") continue;
      allSessions.push({ date: new Date(s.date), priceCents: s.priceCents });
    }
  }
  if (allSessions.length === 0) return [];

  const buckets = new Map<string, number>();
  const now = new Date();

  let cutoff: Date;
  let endDate: Date;
  let keyFn: (d: Date) => string;
  let labelFn: (key: string) => string;

  switch (period) {
    case "daily": {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - offset * 30);
      cutoff = new Date(endDate);
      cutoff.setDate(cutoff.getDate() - 30);
      keyFn = (d) => d.toISOString().slice(0, 10);
      labelFn = (k) => {
        const d = new Date(k + "T00:00:00");
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
      break;
    }
    case "weekly": {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - offset * 12 * 7);
      cutoff = new Date(endDate);
      cutoff.setDate(cutoff.getDate() - 12 * 7);
      keyFn = (d) => getWeekKey(d);
      labelFn = (k) => {
        const d = new Date(k + "T00:00:00");
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
      break;
    }
    case "monthly": {
      endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() - offset * 6);
      cutoff = new Date(endDate);
      cutoff.setMonth(cutoff.getMonth() - 6);
      keyFn = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      labelFn = (k) => {
        const [y, m] = k.split("-");
        return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", { month: "short" });
      };
      break;
    }
    case "yearly": {
      endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() - offset * 5);
      cutoff = new Date(endDate);
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      keyFn = (d) => String(d.getFullYear());
      labelFn = (k) => k;
      break;
    }
  }

  for (const s of allSessions) {
    if (s.date < cutoff || s.date > endDate) continue;
    const key = keyFn(s.date);
    buckets.set(key, (buckets.get(key) || 0) + s.priceCents);
  }

  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([key, cents]) => ({ label: labelFn(key), revenueCents: cents }));
}

function getPeriodRangeLabel(period: TimePeriod, offset: number): string {
  const now = new Date();
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const fmtMonth = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  switch (period) {
    case "daily": {
      const end = new Date(now);
      end.setDate(end.getDate() - offset * 30);
      const start = new Date(end);
      start.setDate(start.getDate() - 30);
      return `${fmt(start)} – ${fmt(end)}`;
    }
    case "weekly": {
      const end = new Date(now);
      end.setDate(end.getDate() - offset * 12 * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 12 * 7);
      return `${fmt(start)} – ${fmt(end)}`;
    }
    case "monthly": {
      const end = new Date(now);
      end.setMonth(end.getMonth() - offset * 6);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      return `${fmtMonth(start)} – ${fmtMonth(end)}`;
    }
    case "yearly": {
      const end = new Date(now);
      end.setFullYear(end.getFullYear() - offset * 5);
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 5);
      return `${start.getFullYear()} – ${end.getFullYear()}`;
    }
  }
}

type RevenueView = "time" | "source";

function getConsistencyScore(sessions: ClientSession[]): { label: string; color: string; score: number } {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const recentSessions = sessions.filter(
    (s) => new Date(s.date) >= threeMonthsAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
  );

  const sessionsPerWeek = recentSessions.length / 13;

  if (sessionsPerWeek >= 1) return { label: "Consistent", color: "text-green-500", score: sessionsPerWeek };
  if (sessionsPerWeek > 0) return { label: "Inconsistent", color: "text-orange-400", score: sessionsPerWeek };
  return { label: "Inactive", color: "text-muted-foreground", score: 0 };
}

export default function CoachBusinessPlanPage() {
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");
  const [revenuePeriod, setRevenuePeriod] = useState<TimePeriod>("monthly");
  const [revenueView, setRevenueView] = useState<RevenueView>("time");
  const [periodOffset, setPeriodOffset] = useState(0);

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const isAdmin = profile?.role === "ADMIN";

  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches"],
  });

  const { data: myCoachProfile } = useQuery<{ id: string }>({
    queryKey: ["/api/coach/profile"],
    queryFn: () => fetchWithAuth("/api/coach/profile"),
  });

  const activeCoachId = selectedCoachId || myCoachProfile?.id || "";

  const { data: plan, isLoading } = useQuery<BusinessPlanData>({
    queryKey: ["/api/coach/business-plan", activeCoachId],
    queryFn: () => fetchWithAuth(`/api/coach/business-plan/${activeCoachId}`),
    enabled: !!activeCoachId,
  });

  const chartData = plan ? aggregateRevenue(plan.clients, revenuePeriod, periodOffset) : [];
  const maxRevenue = chartData.length > 0
    ? Math.max(...chartData.map((r) => r.revenueCents))
    : 0;
  const rangeLabel = getPeriodRangeLabel(revenuePeriod, periodOffset);
  const actualData = plan ? [
    ...(plan.actualRevenue.walletCents > 0 ? [{ label: "Wallet", revenueCents: plan.actualRevenue.walletCents, colorClass: "bg-blue-500" }] : []),
    ...(plan.actualRevenue.venmoCents > 0 ? [{ label: "Venmo", revenueCents: plan.actualRevenue.venmoCents, colorClass: "bg-purple-500" }] : []),
    ...(plan.actualRevenue.cashCents > 0 ? [{ label: "Cash", revenueCents: plan.actualRevenue.cashCents, colorClass: "bg-green-500" }] : []),
  ] : [];
  const maxActualRevenue = actualData.length > 0
    ? Math.max(...actualData.map((r) => r.revenueCents))
    : 0;
  const totalActualRevenue = actualData.reduce((sum, r) => sum + r.revenueCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-business-plan-title">Business Plan</h1>
          <p className="text-muted-foreground text-sm">Client overview and revenue predictions</p>
        </div>
      </div>

      {coaches && coaches.filter((c) => c.isActive).length > 1 && (
        <Card className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">View coach:</span>
            <Select
              value={activeCoachId}
              onValueChange={setSelectedCoachId}
            >
              <SelectTrigger className="w-full sm:w-64" data-testid="select-business-coach">
                <SelectValue placeholder="Select a coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.filter((c) => c.isActive).map((coach) => (
                  <SelectItem key={coach.id} value={coach.id} data-testid={`option-bp-coach-${coach.id}`}>
                    {coach.user?.firstName} {coach.user?.lastName}
                    {coach.id === myCoachProfile?.id ? " (You)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCoachId && selectedCoachId !== myCoachProfile?.id && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-viewing-coach">
                Viewing {plan?.coach?.name || "..."}
              </Badge>
            )}
          </div>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {plan && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 space-y-1" data-testid="stat-total-clients">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Users className="h-4 w-4" />
                Total Clients
              </div>
              <p className="text-2xl font-bold">{plan.stats.totalClients}</p>
            </Card>
            <Card className="p-4 space-y-1" data-testid="stat-total-sessions">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Calendar className="h-4 w-4" />
                Total Sessions
              </div>
              <p className="text-2xl font-bold">{plan.stats.totalSessions}</p>
            </Card>
            <Card className="p-4 space-y-1" data-testid="stat-total-revenue">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <DollarSign className="h-4 w-4" />
                Total Revenue
              </div>
              <p className="text-2xl font-bold">${(plan.stats.totalRevenueCents / 100).toFixed(0)}</p>
            </Card>
            <Card className="p-4 space-y-1 border-primary/30 bg-primary/5" data-testid="stat-predicted-revenue">
              <div className="flex items-center gap-2 text-primary text-xs font-medium">
                <TrendingUp className="h-4 w-4" />
                Predicted Monthly
              </div>
              <p className="text-2xl font-bold text-primary">
                ${(plan.stats.predictedMonthlyRevenueCents / 100).toFixed(0)}
              </p>
              <p className="text-xs text-muted-foreground">Based on session consistency</p>
            </Card>
          </div>

          <Card className="p-5 space-y-4" data-testid="card-revenue-chart">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Revenue</h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Tabs value={revenueView} onValueChange={(v) => setRevenueView(v as RevenueView)}>
                  <TabsList className="h-8" data-testid="tabs-revenue-view">
                    <TabsTrigger value="time" className="text-xs px-3" data-testid="tab-by-time">By Time</TabsTrigger>
                    <TabsTrigger value="source" className="text-xs px-3" data-testid="tab-by-source">Actual</TabsTrigger>
                  </TabsList>
                </Tabs>
                {revenueView === "time" && (
                  <Tabs value={revenuePeriod} onValueChange={(v) => { setRevenuePeriod(v as TimePeriod); setPeriodOffset(0); }}>
                    <TabsList className="h-8" data-testid="tabs-revenue-period">
                      <TabsTrigger value="daily" className="text-xs px-3" data-testid="tab-daily">Daily</TabsTrigger>
                      <TabsTrigger value="weekly" className="text-xs px-3" data-testid="tab-weekly">Weekly</TabsTrigger>
                      <TabsTrigger value="monthly" className="text-xs px-3" data-testid="tab-monthly">Monthly</TabsTrigger>
                      <TabsTrigger value="yearly" className="text-xs px-3" data-testid="tab-yearly">Yearly</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              </div>
            </div>

            {revenueView === "time" && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                  data-testid="btn-period-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground font-medium min-w-[180px] text-center" data-testid="text-period-range">
                  {rangeLabel}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPeriodOffset((o) => Math.max(0, o - 1))}
                  disabled={periodOffset === 0}
                  data-testid="btn-period-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {revenueView === "time" ? (
              <>
                {chartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-revenue">
                    No revenue data for this period.
                  </p>
                ) : (
                  <div className="flex items-end gap-1 h-40 overflow-x-auto pb-1">
                    {chartData.map((r, i) => {
                      const height = maxRevenue > 0 ? (r.revenueCents / maxRevenue) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 min-w-[28px] flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                            ${(r.revenueCents / 100).toFixed(0)}
                          </span>
                          <div
                            className="w-full bg-primary/80 rounded-t-md transition-all min-h-[4px]"
                            style={{ height: `${Math.max(height, 3)}%` }}
                            data-testid={`bar-revenue-${i}`}
                          />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{r.label}</span>
                        </div>
                      );
                    })}

                    {revenuePeriod === "monthly" && periodOffset === 0 && (
                      <div className="flex-1 min-w-[28px] flex flex-col items-center gap-1">
                        <span className="text-[10px] font-medium text-primary whitespace-nowrap">
                          ${(plan.stats.predictedMonthlyRevenueCents / 100).toFixed(0)}
                        </span>
                        <div
                          className="w-full bg-primary/30 border-2 border-dashed border-primary rounded-t-md transition-all min-h-[4px]"
                          style={{
                            height: `${maxRevenue > 0 ? Math.max((plan.stats.predictedMonthlyRevenueCents / maxRevenue) * 100, 3) : 50}%`,
                          }}
                          data-testid="bar-predicted"
                        />
                        <span className="text-[10px] text-primary font-medium">Next</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {actualData.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-actual-data">
                    No payment data available.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-end gap-3 h-40 px-4">
                      {actualData.map((s, i) => {
                        const height = maxActualRevenue > 0 ? (s.revenueCents / maxActualRevenue) * 100 : 0;
                        const pct = totalActualRevenue > 0 ? ((s.revenueCents / totalActualRevenue) * 100).toFixed(0) : "0";
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                              ${(s.revenueCents / 100).toFixed(0)}
                            </span>
                            <div
                              className={`w-full ${s.colorClass} rounded-t-md transition-all min-h-[4px] opacity-80`}
                              style={{ height: `${Math.max(height, 3)}%` }}
                              data-testid={`bar-actual-${i}`}
                            />
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{s.label}</span>
                            <span className="text-[10px] text-muted-foreground">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-3 justify-center pt-1">
                      {actualData.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5" data-testid={`legend-actual-${i}`}>
                          <div className={`w-2.5 h-2.5 rounded-full ${s.colorClass}`} />
                          <span className="text-xs text-muted-foreground">{s.label}: ${(s.revenueCents / 100).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-center pt-1">
                      <span className="text-sm font-semibold" data-testid="text-actual-total">
                        Total: ${(totalActualRevenue / 100).toFixed(0)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card className="p-5 space-y-4" data-testid="card-client-list">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Clients ({plan.clients.length})</h2>
              </div>
            </div>

            {plan.clients.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-clients">
                No clients yet. Sessions will appear here as they are booked.
              </p>
            ) : (
              <div className="space-y-3">
                {plan.clients.map((client) => {
                  const consistency = getConsistencyScore(client.sessions);
                  const completedCount = client.sessions.filter(
                    (s) => s.status === "COMPLETED" || s.status === "CONFIRMED"
                  ).length;
                  const totalSpent = client.sessions
                    .filter((s) => s.status !== "CANCELLED" && s.status !== "NO_SHOW")
                    .reduce((sum, s) => sum + s.priceCents, 0);
                  const lastSession = client.sessions[client.sessions.length - 1];
                  const lastDate = lastSession ? new Date(lastSession.date) : null;
                  const daysSinceLastSession = lastDate
                    ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
                    : null;

                  return (
                    <div
                      key={client.id}
                      className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      data-testid={`client-row-${client.id}`}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={client.profileImageUrl || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-sm">
                          {(client.firstName?.[0] || "?").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm" data-testid={`text-client-name-${client.id}`}>
                            {client.firstName} {client.lastName}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${consistency.color}`}
                            data-testid={`badge-consistency-${client.id}`}
                          >
                            {consistency.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          <span>{completedCount} session{completedCount !== 1 ? "s" : ""}</span>
                          <span>${(totalSpent / 100).toFixed(0)} total</span>
                          {daysSinceLastSession !== null && (
                            <span className="flex items-center gap-0.5">
                              {daysSinceLastSession <= 14 ? (
                                <ArrowUpRight className="h-3 w-3 text-green-500" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3 text-orange-400" />
                              )}
                              {daysSinceLastSession === 0
                                ? "Today"
                                : daysSinceLastSession === 1
                                  ? "Yesterday"
                                  : `${daysSinceLastSession}d ago`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium">~{consistency.score.toFixed(1)}/wk</p>
                        <p className="text-xs text-muted-foreground">avg sessions</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
