import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, BookOpen, CheckCircle, Circle,
  Lock, Trophy, Loader2, Sparkles, AlertTriangle, GraduationCap,
  Clock, Leaf,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

type ViewMode = "pathways" | "modules" | "lesson" | "quiz" | "result";

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

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: pathwaysData, isLoading: loadingPathways } = useQuery<any>({
    queryKey: ["/api/org/education/pathways", slug],
    queryFn: () => fetch("/api/org/education/pathways", { headers }).then((r) => r.json()),
  });
  const pathways: any[] = pathwaysData?.pathways ?? [];

  // Auto-select pathway from URL slug
  const effectiveSlug = pathwaySlug ?? selectedPathway?.slug;
  const { data: pathwayData, isLoading: loadingModules } = useQuery<any>({
    queryKey: ["/api/org/education/pathways/modules", effectiveSlug],
    queryFn: () => fetch(`/api/org/education/pathways/${effectiveSlug}/modules`, { headers }).then((r) => r.json()),
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
    queryFn: () => fetch(`/api/org/education/modules/${selectedModule?.id}/questions`, { headers }).then((r) => r.json()),
    enabled: !!selectedModule && view === "quiz",
  });
  const questions: any[] = questionsData?.questions ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const startModuleMut = useMutation({
    mutationFn: ({ moduleId, pathwayId }: any) =>
      apiRequest("POST", `/api/org/education/modules/${moduleId}/start`, { pathwayId }, { headers }),
  });

  const submitQuizMut = useMutation({
    mutationFn: ({ moduleId, answers, pathwayId }: any) =>
      apiRequest("POST", `/api/org/education/modules/${moduleId}/quiz`, { answers, pathwayId }, { headers }),
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
    if (view === "result") { setView("modules"); setQuizResult(null); setSelectedModule(null); }
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

          {/* Completion Badge */}
          {stats?.percentComplete === 100 && (
            <Card className="p-3 border-emerald-500/20 bg-emerald-500/5 flex items-center gap-3">
              <Trophy className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-400">Pathway Complete!</p>
                <p className="text-xs text-muted-foreground">You've finished all modules in this pathway</p>
              </div>
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

          {/* Key Takeaways */}
          {takeaways.length > 0 && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-3">Key Takeaways</p>
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
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border/50">
          {hasQuiz ? (
            <Button className="w-full h-11 text-sm gap-2" onClick={startQuiz} data-testid="button-start-quiz">
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

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border/50">
          <Button className="w-full h-11 text-sm gap-2" onClick={submitQuiz}
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
