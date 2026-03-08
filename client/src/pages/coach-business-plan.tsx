import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, TrendingUp, DollarSign, Calendar, BarChart3, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Pencil, Trash2, X, Gift, RefreshCw } from "lucide-react";
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
  actualRevenue?: {
    walletCents: number;
    venmoCents: number;
    cashCents: number;
  };
};

type RevenueMonth = {
  month: string;
  revenueCents: number;
};

type SubscriberUsage = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  planName: string;
  sessionsPerWeek: number;
  sessionsRemaining: number | null;
  totalAllocated: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  status: string;
};

type BusinessPlanData = {
  coach: {
    id: string;
    name: string;
    photoUrl: string | null;
    specialties: string[] | null;
  };
  clients: BusinessPlanClient[];
  subscriptionsEnabled?: boolean;
  subscriberUsage?: SubscriberUsage[];
  stats: {
    totalClients: number;
    totalSessions: number;
    completedSessions: number;
    redeemedSessions: number;
    freeSessionsPerformed: number;
    totalRevenueCents: number;
    predictedMonthlyRevenueCents: number;
    subscriptionRevenueCents: number;
  };
  revenueHistory: RevenueMonth[];
  actualRevenue: {
    walletCents: number;
    venmoCents: number;
    cashCents: number;
    subscriptionCents: number;
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
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const recentSessions = sessions.filter(
    (s) => new Date(s.date) >= threeMonthsAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
  );
  const sessionsPerWeek = recentSessions.length / 13;

  const hadSessionLastWeek = sessions.some(
    (s) => new Date(s.date) >= oneWeekAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
  );

  if (hadSessionLastWeek) return { label: "Consistent", color: "text-green-500", score: sessionsPerWeek };
  if (recentSessions.length > 0) return { label: "Inconsistent", color: "text-orange-400", score: sessionsPerWeek };
  return { label: "Inactive", color: "text-muted-foreground", score: 0 };
}

export default function CoachBusinessPlanPage() {
  const { toast } = useToast();
  const [selectedCoachId, setSelectedCoachId] = useState<string>("");
  const [sessionView, setSessionView] = useState<"scheduled" | "redeemed">("scheduled");
  const [revenuePeriod, setRevenuePeriod] = useState<TimePeriod>("monthly");
  const [revenueView, setRevenueView] = useState<RevenueView>("time");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [selectedClient, setSelectedClient] = useState<BusinessPlanClient | null>(null);
  const [editClient, setEditClient] = useState<BusinessPlanClient | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [deleteClient, setDeleteClient] = useState<BusinessPlanClient | null>(null);

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const isAdmin = profile?.role === "ADMIN";
  const orgId = profile?.organizationId;

  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
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

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { firstName: string; lastName: string; email: string | null } }) => {
      const res = await fetch(`/api/coach/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update client");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/business-plan", activeCoachId] });
      setEditClient(null);
      setSelectedClient(null);
      toast({ title: "Client updated" });
    },
    onError: () => {
      toast({ title: "Failed to update client", variant: "destructive" });
    },
  });

  const removeClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const res = await fetch(`/api/coach/business-plan/${activeCoachId}/clients/${clientId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to remove client");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/business-plan", activeCoachId] });
      setDeleteClient(null);
      setSelectedClient(null);
      toast({ title: "Client removed from list" });
    },
    onError: () => {
      toast({ title: "Failed to remove client", variant: "destructive" });
    },
  });

  const openEditDialog = (client: BusinessPlanClient) => {
    setEditClient(client);
    setEditFirstName(client.firstName);
    setEditLastName(client.lastName);
    setEditEmail(client.email || "");
  };

  const chartData = plan ? aggregateRevenue(plan.clients, revenuePeriod, periodOffset) : [];
  const maxRevenue = chartData.length > 0
    ? Math.max(...chartData.map((r) => r.revenueCents))
    : 0;
  const rangeLabel = getPeriodRangeLabel(revenuePeriod, periodOffset);
  const actualData = plan ? [
    ...(plan.actualRevenue.walletCents > 0 ? [{ label: "Wallet", revenueCents: plan.actualRevenue.walletCents, colorClass: "bg-blue-500" }] : []),
    ...(plan.actualRevenue.venmoCents > 0 ? [{ label: "Venmo", revenueCents: plan.actualRevenue.venmoCents, colorClass: "bg-purple-500" }] : []),
    ...(plan.actualRevenue.cashCents > 0 ? [{ label: "Cash", revenueCents: plan.actualRevenue.cashCents, colorClass: "bg-green-500" }] : []),
    ...(plan.actualRevenue.subscriptionCents > 0 ? [{ label: "Subscriptions", revenueCents: plan.actualRevenue.subscriptionCents, colorClass: "bg-amber-500" }] : []),
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {plan && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="p-4 space-y-1" data-testid="stat-total-clients">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Users className="h-4 w-4" />
                Total Clients
              </div>
              <p className="text-2xl font-bold">{plan.stats.totalClients}</p>
            </Card>
            <Card className="p-4 space-y-1 cursor-pointer" data-testid="stat-total-sessions" onClick={() => setSessionView(sessionView === "scheduled" ? "redeemed" : "scheduled")}>
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Calendar className="h-4 w-4" />
                {sessionView === "scheduled" ? "Sessions Scheduled" : "Sessions Redeemed"}
              </div>
              <p className="text-2xl font-bold">
                {sessionView === "scheduled" ? plan.stats.totalSessions : plan.stats.redeemedSessions}
              </p>
              <p className="text-xs text-muted-foreground">Tap to toggle</p>
            </Card>
            <Card className="p-4 space-y-1" data-testid="stat-free-sessions">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Gift className="h-4 w-4" />
                Free Sessions
              </div>
              <p className="text-2xl font-bold">{plan.stats.freeSessionsPerformed}</p>
              <p className="text-xs text-muted-foreground">${((plan.stats.freeSessionsPerformed || 0) * 20).toFixed(0)} earned</p>
            </Card>
            <Card className="p-4 space-y-1" data-testid="stat-total-revenue">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <DollarSign className="h-4 w-4" />
                Revenue Generated
              </div>
              <p className="text-2xl font-bold">${(plan.stats.totalRevenueCents / 100).toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">Coach earnings: ${((plan.stats.coachEarningsCents || 0) / 100).toFixed(0)}</p>
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

          {(plan.stats.subscriptionRevenueCents || 0) > 0 && (
            <Card className="p-4 border-amber-500/30 bg-amber-500/5" data-testid="stat-subscription-revenue">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-amber-500 text-xs font-medium">
                    <RefreshCw className="h-4 w-4" />
                    Subscription Revenue
                  </div>
                  <p className="text-2xl font-bold">${((plan.stats.subscriptionRevenueCents || 0) / 100).toFixed(0)}</p>
                </div>
                <p className="text-xs text-muted-foreground max-w-[200px] text-right">From Stripe subscription invoices</p>
              </div>
            </Card>
          )}

          {plan.subscriptionsEnabled && plan.subscriberUsage && plan.subscriberUsage.length > 0 && (
            <Card className="p-5 space-y-4 border-amber-500/20" data-testid="card-subscriber-usage">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-amber-500" />
                <h2 className="font-semibold">Subscriber Session Usage</h2>
                <Badge variant="secondary" className="text-xs">{plan.subscriberUsage.length} subscriber{plan.subscriberUsage.length !== 1 ? "s" : ""}</Badge>
              </div>
              <div className="space-y-2">
                {plan.subscriberUsage.map((sub) => {
                  const sessionsUsed = sub.sessionsRemaining !== null ? sub.totalAllocated - sub.sessionsRemaining : null;
                  const usagePercent = sub.sessionsRemaining !== null && sub.totalAllocated > 0
                    ? Math.round(((sub.totalAllocated - sub.sessionsRemaining) / sub.totalAllocated) * 100)
                    : null;
                  return (
                    <div key={sub.userId} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`row-subscriber-${sub.userId}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{sub.firstName} {sub.lastName}</span>
                          <Badge variant="secondary" className="text-xs">{sub.planName}</Badge>
                          <Badge variant={sub.status === "active" ? "default" : "destructive"} className="text-xs capitalize">{sub.status}</Badge>
                        </div>
                        {sub.email && <p className="text-xs text-muted-foreground mt-0.5">{sub.email}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {sub.sessionsPerWeek}x/week
                          {sub.currentPeriodEnd && (
                            <> · Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {sessionsUsed !== null ? (
                          <>
                            <p className="text-sm font-semibold">
                              <span className={usagePercent !== null && usagePercent >= 100 ? "text-destructive" : usagePercent !== null && usagePercent >= 75 ? "text-amber-500" : ""}>{sessionsUsed}</span>
                              <span className="text-muted-foreground font-normal"> / {sub.totalAllocated}</span>
                            </p>
                            <div className="w-24 h-1.5 bg-muted rounded-full mt-1">
                              <div
                                className={`h-full rounded-full transition-all ${usagePercent !== null && usagePercent >= 100 ? "bg-destructive" : usagePercent !== null && usagePercent >= 75 ? "bg-amber-500" : "bg-primary"}`}
                                style={{ width: `${Math.min(usagePercent || 0, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{sub.sessionsRemaining} remaining</p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not yet allocated</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {plan.subscriptionsEnabled && (!plan.subscriberUsage || plan.subscriberUsage.length === 0) && (plan.stats.subscriptionRevenueCents || 0) > 0 && (
            <Card className="p-4 border-amber-500/20" data-testid="card-subscriber-usage-empty">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-4 w-4 text-amber-500" />
                <p className="text-sm">No active subscribers with session allocations</p>
              </div>
            </Card>
          )}

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
                  const isSelected = selectedClient?.id === client.id;

                  return (
                    <div key={client.id}>
                      <div
                        className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-colors ${isSelected ? "bg-primary/10 border-primary/40" : "bg-card hover:bg-muted/50"}`}
                        onClick={() => setSelectedClient(isSelected ? null : client)}
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
                          {revenueView === "source" && client.clientStats ? (
                            <div className="flex items-center gap-3 text-xs mt-0.5 flex-wrap">
                              <span className="text-muted-foreground">
                                {client.clientStats.totalSessions} session{client.clientStats.totalSessions !== 1 ? "s" : ""}
                                {client.clientStats.scheduledCount > 0 && ` (${client.clientStats.scheduledCount} upcoming)`}
                              </span>
                              <span className="text-blue-400">Revenue: ${(client.clientStats.revenueCents / 100).toFixed(0)}</span>
                              <span className={client.clientStats.walletBalanceCents >= 0 ? "text-green-400" : "text-red-400"}>
                                Wallet: ${(client.clientStats.walletBalanceCents / 100).toFixed(2)}
                              </span>
                            </div>
                          ) : (
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
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right hidden sm:block">
                            {revenueView === "source" && client.clientStats ? (
                              <>
                                <p className="text-sm font-medium">${(client.clientStats.revenueCents / 100).toFixed(0)}</p>
                                <p className="text-xs text-muted-foreground">revenue</p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-medium">~{consistency.score.toFixed(1)}/wk</p>
                                <p className="text-xs text-muted-foreground">avg sessions</p>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={(e) => { e.stopPropagation(); openEditDialog(client); }}
                              data-testid={`btn-edit-client-${client.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); setDeleteClient(client); }}
                              data-testid={`btn-delete-client-${client.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-2 ml-14 p-3 rounded-lg border bg-muted/30 space-y-3" data-testid={`client-detail-${client.id}`}>
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">{client.firstName} {client.lastName} — Session History</h3>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedClient(null)} data-testid="btn-close-detail">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {client.email && (
                            <p className="text-xs text-muted-foreground">{client.email}</p>
                          )}
                          {client.sessions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No sessions recorded.</p>
                          ) : (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                              {[...client.sessions].reverse().map((s, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs p-2 rounded bg-card border">
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">{new Date(s.date).toLocaleDateString()}</span>
                                    <span className="font-medium">{s.serviceName}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={`text-[10px] ${s.status === "COMPLETED" ? "text-green-500" : s.status === "CANCELLED" ? "text-red-400" : s.status === "NO_SHOW" ? "text-orange-400" : "text-blue-400"}`}>
                                      {s.status}
                                    </Badge>
                                    <span className="text-muted-foreground">${(s.priceCents / 100).toFixed(0)}</span>
                                    {s.paymentMethod && (
                                      <Badge variant="secondary" className="text-[10px]">{s.paymentMethod}</Badge>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openEditDialog(client)} data-testid={`btn-edit-detail-${client.id}`}>
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => setDeleteClient(client)} data-testid={`btn-delete-detail-${client.id}`}>
                              <Trash2 className="h-3 w-3 mr-1" /> Remove
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      <Dialog open={!!editClient} onOpenChange={(open) => !open && setEditClient(null)}>
        <DialogContent data-testid="dialog-edit-client">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-first-name">First Name</Label>
              <Input id="edit-first-name" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} data-testid="input-edit-first-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-last-name">Last Name</Label>
              <Input id="edit-last-name" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} data-testid="input-edit-last-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} data-testid="input-edit-email" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClient(null)} data-testid="btn-cancel-edit">Cancel</Button>
            <Button
              onClick={() => editClient && updateUserMutation.mutate({ id: editClient.id, data: { firstName: editFirstName, lastName: editLastName, email: editEmail.trim() || null } })}
              disabled={updateUserMutation.isPending || !editFirstName.trim()}
              data-testid="btn-save-edit"
            >
              {updateUserMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteClient} onOpenChange={(open) => !open && setDeleteClient(null)}>
        <AlertDialogContent data-testid="dialog-delete-client">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {deleteClient?.firstName} {deleteClient?.lastName} from this coach's client list? Their sessions with this coach will be deleted, but they will remain on the platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteClient && removeClientMutation.mutate(deleteClient.id)}
              disabled={removeClientMutation.isPending}
              data-testid="btn-confirm-delete"
            >
              {removeClientMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
