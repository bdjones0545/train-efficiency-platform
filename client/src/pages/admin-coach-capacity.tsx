import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import {
  Clock, Users, DollarSign, TrendingUp, Calendar,
  BarChart3, Activity, ChevronUp, ChevronDown, Minus
} from "lucide-react";

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

function UtilizationBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  const label = pct >= 80 ? "High" : pct >= 50 ? "Moderate" : "Low";
  const labelColor = pct >= 80 ? "text-green-600 dark:text-green-400" : pct >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
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

function UtilizationTrend({ pct }: { pct: number }) {
  if (pct >= 80) return <ChevronUp className="h-4 w-4 text-green-500" />;
  if (pct >= 50) return <Minus className="h-4 w-4 text-yellow-500" />;
  return <ChevronDown className="h-4 w-4 text-red-500" />;
}

function CoachCard({ coach }: { coach: CoachCapacity }) {
  const name = `${coach.firstName || ""} ${coach.lastName || ""}`.trim() || "Coach";
  const initials = `${(coach.firstName || "")[0] || ""}${(coach.lastName || "")[0] || ""}`.toUpperCase();

  return (
    <Card className="p-5 space-y-4" data-testid={`card-coach-capacity-${coach.coachId}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11">
            <AvatarImage src={coach.photoUrl || undefined} />
            <AvatarFallback className="text-sm bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-sm">{name}</p>
            <p className="text-xs text-muted-foreground">{coach.sessionCount} session{coach.sessionCount !== 1 ? "s" : ""} scheduled</p>
          </div>
        </div>
        <UtilizationTrend pct={coach.utilizationPct} />
      </div>

      <UtilizationBar pct={coach.utilizationPct} />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Booked Hours</p>
          <p className="font-semibold">{coach.bookedHours}h <span className="text-xs text-muted-foreground font-normal">/ {coach.availableHours}h avail.</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Revenue</p>
          <p className="font-semibold">${(coach.revenueCents / 100).toFixed(0)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Registered</p>
          <p className="font-semibold">{coach.totalRegistered} <span className="text-xs text-muted-foreground font-normal">/ {coach.totalCapacity} cap.</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />Open Spots</p>
          <p className={`font-semibold ${coach.openSpots > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
            {coach.openSpots}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function AdminCoachCapacityPage() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [sortBy, setSortBy] = useState<"utilization" | "revenue" | "hours" | "name">("utilization");

  const { data, isLoading } = useQuery<CapacityResponse>({
    queryKey: ["/api/scheduling/coach-capacity", period],
    queryFn: async () => {
      const res = await fetch(`/api/scheduling/coach-capacity?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const coaches = data?.coaches || [];

  const sorted = [...coaches].sort((a, b) => {
    if (sortBy === "utilization") return b.utilizationPct - a.utilizationPct;
    if (sortBy === "revenue") return b.revenueCents - a.revenueCents;
    if (sortBy === "hours") return b.bookedHours - a.bookedHours;
    if (sortBy === "name") return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    return 0;
  });

  const totalRevenue = coaches.reduce((s, c) => s + c.revenueCents, 0);
  const totalHours = coaches.reduce((s, c) => s + c.bookedHours, 0);
  const totalSessions = coaches.reduce((s, c) => s + c.sessionCount, 0);
  const totalOpenSpots = coaches.reduce((s, c) => s + c.openSpots, 0);
  const avgUtilization = coaches.length > 0 ? Math.round(coaches.reduce((s, c) => s + c.utilizationPct, 0) / coaches.length) : 0;

  const highUtil = coaches.filter(c => c.utilizationPct >= 80).length;
  const midUtil = coaches.filter(c => c.utilizationPct >= 50 && c.utilizationPct < 80).length;
  const lowUtil = coaches.filter(c => c.utilizationPct < 50).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold">Coach Capacity Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Session load, hours, and revenue by coach</p>
        </div>
        <div className="flex items-center gap-2">
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
            <SelectTrigger className="w-[130px] h-9" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utilization">By Utilization</SelectItem>
              <SelectItem value="revenue">By Revenue</SelectItem>
              <SelectItem value="hours">By Hours</SelectItem>
              <SelectItem value="name">By Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `$${(totalRevenue / 100).toFixed(0)}`, icon: DollarSign, sub: period === "week" ? "this week" : "this month" },
          { label: "Booked Hours", value: `${totalHours.toFixed(1)}h`, icon: Clock, sub: `across ${coaches.length} coaches` },
          { label: "Sessions", value: String(totalSessions), icon: Calendar, sub: period === "week" ? "this week" : "this month" },
          { label: "Open Spots", value: String(totalOpenSpots), icon: Users, sub: "unfilled capacity" },
        ].map(stat => (
          <Card key={stat.label} className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="h-4 w-4" />
              <span className="text-xs font-medium">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      {/* Utilization Distribution */}
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-muted-foreground" />Utilization Distribution</p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-sm">High (80%+): <strong>{highUtil}</strong> coach{highUtil !== 1 ? "es" : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="text-sm">Moderate (50-79%): <strong>{midUtil}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm">Low (&lt;50%): <strong>{lowUtil}</strong></span>
          </div>
          <div className="ml-auto">
            <Badge variant="outline" className="text-xs">Avg: {avgUtilization}%</Badge>
          </div>
        </div>
        <div className="mt-3 flex gap-0.5 rounded-full overflow-hidden h-3">
          {coaches.length > 0 ? (
            sorted.map(c => {
              const color = c.utilizationPct >= 80 ? "bg-green-500" : c.utilizationPct >= 50 ? "bg-yellow-500" : "bg-red-500";
              return <div key={c.coachId} className={color} style={{ flex: 1 }} title={`${c.firstName}: ${c.utilizationPct}%`} />;
            })
          ) : (
            <div className="bg-muted w-full rounded-full" />
          )}
        </div>
      </Card>

      {/* Coach Cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No coach data available for this period</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(coach => <CoachCard key={coach.coachId} coach={coach} />)}
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground text-right">
          Period: {new Date(data.startDate).toLocaleDateString()} – {new Date(data.endDate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
