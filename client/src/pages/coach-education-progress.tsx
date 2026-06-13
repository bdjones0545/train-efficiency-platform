import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Users, Trophy, AlertTriangle, CheckCircle, Circle,
  BarChart2, GraduationCap, ChevronRight, Star, Clock, Loader2,
  Zap, ShieldAlert, Medal, ThumbsUp, ThumbsDown, RefreshCw,
  CalendarDays, TrendingDown, Award,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

const CATEGORY_COLORS: Record<string, string> = {
  nutrition: "emerald", recovery: "blue", hydration: "cyan", sleep: "violet",
  mindset: "amber", team_standards: "rose", injury_prevention: "orange", recruiting: "pink", custom: "slate",
};

const COLOR_MAP: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  orange: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  pink: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  slate: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

function categoryBadge(category: string) {
  const color = CATEGORY_COLORS[category] ?? "slate";
  const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return <Badge className={`text-xs border ${COLOR_MAP[color] ?? COLOR_MAP.slate}`}>{label}</Badge>;
}

function statusBadge(status: string) {
  if (status === "published") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs border">Published</Badge>;
  if (status === "archived") return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-xs border">Archived</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs border">Draft</Badge>;
}

function completionColor(pct: number) {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 40) return "text-amber-400";
  return "text-red-400";
}

function badgeColor(color: string) {
  return COLOR_MAP[color] ?? COLOR_MAP.slate;
}

function ComplianceRing({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div className="relative h-20 w-20 flex items-center justify-center">
      <svg className="absolute inset-0" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/20" />
        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6"
          strokeDasharray={`${2 * Math.PI * 34}`}
          strokeDashoffset={`${2 * Math.PI * 34 * (1 - score / 100)}`}
          strokeLinecap="round" className={color}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
      </svg>
      <div className="text-center">
        <p className={`text-lg font-bold leading-none ${color}`}>{score}%</p>
        <p className="text-[9px] text-muted-foreground mt-0.5">compliance</p>
      </div>
    </div>
  );
}

