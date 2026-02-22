import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, TrendingUp, DollarSign, Calendar, BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";
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
};

function getConsistencyScore(sessions: ClientSession[]): { label: string; color: string; score: number } {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const recentSessions = sessions.filter(
    (s) => new Date(s.date) >= threeMonthsAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
  );

  const sessionsPerMonth = recentSessions.length / 3;

  if (sessionsPerMonth >= 4) return { label: "Very Consistent", color: "text-green-500", score: sessionsPerMonth };
  if (sessionsPerMonth >= 2) return { label: "Consistent", color: "text-emerald-400", score: sessionsPerMonth };
  if (sessionsPerMonth >= 1) return { label: "Moderate", color: "text-yellow-500", score: sessionsPerMonth };
  if (sessionsPerMonth > 0) return { label: "Infrequent", color: "text-orange-400", score: sessionsPerMonth };
  return { label: "Inactive", color: "text-muted-foreground", score: 0 };
}

export default function CoachBusinessPlanPage() {
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");

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

  const maxRevenue = plan?.revenueHistory?.length
    ? Math.max(...plan.revenueHistory.map((r) => r.revenueCents))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-business-plan-title">Business Plan</h1>
          <p className="text-muted-foreground text-sm">Client overview and revenue predictions</p>
        </div>
      </div>

      {isAdmin && coaches && coaches.filter((c) => c.isActive).length > 1 && (
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

          {plan.revenueHistory.length > 0 && (
            <Card className="p-5 space-y-4" data-testid="card-revenue-chart">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Revenue History (Last 6 Months)</h2>
              </div>
              <div className="flex items-end gap-2 h-40">
                {plan.revenueHistory.map((r) => {
                  const height = maxRevenue > 0 ? (r.revenueCents / maxRevenue) * 100 : 0;
                  const [year, month] = r.month.split("-");
                  const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleString("default", { month: "short" });
                  return (
                    <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        ${(r.revenueCents / 100).toFixed(0)}
                      </span>
                      <div
                        className="w-full bg-primary/80 rounded-t-md transition-all min-h-[4px]"
                        style={{ height: `${Math.max(height, 3)}%` }}
                        data-testid={`bar-revenue-${r.month}`}
                      />
                      <span className="text-xs text-muted-foreground">{monthLabel}</span>
                    </div>
                  );
                })}

                <div className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-primary">
                    ${(plan.stats.predictedMonthlyRevenueCents / 100).toFixed(0)}
                  </span>
                  <div
                    className="w-full bg-primary/30 border-2 border-dashed border-primary rounded-t-md transition-all min-h-[4px]"
                    style={{
                      height: `${maxRevenue > 0 ? Math.max((plan.stats.predictedMonthlyRevenueCents / maxRevenue) * 100, 3) : 50}%`,
                    }}
                    data-testid="bar-predicted"
                  />
                  <span className="text-xs text-primary font-medium">Next</span>
                </div>
              </div>
            </Card>
          )}

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
                        <p className="text-sm font-medium">~{consistency.score.toFixed(1)}/mo</p>
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
