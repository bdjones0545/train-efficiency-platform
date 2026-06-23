import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell, PieChart, Pie
} from "recharts";
import {
  Users, QrCode, Trophy, TrendingUp, BarChart2, Calendar, Star, CheckCircle2,
  Search, ExternalLink, ChevronRight, Activity, Settings, Copy, Check, Loader2,
  CalendarDays, CalendarCheck, Mail, Bell
} from "lucide-react";
import QRCode from "react-qr-code";

const COLORS = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#059669"];

export default function AdminAttendanceTrackerPage() {
  const [, navigate] = useLocation();

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId || "";

  // Debug: log orgId and programs count to help verify data source
  console.log("[AttendanceDashboard] orgId:", orgId);
  const [view, setView] = useState("all");
  const [selectedProgram, setSelectedProgram] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ name: string; slug: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: programs = [], isLoading: programsLoading } = useQuery<any[]>({
    queryKey: ["/api/attendance/programs", orgId],
    queryFn: async () => {
      const data = await authenticatedFetch<any[]>(`/api/attendance/programs?orgId=${orgId}`).catch(() => []);
      console.log("[AttendanceDashboard] programs count:", data.length, "ids:", data.map((p: any) => p.id));
      return data;
    },
    enabled: !!orgId,
  });

  const profileLoading = !profile;

  const programIdFilter = selectedProgram !== "all" ? selectedProgram : "";

  const { data: analyticsData } = useQuery<any>({
    queryKey: ["/api/attendance/analytics", orgId, programIdFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId });
      if (programIdFilter) params.set("programId", programIdFilter);
      return authenticatedFetch(`/api/attendance/analytics?${params}`).catch(() => null);
    },
    enabled: !!orgId,
  });

  const { data: dashData } = useQuery<any>({
    queryKey: ["/api/attendance/dashboard", orgId, programIdFilter, view],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId, view });
      if (programIdFilter) params.set("programId", programIdFilter);
      return authenticatedFetch(`/api/attendance/dashboard?${params}`).catch(() => null);
    },
    enabled: !!orgId,
  });

  const { data: athleteHistory } = useQuery<any>({
    queryKey: ["/api/attendance/athlete-history", orgId, selectedAthlete],
    queryFn: async () => {
      if (!selectedAthlete) return null;
      const params = new URLSearchParams({ orgId, email: selectedAthlete });
      return authenticatedFetch(`/api/attendance/athlete-history?${params}`).catch(() => null);
    },
    enabled: !!orgId && !!selectedAthlete,
  });

  // Coach Reports: recipients for first program
  const firstProgramId = programs[0]?.id;
  const { data: reportRecipientsData } = useQuery<any>({
    queryKey: ["/api/attendance-programs", firstProgramId, "report-recipients"],
    queryFn: async () => {
      return authenticatedFetch(`/api/attendance-programs/${firstProgramId}/report-recipients`).catch(() => ({ recipients: [] }));
    },
    enabled: !!firstProgramId,
  });
  const reportRecipients: any[] = reportRecipientsData?.recipients || [];
  const activeRecipients = reportRecipients.filter(r => r.active);
  const dailyEnabled = activeRecipients.some((r: any) => r.receive_daily);
  const weeklyEnabled = activeRecipients.some((r: any) => r.receive_weekly);

  const analytics = analyticsData || {};
  const athletes: any[] = dashData?.athletes || [];
  const filteredAthletes = athletes.filter(a =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase()) ||
    (a.sport && a.sport.toLowerCase().includes(search.toLowerCase()))
  );

  const hasNoData = !analytics.totalCheckIns || analytics.totalCheckIns === 0;

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Navigate to configure: single program goes straight, multiple opens picker
  const handleConfigure = () => {
    if (programs.length === 1) {
      navigate(`/attendance-programs/${programs[0].id}`);
    } else if (programs.length > 1) {
      // just go to first for now; could open a selector modal
      navigate(`/attendance-programs/${programs[0].id}`);
    }
  };

  const statCards = [
    { label: "Total Check-Ins", value: analytics.totalCheckIns ?? 0, icon: <CheckCircle2 className="h-4 w-4" />, color: "text-green-500" },
    { label: "Today", value: analytics.todayCheckIns ?? 0, icon: <CalendarCheck className="h-4 w-4" />, color: "text-emerald-500" },
    { label: "This Week", value: analytics.weekCheckIns ?? 0, icon: <CalendarDays className="h-4 w-4" />, color: "text-blue-500" },
    { label: "This Month", value: analytics.monthCheckIns ?? 0, icon: <Calendar className="h-4 w-4" />, color: "text-indigo-500" },
    { label: "Unique Athletes", value: analytics.uniqueAthletes ?? 0, icon: <Users className="h-4 w-4" />, color: "text-purple-500" },
    { label: "Rewards Earned", value: analytics.rewardsEarned ?? 0, icon: <Trophy className="h-4 w-4" />, color: "text-yellow-500" },
  ];

  // ── Loading ───────────────────────────────────────────────────────────────
  // Wait for profile AND programs query to finish — profileLoading prevents
  // false empty-state while /api/profile is still in-flight (orgId = "")
  if (profileLoading || programsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Empty state: no programs at all ──────────────────────────────────────
  if (programs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <QrCode className="h-5 w-5 text-green-500" /> Attendance Tracker
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">QR-based check-in, rewards, and athlete retention</p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <QrCode className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="font-semibold text-lg mb-2">No Attendance Tracker Set Up Yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Create an Attendance Tracker program to generate a QR code athletes can scan to check in.
            </p>
            <Button onClick={() => navigate("/admin/configuration")} data-testid="button-go-create-tracker">
              <Settings className="h-4 w-4 mr-2" /> Create Attendance Tracker
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <QrCode className="h-5 w-5 text-green-500" /> Attendance Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">QR-based check-in, rewards, and athlete retention</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* QR code button(s) */}
          {programs.map(p => p.public_slug && (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 text-green-600 border-green-500/30 hover:border-green-500/60"
              onClick={() => setQrModal({ name: p.name, slug: p.public_slug, url: `${window.location.origin}/attendance/${p.public_slug}` })}
              data-testid={`button-qr-${p.id}`}
            >
              <QrCode className="h-3.5 w-3.5" /> QR Code
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={handleConfigure}
            data-testid="button-configure-tracker"
          >
            <Settings className="h-3.5 w-3.5" /> Configure Tracker
          </Button>
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

      {/* Coach Reports Card */}
      {firstProgramId && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-green-500/10 rounded-lg shrink-0">
                  <Mail className="h-4 w-4 text-green-500" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">Coach Reports</p>
                    {activeRecipients.length > 0 ? (
                      <>
                        <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                          <Bell className="h-2.5 w-2.5 mr-1" />{activeRecipients.length} recipient{activeRecipients.length !== 1 ? "s" : ""}
                        </Badge>
                        {dailyEnabled && <Badge variant="outline" className="text-[10px]">Daily</Badge>}
                        {weeklyEnabled && <Badge variant="outline" className="text-[10px]">Weekly</Badge>}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Not configured</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {activeRecipients.length > 0
                      ? `Automated summaries sent Mon–Fri 5 PM ET${weeklyEnabled ? " + Fridays weekly" : ""}`
                      : "Add coaches to receive automated attendance summaries by email"}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 shrink-0 border-green-500/30 text-green-600 hover:bg-green-500/10"
                onClick={() => firstProgramId && navigate(`/attendance-programs/${firstProgramId}?tab=reports`)}
                data-testid="button-configure-reports"
              >
                <Settings className="h-3.5 w-3.5" /> Configure
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state: programs exist but no check-ins yet */}
      {hasNoData ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <QrCode className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <h2 className="font-semibold mb-1">No attendance records yet</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Share your QR code to start collecting check-ins.
            </p>
            <div className="flex flex-col items-center gap-3">
              {programs.map(p => (
                <div key={p.id} className="flex items-center gap-2 flex-wrap justify-center">
                  {p.public_slug && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-green-600 border-green-500/30"
                        onClick={() => setQrModal({ name: p.name, slug: p.public_slug, url: `${window.location.origin}/attendance/${p.public_slug}` })}
                        data-testid={`button-empty-qr-${p.id}`}
                      >
                        <QrCode className="h-3.5 w-3.5" /> Show QR Code
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground"
                        onClick={() => copyUrl(`${window.location.origin}/attendance/${p.public_slug}`)}
                        data-testid={`button-empty-copy-${p.id}`}
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        Copy Link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground"
                        onClick={() => window.open(`/attendance/${p.public_slug}`, "_blank")}
                        data-testid={`button-empty-preview-${p.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Preview
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-xs"
                    onClick={() => navigate(`/attendance-programs/${p.id}`)}
                    data-testid={`button-empty-configure-${p.id}`}
                  >
                    <Settings className="h-3.5 w-3.5" /> Configure Tracker
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
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
                <SelectTrigger className="w-32 h-8 text-sm">
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Athletes List */}
              <div className="space-y-2">
                {filteredAthletes.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No athletes match this filter</p>
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
                            {athlete.school && <Badge variant="outline" className="text-[10px]">{athlete.school}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{athlete.email}</p>
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
                          <span className="text-green-500 font-medium">{athlete.rewardsEarned.length} reward{athlete.rewardsEarned.length === 1 ? "" : "s"} earned</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Athlete Detail Panel */}
              <div>
                {selectedAthlete && athleteHistory ? (
                  <Card className="sticky top-4">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm">
                            {athletes.find(a => a.email === selectedAthlete)?.name || selectedAthlete}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">{selectedAthlete}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            const a = athletes.find(x => x.email === selectedAthlete);
                            if (a?.sport) {}
                          }}
                        >
                          {athletes.find(a => a.email === selectedAthlete)?.sport && (
                            <Badge variant="secondary" className="text-[10px]">
                              {athletes.find(a => a.email === selectedAthlete)?.sport}
                            </Badge>
                          )}
                        </Button>
                      </div>
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
                        <div className="space-y-1.5 max-h-52 overflow-y-auto">
                          {athleteHistory.records?.slice(0, 30).map((r: any) => (
                            <div key={r.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                              <span className="font-medium truncate max-w-24">{r.program_name}</span>
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
            {analytics.overTime?.length > 0 && (
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
                        <Pie
                          data={analytics.topPrograms}
                          cx="50%" cy="50%" outerRadius={70}
                          dataKey="checkins" nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Returning Athletes</p>
                  <p className="text-2xl font-bold text-orange-500">{analytics.returningAthletes ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Avg Visits / Athlete</p>
                  <p className="text-2xl font-bold text-purple-500">{analytics.avgVisitsPerAthlete ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Month-over-Month Growth</p>
                  <p className={`text-2xl font-bold ${(analytics.attendanceGrowthPct ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {(analytics.attendanceGrowthPct ?? 0) >= 0 ? "+" : ""}{analytics.attendanceGrowthPct ?? 0}%
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* QR Code Modal */}
      <Dialog open={!!qrModal} onOpenChange={() => setQrModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-green-500" /> {qrModal?.name}
            </DialogTitle>
          </DialogHeader>
          {qrModal && (
            <div className="space-y-4">
              <div className="flex items-center justify-center p-4 bg-white rounded-xl">
                <QRCode value={qrModal.url} size={200} />
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Check-In URL</p>
                <p className="text-sm font-mono text-green-600 break-all">{qrModal.url}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => copyUrl(qrModal.url)}
                  data-testid="button-qr-copy"
                >
                  {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => window.open(qrModal.url, "_blank")}
                  data-testid="button-qr-preview"
                >
                  <ExternalLink className="h-4 w-4 mr-2" /> Preview
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
