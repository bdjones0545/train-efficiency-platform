import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell, PieChart, Pie
} from "recharts";
import {
  Users, QrCode, Trophy, TrendingUp, BarChart2, Calendar, Star, CheckCircle2,
  Search, ExternalLink, ChevronRight, Activity
} from "lucide-react";

const COLORS = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#059669"];

export default function AdminAttendanceTrackerPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const orgId = (user as any)?.organizationId || "";
  const [view, setView] = useState("all");
  const [selectedProgram, setSelectedProgram] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<string | null>(null);

  const { data: programs = [] } = useQuery<any[]>({
    queryKey: ["/api/attendance/programs", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/attendance/programs?orgId=${orgId}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!orgId,
  });

  const programIdFilter = selectedProgram !== "all" ? selectedProgram : "";

  const { data: analyticsData } = useQuery<any>({
    queryKey: ["/api/attendance/analytics", orgId, programIdFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId });
      if (programIdFilter) params.set("programId", programIdFilter);
      const r = await fetch(`/api/attendance/analytics?${params}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: dashData } = useQuery<any>({
    queryKey: ["/api/attendance/dashboard", orgId, programIdFilter, view],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId, view });
      if (programIdFilter) params.set("programId", programIdFilter);
      const r = await fetch(`/api/attendance/dashboard?${params}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: athleteHistory } = useQuery<any>({
    queryKey: ["/api/attendance/athlete-history", orgId, selectedAthlete],
    queryFn: async () => {
      if (!selectedAthlete) return null;
      const params = new URLSearchParams({ orgId, email: selectedAthlete });
      const r = await fetch(`/api/attendance/athlete-history?${params}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!orgId && !!selectedAthlete,
  });

  const analytics = analyticsData || {};
  const athletes: any[] = dashData?.athletes || [];
  const filteredAthletes = athletes.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase()) ||
    (a.sport && a.sport.toLowerCase().includes(search.toLowerCase()))
  );

  const statCards = [
    { label: "Total Check-Ins", value: analytics.totalCheckIns ?? 0, icon: <CheckCircle2 className="h-4 w-4" />, color: "text-green-500" },
    { label: "Unique Athletes", value: analytics.uniqueAthletes ?? 0, icon: <Users className="h-4 w-4" />, color: "text-blue-500" },
    { label: "Returning Athletes", value: analytics.returningAthletes ?? 0, icon: <Star className="h-4 w-4" />, color: "text-orange-500" },
    { label: "Avg Visits", value: analytics.avgVisitsPerAthlete ?? 0, icon: <Activity className="h-4 w-4" />, color: "text-purple-500" },
    { label: "Reward Rate", value: `${analytics.rewardRedemptionRate ?? 0}%`, icon: <Trophy className="h-4 w-4" />, color: "text-yellow-500" },
    { label: "Growth", value: `${analytics.attendanceGrowthPct ?? 0}%`, icon: <TrendingUp className="h-4 w-4" />, color: "text-cyan-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <QrCode className="h-5 w-5 text-green-500" /> Attendance Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">QR-based check-in, rewards, and athlete retention</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {programs.map(p => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              onClick={() => navigate(`/attendance-programs/${p.id}`)}
              className="text-xs gap-1.5"
              data-testid={`button-configure-${p.id}`}
            >
              <ExternalLink className="h-3 w-3" /> {p.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(card => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className={`${card.color} mb-2`}>{card.icon}</div>
              <p className="text-xl font-bold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="athletes" data-testid="tabs-attendance">
        <TabsList>
          <TabsTrigger value="athletes" data-testid="tab-athletes"><Users className="h-3.5 w-3.5 mr-1.5" />Athletes</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics"><BarChart2 className="h-3.5 w-3.5 mr-1.5" />Analytics</TabsTrigger>
        </TabsList>

        {/* Athletes Tab */}
        <TabsContent value="athletes" className="space-y-4 pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-9 h-8 text-sm"
                placeholder="Search athletes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-athletes"
              />
            </div>
            <Select value={selectedProgram} onValueChange={setSelectedProgram} data-testid="select-program-filter">
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="All Programs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Programs</SelectItem>
                {programs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={view} onValueChange={setView} data-testid="select-view-filter">
              <SelectTrigger className="w-28 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="day">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Athletes List */}
            <div className="space-y-2">
              {filteredAthletes.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No athletes checked in yet</p>
                  </CardContent>
                </Card>
              ) : (
                filteredAthletes.map((athlete) => (
                  <button
                    key={athlete.email}
                    className={`w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors ${selectedAthlete === athlete.email ? "border-green-500/50 bg-green-500/5" : ""}`}
                    onClick={() => setSelectedAthlete(athlete.email === selectedAthlete ? null : athlete.email)}
                    data-testid={`button-athlete-${athlete.email}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{athlete.name}</p>
                          {athlete.sport && <Badge variant="secondary" className="text-[10px]">{athlete.sport}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{athlete.email}</p>
                        {athlete.school && <p className="text-xs text-muted-foreground">{athlete.school}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-green-500">{athlete.totalVisits}</p>
                        <p className="text-xs text-muted-foreground">visits</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      {athlete.nextRewardName && (
                        <span className="flex items-center gap-1">
                          <Trophy className="h-3 w-3 text-yellow-500" /> {athlete.rewardProgress} → {athlete.nextRewardName}
                        </span>
                      )}
                      {athlete.rewardsEarned?.length > 0 && (
                        <span className="text-green-500 font-medium">{athlete.rewardsEarned.length} earned</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Athlete Detail Panel */}
            <div>
              {selectedAthlete && athleteHistory ? (
                <Card className="sticky top-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {athletes.find(a => a.email === selectedAthlete)?.name || selectedAthlete}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{selectedAthlete}</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-muted/50 p-3 text-center">
                        <p className="text-2xl font-bold text-green-500">{athleteHistory.totalVisits}</p>
                        <p className="text-xs text-muted-foreground">Total Visits</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-3 text-center">
                        <p className="text-2xl font-bold text-yellow-500">{athleteHistory.rewardsEarned?.length || 0}</p>
                        <p className="text-xs text-muted-foreground">Rewards Earned</p>
                      </div>
                    </div>

                    {athleteHistory.rewardsEarned?.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Rewards Earned</p>
                        <div className="space-y-1.5">
                          {athleteHistory.rewardsEarned.map((r: any) => (
                            <div key={r.id} className="flex items-center gap-2 text-xs">
                              <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                              <span className="font-medium">{r.reward_name}</span>
                              <span className="text-muted-foreground ml-auto">{r.visit_count} visits</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Visit History</p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {athleteHistory.records?.slice(0, 20).map((r: any) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                            <span className="font-medium">{r.program_name}</span>
                            <Badge variant="secondary" className="text-[10px]">Visit #{r.visit_number}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="p-8 text-center">
                    <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Select an athlete to view their profile</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6 pt-4">
          {(analytics.overTime?.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-green-500" /> Attendance Over Time (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={analytics.overTime}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="checkins" stroke="#16a34a" fill="#16a34a22" name="Check-ins" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analytics.topSports?.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Top Sports</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={analytics.topSports} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="sport" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip />
                      <Bar dataKey="count" name="Athletes" radius={[0, 4, 4, 0]}>
                        {analytics.topSports.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {analytics.topPrograms?.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Top Programs</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={analytics.topPrograms} cx="50%" cy="50%" outerRadius={70} dataKey="checkins" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {analytics.topPrograms.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {(!analytics.totalCheckIns || analytics.totalCheckIns === 0) && (
            <Card>
              <CardContent className="p-12 text-center">
                <BarChart2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="font-medium">No attendance data yet</p>
                <p className="text-sm text-muted-foreground mt-1">Athletes will appear here after their first check-in.</p>
                {programs.length > 0 && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">Share your check-in link:</p>
                    {programs.map(p => (
                      <Button key={p.id} size="sm" variant="outline" onClick={() => navigate(`/attendance-programs/${p.id}`)}>
                        <QrCode className="h-3.5 w-3.5 mr-1.5" /> Configure {p.name}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