function PathwayCard({ stat, selected, onClick }: { stat: any; selected: boolean; onClick: () => void }) {
  const { pathway, moduleCount, totalAthletes, pathwayCompleted, inProgress, avgScore, completionRate } = stat;
  return (
    <button type="button" onClick={onClick} data-testid={`card-pathway-${pathway.id}`}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-150 ${
        selected ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
      }`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate" data-testid={`text-pathway-title-${pathway.id}`}>{pathway.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {categoryBadge(pathway.category)}
            {statusBadge(pathway.status)}
          </div>
        </div>
        <ChevronRight className={`h-4 w-4 flex-shrink-0 mt-0.5 transition-transform ${selected ? "rotate-90 text-primary" : "text-muted-foreground/40"}`} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Completion</span>
          <span className={`font-bold ${completionColor(completionRate)}`} data-testid={`text-completion-rate-${pathway.id}`}>{completionRate}%</span>
        </div>
        <Progress value={completionRate} className="h-1.5" />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="text-center">
          <p className="text-sm font-bold" data-testid={`text-completed-${pathway.id}`}>{pathwayCompleted}</p>
          <p className="text-[10px] text-muted-foreground">Completed</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-amber-400" data-testid={`text-in-progress-${pathway.id}`}>{inProgress}</p>
          <p className="text-[10px] text-muted-foreground">In Progress</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-muted-foreground" data-testid={`text-not-started-${pathway.id}`}>
            {Math.max(0, totalAthletes - pathwayCompleted - inProgress)}
          </p>
          <p className="text-[10px] text-muted-foreground">Not Started</p>
        </div>
      </div>
      {avgScore !== null && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
          <Star className="h-3 w-3 text-amber-400 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">Avg Quiz Score:</span>
          <span className="text-xs font-semibold text-amber-400" data-testid={`text-avg-score-${pathway.id}`}>{avgScore}%</span>
        </div>
      )}
      <div className="flex items-center gap-1 mt-1">
        <BookOpen className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground">{moduleCount} module{moduleCount !== 1 ? "s" : ""}</span>
      </div>
    </button>
  );
}

export default function CoachEducationProgressPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Phase 1 analytics (pathway stats)
  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/education/analytics", slug],
    queryFn: () => fetchJson("/api/org/education/analytics", { headers }),
  });

  // Phase 2 enhanced analytics
  const { data: v2Data, isLoading: loadingV2, refetch: refetchV2 } = useQuery<any>({
    queryKey: ["/api/org/education/analytics/v2", slug],
    queryFn: () => fetchJson("/api/org/education/analytics/v2", { headers }),
  });

  // AI Recommendations
  const { data: recsData, isLoading: loadingRecs } = useQuery<any>({
    queryKey: ["/api/org/education/ai-recommendations", slug],
    queryFn: () => fetchJson("/api/org/education/ai-recommendations", { headers }),
    enabled: activeTab === "recommendations",
  });

  const generateRecsMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/education/ai-recommendations/generate", {},  headers),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/ai-recommendations", slug] });
      refetchV2();
      toast({ title: `Generated ${data?.generated ?? 0} AI recommendation(s)` });
    },
    onError: () => toast({ title: "Error generating recommendations", variant: "destructive" }),
  });

  const approveRecMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/education/ai-recommendations/${id}/approve`, {},  headers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/ai-recommendations", slug] });
      refetchV2();
      toast({ title: "Pathway assigned to athlete" });
    },
    onError: () => toast({ title: "Error approving recommendation", variant: "destructive" }),
  });

  const rejectRecMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/education/ai-recommendations/${id}/reject`, {},  headers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/ai-recommendations", slug] });
      refetchV2();
    },
  });

  const pathwayStats: any[] = analyticsData?.pathwayStats ?? [];
  const totalAthletes: number = analyticsData?.totalAthletes ?? 0;
  const selectedStat = selectedPathwayId
    ? pathwayStats.find((s: any) => s.pathway.id === selectedPathwayId)
    : pathwayStats[0] ?? null;

  const overallCompleted = pathwayStats.reduce((s: number, x: any) => s + x.pathwayCompleted, 0);
  const overallInProgress = pathwayStats.reduce((s: number, x: any) => s + x.inProgress, 0);
  const publishedPathways = pathwayStats.filter((s: any) => s.pathway.status === "published");

  const complianceScore = v2Data?.complianceScore ?? 0;
  const athletesBehind: any[] = v2Data?.athletesBehind ?? [];
  const failedQuizzes: any[] = v2Data?.failedQuizzes ?? [];
  const overdueModules: any[] = v2Data?.overdueModules ?? [];
  const recentBadges: any[] = v2Data?.recentBadges ?? [];
  const pendingRecs: number = v2Data?.pendingRecommendations ?? 0;
  const totalBadges: number = v2Data?.totalBadgesEarned ?? 0;
  const recommendations: any[] = recsData?.recommendations ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-education-progress-title">Education Progress</h1>
            <p className="text-sm text-muted-foreground">Adaptive learning intelligence for your athletes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => setLocation(`/org/${slug}/coach/education-builder`)}
            data-testid="link-go-to-builder">
            <BookOpen className="h-4 w-4" />Builder
          </Button>
          <Button variant="outline" size="sm" className="gap-2 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            onClick={() => setLocation(`/org/${slug}/coach/education-rules`)}>
            <Zap className="h-4 w-4" />Rules
          </Button>
        </div>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 text-center" data-testid="card-stat-total-athletes">
          <Users className="h-4 w-4 text-blue-400 mx-auto mb-1" />
          <p className="text-2xl font-bold" data-testid="text-stat-total-athletes">{totalAthletes}</p>
          <p className="text-xs text-muted-foreground">Total Athletes</p>
        </Card>
        <Card className="p-4 text-center" data-testid="card-stat-pathways">
          <BookOpen className="h-4 w-4 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold" data-testid="text-stat-total-pathways">{publishedPathways.length}</p>
          <p className="text-xs text-muted-foreground">Active Pathways</p>
        </Card>
        <Card className="p-4 text-center border-emerald-500/20" data-testid="card-stat-completions">
          <Trophy className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-emerald-400" data-testid="text-stat-total-completed">{overallCompleted}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </Card>
        <Card className="p-4 text-center border-amber-500/20" data-testid="card-stat-in-progress">
          <AlertTriangle className="h-4 w-4 text-amber-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-amber-400" data-testid="text-stat-total-in-progress">{overallInProgress}</p>
          <p className="text-xs text-muted-foreground">In Progress</p>
        </Card>
      </div>

      {/* Compliance + Intelligence row */}
      {!loadingV2 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4 flex items-center gap-4">
            <ComplianceRing score={complianceScore} />
            <div>
              <p className="font-semibold text-sm">Education Compliance</p>
              <p className="text-xs text-muted-foreground mt-0.5">Athletes with ≥1 module completed</p>
              {complianceScore < 50 && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />Below target — review athletes behind
                </p>
              )}
            </div>
          </Card>
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <p className="text-sm font-semibold">Needs Attention</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-lg font-bold text-red-400">{athletesBehind.length}</p>
                <p className="text-[10px] text-muted-foreground">Athletes Behind</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-lg font-bold text-amber-400">{overdueModules.length}</p>
                <p className="text-[10px] text-muted-foreground">Overdue</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-400" />
              <p className="text-sm font-semibold">Achievements</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-lg font-bold text-amber-400">{totalBadges}</p>
                <p className="text-[10px] text-muted-foreground">Badges Earned</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <p className="text-lg font-bold text-violet-400">{pendingRecs}</p>
                <p className="text-[10px] text-muted-foreground">AI Suggestions</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 h-9">
          <TabsTrigger value="overview" className="text-xs">Pathways</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs">
            Alerts
            {(athletesBehind.length + failedQuizzes.length + overdueModules.length) > 0 && (
              <span className="ml-1.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
                {Math.min(9, athletesBehind.length + failedQuizzes.length + overdueModules.length)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="badges" className="text-xs">Badges</TabsTrigger>
          <TabsTrigger value="recommendations" className="text-xs">
            AI
            {pendingRecs > 0 && (
              <span className="ml-1.5 h-4 w-4 rounded-full bg-violet-500 text-[10px] text-white flex items-center justify-center">
                {Math.min(9, pendingRecs)}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4">
          {pathwayStats.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <GraduationCap className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">No education pathways yet</p>
              <Button size="sm" className="mt-2" onClick={() => setLocation(`/org/${slug}/coach/education-builder`)}>
                Open Education Builder
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5" />Pathways ({pathwayStats.length})
                </h2>
                {pathwayStats.map((stat: any) => (
                  <PathwayCard key={stat.pathway.id} stat={stat}
                    selected={selectedPathwayId === stat.pathway.id || (!selectedPathwayId && stat === pathwayStats[0])}
                    onClick={() => setSelectedPathwayId(selectedPathwayId === stat.pathway.id ? null : stat.pathway.id)} />
                ))}
              </div>
              <div className="lg:col-span-2 space-y-4">
                {selectedStat ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-base" data-testid="text-selected-pathway-title">{selectedStat.pathway.title}</h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {categoryBadge(selectedStat.pathway.category)}
                          {statusBadge(selectedStat.pathway.status)}
                        </div>
                        {selectedStat.pathway.description && (
                          <p className="text-sm text-muted-foreground mt-1">{selectedStat.pathway.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Card className="p-3 text-center border-emerald-500/20">
                        <p className="text-xl font-bold text-emerald-400" data-testid="text-detail-completed">{selectedStat.pathwayCompleted}</p>
                        <p className="text-[11px] text-muted-foreground">Completed</p>
                      </Card>
                      <Card className="p-3 text-center border-amber-500/20">
                        <p className="text-xl font-bold text-amber-400" data-testid="text-detail-in-progress">{selectedStat.inProgress}</p>
                        <p className="text-[11px] text-muted-foreground">In Progress</p>
                      </Card>
                      <Card className="p-3 text-center">
                        <p className="text-xl font-bold text-muted-foreground" data-testid="text-detail-not-started">
                          {Math.max(0, selectedStat.totalAthletes - selectedStat.pathwayCompleted - selectedStat.inProgress)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">Not Started</p>
                      </Card>
                      <Card className="p-3 text-center border-primary/20">
                        <p className="text-xl font-bold text-primary" data-testid="text-detail-completion-rate">{selectedStat.completionRate}%</p>
                        <p className="text-[11px] text-muted-foreground">Completion</p>
                      </Card>
                    </div>
                    {selectedStat.avgScore !== null && (
                      <Card className="p-3 flex items-center gap-3 border-amber-400/20 bg-amber-400/[0.03]">
                        <Star className="h-5 w-5 text-amber-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold">Average Quiz Score</p>
                          <p className="text-xs text-muted-foreground">Across all completed modules</p>
                        </div>
                        <p className="ml-auto text-2xl font-bold text-amber-400" data-testid="text-detail-avg-score">{selectedStat.avgScore}%</p>
                      </Card>
                    )}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5" />Module Breakdown
                      </h3>
                      <div className="space-y-2">
                        {(selectedStat.moduleStats ?? []).map((ms: any) => (
                          <div key={ms.module.id} data-testid={`row-module-${ms.module.id}`}
                            className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary">{ms.module.moduleNumber}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" data-testid={`text-module-title-${ms.module.id}`}>{ms.module.title}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">{ms.module.estimatedMinutes} min</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-sm font-semibold" data-testid={`text-module-completed-${ms.module.id}`}>{ms.completed}</p>
                                <p className="text-[10px] text-muted-foreground">done</p>
                              </div>
                              {ms.avgScore !== null && (
                                <div className="text-right">
                                  <p className="text-sm font-semibold text-amber-400">{ms.avgScore}%</p>
                                  <p className="text-[10px] text-muted-foreground">avg</p>
                                </div>
                              )}
                              {ms.completed > 0 ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <Circle className="h-4 w-4 text-muted-foreground/40" />}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <Card className="p-12 text-center">
                    <BarChart2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Select a pathway to see module details</p>
                  </Card>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── ALERTS TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-4 space-y-6">
          {/* Athletes behind */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
              Athletes Behind ({athletesBehind.length})
            </h2>
            {athletesBehind.length === 0 ? (
              <Card className="p-6 text-center">
                <CheckCircle className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">All athletes are on track!</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {athletesBehind.map((item: any, i: number) => (
                  <Card key={i} className="p-3 border-red-500/20" data-testid={`card-athlete-behind-${i}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.athlete.name}</p>
                        <p className="text-xs text-muted-foreground">Not started: <span className="text-red-400">{item.pathway.title}</span></p>
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0">
                        Assigned {new Date(item.assignedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Failed quizzes */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Failed Quizzes ({failedQuizzes.length})
            </h2>
            {failedQuizzes.length === 0 ? (
              <Card className="p-6 text-center">
                <CheckCircle className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No failed quizzes.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {failedQuizzes.slice(0, 10).map((item: any, i: number) => (
                  <Card key={i} className="p-3 border-amber-500/20" data-testid={`card-failed-quiz-${i}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.athlete?.name ?? "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.module?.title ?? "Module"} · {item.pathway?.title ?? "Pathway"}
                        </p>
                      </div>
                      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border text-xs flex-shrink-0">
                        {item.progress.quizScore}%
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Overdue modules */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-orange-400" />
              Overdue Assignments ({overdueModules.length})
            </h2>
            {overdueModules.length === 0 ? (
              <Card className="p-6 text-center">
                <CheckCircle className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No overdue assignments.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {overdueModules.slice(0, 10).map((item: any, i: number) => (
                  <Card key={i} className="p-3 border-orange-500/20" data-testid={`card-overdue-${i}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.athlete.name}</p>
                        <p className="text-xs text-muted-foreground">{item.pathway.title}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-medium text-orange-400">{item.completed}/{item.total} modules</p>
                        <p className="text-[10px] text-muted-foreground">
                          Since {new Date(item.assignedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── BADGES TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="badges" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Medal className="h-3.5 w-3.5 text-amber-400" />
              Recent Badge Earners ({totalBadges} total)
            </h2>
          </div>
          {recentBadges.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <Medal className="h-10 w-10 text-muted-foreground/20 mx-auto" />
              <p className="text-sm text-muted-foreground">No badges earned yet</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Badges are awarded automatically when athletes complete pathways.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {recentBadges.map((item: any, i: number) => (
                <Card key={i} className="p-3" data-testid={`card-badge-earned-${i}`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${badgeColor(item.badge.color).replace("text-", "bg-").replace("/15", "/20")}`}>
                      <Trophy className={`h-5 w-5 ${COLOR_MAP[item.badge.color]?.split(" ")[1] ?? "text-amber-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{item.badge.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.profile?.firstName ?? item.earned.athleteUserId}
                        {" · "}
                        {new Date(item.earned.earnedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className={`border text-xs flex-shrink-0 ${badgeColor(item.badge.color)}`}>
                      {item.badge.criteria.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── AI RECOMMENDATIONS TAB ────────────────────────────────────────── */}
        <TabsContent value="recommendations" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">AI Assignment Suggestions</p>
              <p className="text-xs text-muted-foreground">AI analyzes athlete progress and suggests pathways. You approve before anything is assigned.</p>
            </div>
            <Button size="sm" variant="outline" className="gap-2 flex-shrink-0"
              onClick={() => generateRecsMut.mutate()}
              disabled={generateRecsMut.isPending}
              data-testid="button-generate-recommendations">
              {generateRecsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>

          {loadingRecs ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : recommendations.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <Zap className="h-10 w-10 text-muted-foreground/20 mx-auto" />
              <p className="text-sm text-muted-foreground">No pending AI suggestions</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Click "Generate" to have AI analyze athlete progress and suggest pathway assignments.
              </p>
              <Button size="sm" className="mt-2 gap-2"
                onClick={() => generateRecsMut.mutate()}
                disabled={generateRecsMut.isPending}>
                {generateRecsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Generate Suggestions
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {recommendations.map((item: any) => (
                <Card key={item.rec.id} className="p-4 border-violet-500/20" data-testid={`card-recommendation-${item.rec.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                      <Zap className="h-4.5 w-4.5 text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">
                          {item.profile?.firstName ?? "Athlete"}
                          {" "}→{" "}
                          <span className="text-primary">{item.pathway?.title ?? "Pathway"}</span>
                        </p>
                        <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 border text-xs">AI Suggested</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{item.rec.reasoning}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(item.rec.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" className="h-8 w-8 p-0 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-0"
                        onClick={() => approveRecMut.mutate(item.rec.id)}
                        disabled={approveRecMut.isPending}
                        data-testid={`button-approve-rec-${item.rec.id}`}
                        title="Approve & assign">
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => rejectRecMut.mutate(item.rec.id)}
                        disabled={rejectRecMut.isPending}
                        data-testid={`button-reject-rec-${item.rec.id}`}
                        title="Reject">
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
