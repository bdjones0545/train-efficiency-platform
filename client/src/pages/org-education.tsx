import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, BookOpen, CheckCircle, Circle,
  Lock, Trophy, Loader2, Sparkles, AlertTriangle, GraduationCap,
  Clock, Leaf, Medal, Youtube, Star, Zap,
} from "lucide-react";

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

// ── Athlete Badges Panel ──────────────────────────────────────────────────────
function BadgesPanel({ slug: _slug, headers }: { slug: string; headers: Record<string, string> }) {
  const { data: earned = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/org/education/my-badges"],
    queryFn: () =>
      fetch("/api/org/education/my-badges", { headers }).then((r) =>
        r.ok ? r.json() : []
      ),
    staleTime: 30_000,
  });

  if (isLoading) return null;
  if (!earned.length) return null;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-3">
        <Medal className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold">My Badges</h3>
        <span className="ml-auto text-xs text-muted-foreground">{earned.length} earned</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {earned.map((ab: any) => {
          const b = ab.badge ?? ab;
          return (
            <div
              key={ab.id}
              className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-border/50 bg-card/40 min-w-[72px] text-center"
              data-testid={`badge-earned-${ab.id}`}
            >
              <span className="text-2xl leading-none">{b.iconEmoji ?? "🏅"}</span>
              <p className="text-[10px] font-medium leading-tight line-clamp-2">{b.name}</p>
              <span className="text-[9px] text-muted-foreground">
                {ab.awardedAt ? new Date(ab.awardedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ViewMode = "pathways" | "modules" | "lesson" | "quiz" | "result" | "final_test" | "final_result";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  nutrition: <Leaf className="h-4 w-4 text-emerald-400" />,
  recovery: <Sparkles className="h-4 w-4 text-blue-400" />,
  hydration: <Sparkles className="h-4 w-4 text-cyan-400" />,
  sleep: <Sparkles className="h-4 w-4 text-violet-400" />,
  mindset: <Sparkles className="h-4 w-4 text-amber-400" />,
  team_standards: <Sparkles className="h-4 w-4 text-rose-400" />,
  custom: <GraduationCap className="h-4 w-4 text-primary" />,
};

function categoryIcon(cat: string) {
  return CATEGORY_ICONS[cat] ?? CATEGORY_ICONS.custom;
}

export default function OrgEducationPage() {
  const { slug, pathwaySlug } = useParams<{ slug: string; pathwaySlug?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  // ── View State ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>(pathwaySlug ? "modules" : "pathways");
  const [selectedPathway, setSelectedPathway] = useState<any>(null);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizResult, setQuizResult] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [finalTestAnswers, setFinalTestAnswers] = useState<Record<string, number>>({});
  const [finalTestResult, setFinalTestResult] = useState<any>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: pathwaysData, isLoading: loadingPathways } = useQuery<any>({
    queryKey: ["/api/org/education/pathways", slug],
    queryFn: () => fetchJson("/api/org/education/pathways", { headers }),
  });
  const pathways: any[] = pathwaysData?.pathways ?? [];

  // Auto-select pathway from URL slug
  const effectiveSlug = pathwaySlug ?? selectedPathway?.slug;
  const { data: pathwayData, isLoading: loadingModules } = useQuery<any>({
    queryKey: ["/api/org/education/pathways/modules", effectiveSlug],
    queryFn: () => fetchJson(`/api/org/education/pathways/${effectiveSlug}/modules`, { headers }),
    enabled: !!effectiveSlug,
  });

  // Auto-navigate when pathway loads from URL slug (replaces removed onSuccess)
  useEffect(() => {
    if (pathwayData && pathwaySlug) {
      if (!selectedPathway) setSelectedPathway(pathwayData.pathway);
      setView("modules");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathwayData?.pathway?.id, pathwaySlug]);
  const modules: any[] = pathwayData?.modules ?? [];
  const pathway = pathwayData?.pathway ?? selectedPathway;
  const stats = pathwayData?.stats;

  const { data: questionsData, isLoading: loadingQuestions } = useQuery<any>({
    queryKey: ["/api/org/education/modules/questions", selectedModule?.id],
    queryFn: () => fetchJson(`/api/org/education/modules/${selectedModule?.id}/questions`, { headers }),
    enabled: !!selectedModule && view === "quiz",
  });
  const questions: any[] = questionsData?.questions ?? [];

  const { data: finalTestData, isLoading: loadingFinalTest } = useQuery<any>({
    queryKey: ["/api/org/education/pathways/final-test", selectedPathway?.id ?? pathway?.id],
    queryFn: () => fetchJson(`/api/org/education/pathways/${selectedPathway?.id ?? pathway?.id}/final-test`, { headers }),
    enabled: !!(selectedPathway?.id ?? pathway?.id) && view === "final_test",
  });
  const finalTestQuestions: any[] = finalTestData?.questions ?? [];

  const submitFinalTestMut = useMutation({
    mutationFn: ({ pathwayId, answers }: any) =>
      apiRequest("POST", `/api/org/education/pathways/${pathwayId}/final-test/submit`, { answers }, headers),
    onSuccess: (data: any) => {
      setFinalTestResult(data);
      setView("final_result");
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/pathways", slug] });
    },
    onError: () => toast({ title: "Error submitting final test", variant: "destructive" }),
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const startModuleMut = useMutation({
    mutationFn: ({ moduleId, pathwayId }: any) =>
      apiRequest("POST", `/api/org/education/modules/${moduleId}/start`, { pathwayId },  headers),
  });

  const submitQuizMut = useMutation({
    mutationFn: ({ moduleId, answers, pathwayId }: any) =>
      apiRequest("POST", `/api/org/education/modules/${moduleId}/quiz`, { answers, pathwayId },  headers),
    onSuccess: (data: any) => {
      setQuizResult(data);
      setView("result");
      // Refresh modules so progress bars and completion badges update immediately
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/pathways/modules", effectiveSlug] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/education/pathways", slug] });
    },
    onError: () => toast({ title: "Error submitting quiz", variant: "destructive" }),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function openPathway(p: any) {
    setSelectedPathway(p);
    setView("modules");
    setSelectedModule(null);
    setQuizAnswers({});
    setQuizResult(null);
  }

  function openLesson(mod: any) {
    // Check if previous module is completed (sequential unlocking)
    const idx = modules.findIndex((m: any) => m.id === mod.id);
    if (idx > 0) {
      const prev = modules[idx - 1];
      if (prev.progress?.status !== "completed") {
        toast({ title: "Complete the previous module first", variant: "destructive" });
        return;
      }
    }
    setSelectedModule(mod);
    setExpandedSections(new Set([0]));
    setView("lesson");
    startModuleMut.mutate({ moduleId: mod.id, pathwayId: pathway?.id });
  }

  function startQuiz() {
    setQuizAnswers({});
    setView("quiz");
  }

  function submitQuiz() {
    if (Object.keys(quizAnswers).length < questions.length) {
      toast({ title: "Answer all questions before submitting", variant: "destructive" });
      return;
    }
    submitQuizMut.mutate({ moduleId: selectedModule.id, answers: quizAnswers, pathwayId: pathway?.id });
  }

  function goBack() {
    if (view === "final_result") { setView("modules"); setFinalTestResult(null); setFinalTestAnswers({}); }
    else if (view === "final_test") { setView("modules"); setFinalTestAnswers({}); }
    else if (view === "result") { setView("modules"); setQuizResult(null); setSelectedModule(null); }
    else if (view === "quiz") setView("lesson");
    else if (view === "lesson") { setView("modules"); setSelectedModule(null); }
    else if (view === "modules") {
      if (pathwaySlug) setLocation(`/org/${slug}/portal`);
      else setView("pathways");
    }
    else setLocation(`/org/${slug}/portal`);
  }

  // ── PATHWAYS LIST ──────────────────────────────────────────────────────────
  if (view === "pathways") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setLocation(`/org/${slug}/portal`)} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <GraduationCap className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-sm">Education</h1>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <h2 className="text-base font-bold">Your Education Pathways</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Complete assigned pathways to build your knowledge</p>
          </div>
          {loadingPathways && (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}
          <div className="space-y-3">
            {pathways.map((p: any) => {
              const prog = p.progress;
              return (
                <button key={p.id} onClick={() => openPathway(p)} className="w-full text-left" data-testid={`card-pathway-${p.id}`}>
                  <Card className="p-4 hover:border-primary/20 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="h-9 w-9 rounded-lg bg-card flex items-center justify-center border border-border/50 flex-shrink-0">
                        {categoryIcon(p.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{p.title}</p>
                          {prog?.percent === 100 && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">Complete</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <p className="text-xs text-muted-foreground">{p.moduleCount} modules</p>
                          {prog && (
                            <p className="text-xs text-muted-foreground">{prog.completed}/{prog.total} done</p>
                          )}
                        </div>
                        {prog && prog.total > 0 && (
                          <div className="mt-2 w-full bg-muted/30 rounded-full h-1">
                            <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${prog.percent}%` }} />
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </Card>
                </button>
              );
            })}
            {!loadingPathways && pathways.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No education pathways assigned yet</p>
                <p className="text-xs mt-1">Ask your coach to assign pathways</p>
              </div>
            )}
          </div>

          {/* My Badges section */}
          <BadgesPanel slug={slug} headers={headers} />
        </div>
      </div>
    );
  }

  // ── MODULES LIST ───────────────────────────────────────────────────────────
  if (view === "modules") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate">{pathway?.title ?? "Education"}</h1>
            {stats && <p className="text-xs text-muted-foreground">{stats.completed}/{stats.total} modules complete</p>}
          </div>
        </div>
        <div className="p-4 space-y-4">
          {/* Progress Bar */}
          {stats && stats.total > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Pathway Progress</span>
                <span className="font-semibold text-primary">{stats.percentComplete}%</span>
              </div>
              <div className="w-full bg-muted/30 rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${stats.percentComplete}%` }} />
              </div>
            </div>
          )}

          {/* Completion or Final Test CTA */}
          {stats?.percentComplete === 100 && (
            <Card className="p-4 border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary">All Modules Complete!</p>
                  <p className="text-xs text-muted-foreground">Take the final test to earn your badge</p>
                </div>
              </div>
              <Button className="w-full h-10 text-sm gap-2 font-semibold"
                onClick={() => { setFinalTestAnswers({}); setView("final_test"); }}
                data-testid="button-take-final-test">
                <Trophy className="h-4 w-4" />Take the Final Test
              </Button>
            </Card>
          )}

          {loadingModules && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

          <div className="space-y-3">
            {modules.map((m: any, i: number) => {
              const prog = m.progress;
              const isCompleted = prog?.status === "completed";
              const isInProgress = prog?.status === "in_progress";
              const prevDone = i === 0 || modules[i - 1]?.progress?.status === "completed";
              const isLocked = !prevDone;

              return (
                <button key={m.id} onClick={() => !isLocked && openLesson(m)} className="w-full text-left"
                  data-testid={`card-module-${m.id}`} disabled={isLocked}>
                  <Card className={`p-4 transition-colors ${isLocked ? "opacity-50" : "hover:border-primary/20"}`}>
                    <div className="flex items-center gap-4">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
                        isCompleted ? "border-emerald-400 bg-emerald-400/10"
                        : isInProgress ? "border-primary bg-primary/10"
                        : isLocked ? "border-muted bg-muted/30"
                        : "border-border bg-card"}`}>
                        {isCompleted ? <CheckCircle className="h-5 w-5 text-emerald-400" />
                          : isLocked ? <Lock className="h-4 w-4 text-muted-foreground" />
                          : <span className="text-sm font-bold text-muted-foreground">{m.moduleNumber}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{m.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">{m.estimatedMinutes ?? 10} min</p>
                          {m.quizCount > 0 && <p className="text-xs text-muted-foreground">· {m.quizCount} questions</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isCompleted && prog.quizScore !== null && (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">{prog.quizScore}%</Badge>
                        )}
                        {!isLocked && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── LESSON VIEW ────────────────────────────────────────────────────────────
  if (view === "lesson" && selectedModule) {
    const content = selectedModule.content ?? {};
    const sections: any[] = content.sections ?? [];
    const takeaways: string[] = selectedModule.keyTakeaways ?? [];
    const hasQuiz = selectedModule.quizCount > 0;

    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{pathway?.title}</p>
            <h1 className="font-semibold text-sm truncate">{selectedModule.title}</h1>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
            <Clock className="h-3 w-3" />
            {selectedModule.estimatedMinutes ?? 10} min
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Description */}
          {selectedModule.description && (
            <p className="text-sm text-muted-foreground">{selectedModule.description}</p>
          )}

          {/* YouTube Video Embed */}
          {selectedModule.videoUrl && (() => {
            const videoId = extractYouTubeId(selectedModule.videoUrl);
            if (!videoId) return null;
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Youtube className="h-4 w-4 text-rose-400" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Watch</p>
                </div>
                <div className="relative w-full rounded-xl overflow-hidden border border-border/40" style={{ paddingBottom: "56.25%" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}?rel=0`}
                    title="Module video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                    data-testid="iframe-module-video"
                  />
                </div>
              </div>
            );
          })()}

          {/* Sections */}
          {sections.map((s: any, i: number) => (
            <div key={i}>
              <button className="w-full text-left" onClick={() => {
                setExpandedSections((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                });
              }}>
                <div className="flex items-center justify-between py-2">
                  <p className="text-sm font-semibold">{s.title ?? s.heading}</p>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedSections.has(i) ? "rotate-90" : ""}`} />
                </div>
              </button>
              {expandedSections.has(i) && (
                <p className="text-sm text-muted-foreground leading-relaxed pb-3 border-b border-border/30">{s.body}</p>
              )}
              {!expandedSections.has(i) && <div className="border-b border-border/30" />}
            </div>
          ))}

          {/* Why This Matters for Performance */}
          {selectedModule.performanceConnection && (
            <Card className="p-4 border-blue-500/20 bg-blue-500/5">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-blue-400 flex-shrink-0" />
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Why This Matters for Performance</p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedModule.performanceConnection}</p>
            </Card>
          )}

          {/* Key Takeaways */}
          {takeaways.length > 0 && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-3">What to Remember</p>
              <div className="space-y-2">
                {takeaways.map((t: string, i: number) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">{t}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 bg-background/95 backdrop-blur border-t border-border/50" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {hasQuiz ? (
            <Button className="w-full h-11 text-sm gap-2 mb-1" onClick={startQuiz} data-testid="button-start-quiz">
              Take the Quiz <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10 text-sm" onClick={goBack}>
                Back
              </Button>
              <Button className="flex-1 h-10 text-sm gap-1.5" onClick={() => {
                const idx = modules.findIndex((m: any) => m.id === selectedModule.id);
                if (idx < modules.length - 1) openLesson(modules[idx + 1]);
                else setView("modules");
              }}>
                Next Module <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── FINAL TEST VIEW ────────────────────────────────────────────────────────
  if (view === "final_test") {
    const pathwayId = selectedPathway?.id ?? pathway?.id;
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{pathway?.title}</p>
            <h1 className="font-semibold text-sm">Final Test</h1>
          </div>
          <p className="text-xs text-muted-foreground flex-shrink-0">{Object.keys(finalTestAnswers).length}/{finalTestQuestions.length} answered</p>
        </div>

        <div className="p-4 space-y-4">
          <Card className="p-3 border-primary/20 bg-primary/5 flex items-center gap-3">
            <Trophy className="h-4 w-4 text-primary flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-primary">Pathway Final Test</p>
              <p className="text-xs text-muted-foreground">Passing score: 80% · Tests knowledge from all modules · Pass to earn your badge</p>
            </div>
          </Card>

          {loadingFinalTest && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

          {!loadingFinalTest && finalTestQuestions.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No final test available for this pathway</p>
            </div>
          )}

          {finalTestQuestions.map((q: any, qi: number) => (
            <Card key={q.id} className="p-4 space-y-3" data-testid={`card-final-question-${qi}`}>
              <p className="text-sm font-medium">{qi + 1}. {q.question}</p>
              <div className="space-y-2">
                {(q.options ?? []).map((opt: string, oi: number) => (
                  <button key={oi} onClick={() => setFinalTestAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                    data-testid={`final-option-${qi}-${oi}`}
                    className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                      finalTestAnswers[q.id] === oi
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:border-primary/30 text-muted-foreground"}`}>
                    {opt}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {finalTestQuestions.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 bg-background/95 backdrop-blur border-t border-border/50" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <Button className="w-full h-11 text-sm gap-2 mb-1 font-semibold"
              onClick={() => {
                if (Object.keys(finalTestAnswers).length < finalTestQuestions.length) {
                  toast({ title: "Answer all questions before submitting", variant: "destructive" });
                  return;
                }
                submitFinalTestMut.mutate({ pathwayId, answers: finalTestAnswers });
              }}
              disabled={submitFinalTestMut.isPending}
              data-testid="button-submit-final-test">
              {submitFinalTestMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trophy className="h-4 w-4" />Submit Final Test</>}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── FINAL RESULT VIEW ──────────────────────────────────────────────────────
  if (view === "final_result" && finalTestResult) {
    const passed = finalTestResult.passed;
    return (
      <div className="min-h-screen bg-background pb-8">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-semibold text-sm">Final Test Result</h1>
        </div>

        <div className="p-4 space-y-5">
          <Card className={`p-6 text-center border-2 ${passed ? "border-primary/40 bg-primary/5" : "border-rose-500/30 bg-rose-500/5"}`}>
            {passed
              ? <Trophy className="h-12 w-12 text-primary mx-auto mb-3" />
              : <AlertTriangle className="h-12 w-12 text-rose-400 mx-auto mb-3" />}
            <p className={`text-5xl font-bold mb-2 ${passed ? "text-primary" : "text-rose-400"}`}>{finalTestResult.score}%</p>
            <p className={`text-base font-semibold mb-1 ${passed ? "text-primary" : "text-rose-400"}`}>
              {passed ? "You passed! Badge earned." : "Not quite — retake to earn your badge"}
            </p>
            <p className="text-xs text-muted-foreground">{finalTestResult.correct}/{finalTestResult.totalQuestions} correct · 80% to pass</p>
          </Card>

          {passed && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
              <span className="text-3xl">🏅</span>
              <div>
                <p className="text-sm font-semibold text-amber-400">Badge Awarded!</p>
                <p className="text-xs text-muted-foreground">Your achievement has been recorded. Check My Badges on the education home screen.</p>
              </div>
            </Card>
          )}

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Question Breakdown</p>
            {(finalTestResult.results ?? []).map((r: any, i: number) => (
              <Card key={i} className={`p-4 border-l-2 ${r.isCorrect ? "border-l-emerald-400" : "border-l-rose-400"}`}>
                <div className="flex items-start gap-2 mb-2">
                  {r.isCorrect ? <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />}
                  <p className="text-xs font-medium">{r.question}</p>
                </div>
                {!r.isCorrect && (
                  <p className="text-xs text-muted-foreground ml-6 mt-0.5">
                    Correct: <span className="text-emerald-400">{(r.options ?? [])[r.correctIndex]}</span>
                  </p>
                )}
                {r.explanation && <p className="text-xs text-muted-foreground ml-6 mt-2 italic">{r.explanation}</p>}
              </Card>
            ))}
          </div>

          <div className="flex gap-2">
            {!passed && (
              <Button variant="outline" className="flex-1 h-10 text-sm gap-1.5"
                onClick={() => { setFinalTestAnswers({}); setFinalTestResult(null); setView("final_test"); }}
                data-testid="button-retake-final">
                Retake Test
              </Button>
            )}
            <Button className="flex-1 h-10 text-sm gap-1.5" onClick={goBack} data-testid="button-finish">
              {passed ? <><CheckCircle className="h-4 w-4" />Finish</> : "Back"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── QUIZ VIEW ──────────────────────────────────────────────────────────────
  if (view === "quiz") {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Quiz</p>
            <h1 className="font-semibold text-sm truncate">{selectedModule?.title}</h1>
          </div>
          <p className="text-xs text-muted-foreground flex-shrink-0">{Object.keys(quizAnswers).length}/{questions.length} answered</p>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground">Passing score: 80% · Retakes allowed</p>

          {loadingQuestions && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

          {questions.map((q: any, qi: number) => (
            <Card key={q.id} className="p-4 space-y-3" data-testid={`card-question-${qi}`}>
              <p className="text-sm font-medium">{qi + 1}. {q.question}</p>
              <div className="space-y-2">
                {(q.options ?? []).map((opt: string, oi: number) => (
                  <button key={oi} onClick={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                    data-testid={`option-${qi}-${oi}`}
                    className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                      quizAnswers[q.id] === oi
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:border-primary/30 text-muted-foreground"}`}>
                    {opt}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 bg-background/95 backdrop-blur border-t border-border/50" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Button className="w-full h-11 text-sm gap-2 mb-1" onClick={submitQuiz}
            disabled={submitQuizMut.isPending || Object.keys(quizAnswers).length < questions.length}
            data-testid="button-submit-quiz">
            {submitQuizMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Quiz"}
          </Button>
        </div>
      </div>
    );
  }

  // ── RESULT VIEW ────────────────────────────────────────────────────────────
  if (view === "result" && quizResult) {
    const passed = quizResult.passed;
    return (
      <div className="min-h-screen bg-background pb-8">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-semibold text-sm">Quiz Result</h1>
        </div>

        <div className="p-4 space-y-5">
          {/* Score Card */}
          <Card className={`p-6 text-center border-2 ${passed ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
            {passed ? <Trophy className="h-10 w-10 text-emerald-400 mx-auto mb-3" /> : <AlertTriangle className="h-10 w-10 text-rose-400 mx-auto mb-3" />}
            <p className={`text-4xl font-bold mb-1 ${passed ? "text-emerald-400" : "text-rose-400"}`}>{quizResult.score}%</p>
            <p className={`text-sm font-medium ${passed ? "text-emerald-400" : "text-rose-400"}`}>
              {passed ? "Passed!" : "Not quite — retake to pass"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{quizResult.correct}/{quizResult.totalQuestions} correct · 80% to pass</p>
          </Card>

          {/* Question Breakdown */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Question Breakdown</p>
            {(quizResult.results ?? []).map((r: any, i: number) => (
              <Card key={i} className={`p-4 border-l-2 ${r.isCorrect ? "border-l-emerald-400" : "border-l-rose-400"}`}>
                <div className="flex items-start gap-2 mb-2">
                  {r.isCorrect ? <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />}
                  <p className="text-xs font-medium">{r.question}</p>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  Your answer: <span className={r.isCorrect ? "text-emerald-400" : "text-rose-400"}>{(r.options ?? [])[r.submittedIndex] ?? "—"}</span>
                </p>
                {!r.isCorrect && (
                  <p className="text-xs text-muted-foreground ml-6 mt-0.5">
                    Correct: <span className="text-emerald-400">{(r.options ?? [])[r.correctIndex]}</span>
                  </p>
                )}
                {r.explanation && <p className="text-xs text-muted-foreground ml-6 mt-2 italic">{r.explanation}</p>}
              </Card>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {!passed && (
              <Button variant="outline" className="flex-1 h-10 text-sm gap-1.5"
                onClick={() => { setQuizAnswers({}); setQuizResult(null); setView("quiz"); }}
                data-testid="button-retake">
                Retake Quiz
              </Button>
            )}
            <Button className="flex-1 h-10 text-sm gap-1.5" onClick={goBack} data-testid="button-continue">
              {passed ? <><CheckCircle className="h-4 w-4" />Continue</> : "Back to Modules"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
