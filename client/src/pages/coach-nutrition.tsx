import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, BookOpen, Trophy, Users, CheckCircle2,
  AlertTriangle, TrendingUp, ChevronRight,
} from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  completed:   "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  in_progress: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  not_started: "text-muted-foreground bg-muted/20 border-border/30",
};

const STATUS_LABEL: Record<string, string> = {
  completed:   "Complete",
  in_progress: "In Progress",
  not_started: "Not Started",
};

export default function CoachNutritionPage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/coach/nutrition/progress", slug],
    queryFn: () =>
      fetchJson("/api/org/coach/nutrition/progress", { headers: { "X-Org-Auth-Token": orgToken } }),
    refetchInterval: 60000,
  });

  const { data: athleteData, isLoading: athleteLoading } = useQuery<any>({
    queryKey: ["/api/org/coach/nutrition/athlete", selectedAthleteId, slug],
    queryFn: () =>
      fetchJson(`/api/org/coach/nutrition/athlete/${selectedAthleteId}`, { headers: { "X-Org-Auth-Token": orgToken } }),
    enabled: !!selectedAthleteId,
  });

  const moduleStats: any[] = data?.moduleStats ?? [];
  const totalAthletes = data?.totalAthletes ?? 0;
  const pathwayComplete = data?.pathwayComplete ?? 0;

  if (selectedAthleteId && athleteData) {
    const astats = athleteData.stats;
    const amodules: any[] = athleteData.modules ?? [];
    return (
      <div className="min-h-screen bg-background pb-16">
        <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
            <button onClick={() => setSelectedAthleteId(null)} data-testid="button-back-nutrition">
              <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
            </button>
            <BookOpen className="h-5 w-5 text-primary" />
            <h1 className="font-semibold flex-1">Athlete Nutrition Progress</h1>
          </div>
        </nav>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3 text-center border-emerald-500/20 bg-emerald-500/[0.03]">
              <p className="text-lg font-bold">{astats.completed}</p>
              <p className="text-[10px] text-muted-foreground">Completed</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-lg font-bold">{astats.total}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </Card>
            <Card className="p-3 text-center border-cyan-500/20 bg-cyan-500/[0.03]">
              <p className="text-lg font-bold">{astats.latestScore != null ? `${astats.latestScore}%` : "—"}</p>
              <p className="text-[10px] text-muted-foreground">Latest Quiz</p>
            </Card>
          </div>
          <div className="px-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Pathway progress</span>
              <span className="font-medium">{astats.percentComplete}%</span>
            </div>
            <Progress value={astats.percentComplete} className="h-2" />
          </div>

          {/* Module list */}
          <div className="space-y-2">
            {amodules.map((m: any, i: number) => {
              const status = m.progress?.status ?? "not_started";
              return (
                <Card key={m.id} className={`p-3 flex items-center gap-3 ${status === "completed" ? "border-emerald-500/20" : "border-border/30"}`}
                  data-testid={`athlete-module-${m.id}`}>
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${status === "completed" ? "bg-emerald-400/10" : "bg-muted/30"}`}>
                    {status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <BookOpen className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">Module {m.moduleNumber}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {m.progress?.quizScore != null && (
                      <span className="text-xs font-medium text-emerald-400">{m.progress.quizScore}%</span>
                    )}
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${STATUS_COLOR[status]}`}>
                      {STATUS_LABEL[status]}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/portal`} data-testid="link-nutrition-coach-back">
            <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
          </a>
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="font-semibold flex-1">Nutrition Progress</h1>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <>
            {/* Org summary */}
            <div className="grid grid-cols-3 gap-2">
              <Card className="p-3 text-center border-blue-500/20 bg-blue-500/[0.03]">
                <Users className="h-4 w-4 text-blue-400 mx-auto mb-1" />
                <p className="text-lg font-bold">{totalAthletes}</p>
                <p className="text-[10px] text-muted-foreground">Athletes</p>
              </Card>
              <Card className="p-3 text-center border-emerald-500/20 bg-emerald-500/[0.03]">
                <Trophy className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                <p className="text-lg font-bold">{pathwayComplete}</p>
                <p className="text-[10px] text-muted-foreground">Pathway Done</p>
              </Card>
              <Card className="p-3 text-center border-amber-500/20 bg-amber-500/[0.03]">
                <TrendingUp className="h-4 w-4 text-amber-400 mx-auto mb-1" />
                <p className="text-lg font-bold">
                  {moduleStats.length > 0
                    ? Math.round(moduleStats.reduce((s, m) => s + (m.avgScore ?? 0), 0) / moduleStats.filter((m) => m.avgScore != null).length || 0)
                    : 0}%
                </p>
                <p className="text-[10px] text-muted-foreground">Avg Score</p>
              </Card>
            </div>

            {/* Per-module breakdown */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Module Breakdown</h2>
              <div className="space-y-2">
                {moduleStats.map(({ module: m, completed, inProgress, started, avgScore }) => {
                  const pct = started > 0 ? Math.round((completed / Math.max(started, 1)) * 100) : 0;
                  return (
                    <Card key={m.id} className="p-3" data-testid={`coach-module-stat-${m.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{m.moduleNumber}. {m.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {completed} completed · {inProgress} in progress · {started} started
                          </p>
                        </div>
                        {avgScore != null && (
                          <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">avg {avgScore}%</Badge>
                        )}
                      </div>
                      <Progress value={completed > 0 ? pct : 0} className="h-1.5" />
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Note about athlete lookup */}
            <Card className="p-4 border-dashed border-border/40">
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Athlete Detail</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Open an athlete's profile from Teams or Athletes and click "Nutrition" to see their individual progress.
                  </p>
                  <a href={`/org/${slug}/coach/teams`}>
                    <Button size="sm" variant="outline" className="mt-2 text-xs" data-testid="link-go-to-teams">
                      <Users className="h-3.5 w-3.5 mr-1.5" /> View Teams
                    </Button>
                  </a>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
