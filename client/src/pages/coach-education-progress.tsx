import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Users,
  Trophy,
  AlertTriangle,
  CheckCircle,
  Circle,
  BarChart2,
  GraduationCap,
  ChevronRight,
  Star,
  Clock,
  Loader2,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

const CATEGORY_COLORS: Record<string, string> = {
  nutrition: "emerald",
  recovery: "blue",
  hydration: "cyan",
  sleep: "violet",
  mindset: "amber",
  team_standards: "rose",
  injury_prevention: "orange",
  recruiting: "pink",
  custom: "slate",
};

function categoryBadge(category: string) {
  const color = CATEGORY_COLORS[category] ?? "slate";
  const colorMap: Record<string, string> = {
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
  const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge className={`text-xs border ${colorMap[color] ?? colorMap.slate}`}>
      {label}
    </Badge>
  );
}

function statusBadge(status: string) {
  if (status === "published")
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs border">Published</Badge>;
  if (status === "archived")
    return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-xs border">Archived</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs border">Draft</Badge>;
}

function completionColor(pct: number) {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 40) return "text-amber-400";
  return "text-red-400";
}

function PathwayCard({
  stat,
  selected,
  onClick,
}: {
  stat: any;
  selected: boolean;
  onClick: () => void;
}) {
  const { pathway, moduleCount, totalAthletes, pathwayCompleted, inProgress, avgScore, completionRate } = stat;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`card-pathway-${pathway.id}`}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-150 ${
        selected
          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate" data-testid={`text-pathway-title-${pathway.id}`}>
            {pathway.title}
          </p>
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
          <span className={`font-bold ${completionColor(completionRate)}`} data-testid={`text-completion-rate-${pathway.id}`}>
            {completionRate}%
          </span>
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

function ModuleProgressTable({ stats }: { stats: any[] }) {
  if (!stats || stats.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No modules in this pathway yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stats.map((ms: any) => {
        const pct = ms.completed > 0 ? Math.round((ms.completed / Math.max(ms.completed, 1)) * 100) : 0;
        return (
          <div
            key={ms.module.id}
            data-testid={`row-module-${ms.module.id}`}
            className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card"
          >
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary">{ms.module.moduleNumber}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" data-testid={`text-module-title-${ms.module.id}`}>
                {ms.module.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{ms.module.estimatedMinutes} min</span>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <p className="text-sm font-semibold" data-testid={`text-module-completed-${ms.module.id}`}>{ms.completed}</p>
                <p className="text-[10px] text-muted-foreground">completed</p>
              </div>
              {ms.avgScore !== null && (
                <div className="text-right">
                  <p className="text-sm font-semibold text-amber-400" data-testid={`text-module-score-${ms.module.id}`}>{ms.avgScore}%</p>
                  <p className="text-[10px] text-muted-foreground">avg score</p>
                </div>
              )}
              {ms.completed > 0 ? (
                <CheckCircle className="h-4 w-4 text-emerald-400" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CoachEducationProgressPage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null);

  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/education/analytics", slug],
    queryFn: () => fetch("/api/org/education/analytics", { headers }).then((r) => r.json()),
  });

  const pathwayStats: any[] = analyticsData?.pathwayStats ?? [];
  const totalAthletes: number = analyticsData?.totalAthletes ?? 0;

  const selectedStat = selectedPathwayId
    ? pathwayStats.find((s: any) => s.pathway.id === selectedPathwayId)
    : pathwayStats[0] ?? null;

  const overallCompleted = pathwayStats.reduce((sum: number, s: any) => sum + s.pathwayCompleted, 0);
  const overallInProgress = pathwayStats.reduce((sum: number, s: any) => sum + s.inProgress, 0);
  const publishedPathways = pathwayStats.filter((s: any) => s.pathway.status === "published");

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
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
            <p className="text-sm text-muted-foreground">Athlete completion across all learning pathways</p>
          </div>
        </div>
        <a href={`/org/${slug}/coach/education-builder`} data-testid="link-go-to-builder">
          <Button variant="outline" size="sm" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Education Builder
          </Button>
        </a>
      </div>

      {/* Summary stats */}
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
          <p className="text-xs text-muted-foreground">Pathways Completed</p>
        </Card>
        <Card className="p-4 text-center border-amber-500/20" data-testid="card-stat-in-progress">
          <AlertTriangle className="h-4 w-4 text-amber-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-amber-400" data-testid="text-stat-total-in-progress">{overallInProgress}</p>
          <p className="text-xs text-muted-foreground">In Progress</p>
        </Card>
      </div>

      {pathwayStats.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <GraduationCap className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No education pathways yet</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Create and publish pathways in the Education Builder to start tracking athlete progress.
          </p>
          <a href={`/org/${slug}/coach/education-builder`}>
            <Button size="sm" className="mt-2" data-testid="button-go-to-builder-empty">
              Open Education Builder
            </Button>
          </a>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — pathway list */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <BarChart2 className="h-3.5 w-3.5" />
              Pathways ({pathwayStats.length})
            </h2>
            {pathwayStats.map((stat: any) => (
              <PathwayCard
                key={stat.pathway.id}
                stat={stat}
                selected={
                  selectedPathwayId === stat.pathway.id ||
                  (!selectedPathwayId && stat === pathwayStats[0])
                }
                onClick={() =>
                  setSelectedPathwayId(
                    selectedPathwayId === stat.pathway.id ? null : stat.pathway.id
                  )
                }
              />
            ))}
          </div>

          {/* Right — module breakdown */}
          <div className="lg:col-span-2 space-y-4">
            {selectedStat ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-base" data-testid="text-selected-pathway-title">
                      {selectedStat.pathway.title}
                    </h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {categoryBadge(selectedStat.pathway.category)}
                      {statusBadge(selectedStat.pathway.status)}
                    </div>
                    {selectedStat.pathway.description && (
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {selectedStat.pathway.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pathway completion summary */}
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

                {/* Module breakdown */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    Module Breakdown ({selectedStat.moduleStats?.length ?? 0} modules)
                  </h3>
                  <ModuleProgressTable stats={selectedStat.moduleStats ?? []} />
                </div>
              </>
            ) : (
              <Card className="p-12 text-center space-y-3">
                <BarChart2 className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">Select a pathway to see module details</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
