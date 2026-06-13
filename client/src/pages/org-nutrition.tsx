import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, CheckCircle2, BookOpen, Trophy, ChevronRight,
  Zap, Droplets, Clock, Salad, Dumbbell, Star, RotateCcw,
  ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Module icons ─────────────────────────────────────────────────────────────

const MODULE_ICONS = [Zap, Dumbbell, BookOpen, Droplets, Clock, Salad];
const MODULE_COLORS = [
  "text-amber-400 bg-amber-400/10",
  "text-green-400 bg-green-400/10",
  "text-blue-400 bg-blue-400/10",
  "text-cyan-400 bg-cyan-400/10",
  "text-violet-400 bg-violet-400/10",
  "text-emerald-400 bg-emerald-400/10",
];

// ─── Progress bar at top ──────────────────────────────────────────────────────

function PathwayProgress({ stats }: { stats: any }) {
  return (
    <Card className="p-4 space-y-3 border-primary/20 bg-primary/[0.02]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Nutrition Pathway</p>
          <p className="text-xs text-muted-foreground">{stats.completed} of {stats.total} modules complete</p>
        </div>
        {stats.completed === stats.total ? (
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
            <Trophy className="h-3 w-3" /> Complete
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">{stats.percentComplete}%</Badge>
        )}
      </div>
      <Progress value={stats.percentComplete} className="h-2" />
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" />{stats.completed} done</span>
        {stats.inProgress > 0 && <span className="flex items-center gap-1"><BookOpen className="h-3 w-3 text-blue-400" />{stats.inProgress} in progress</span>}
        {stats.notStarted > 0 && <span>{stats.notStarted} remaining</span>}
      </div>
    </Card>
  );
}

// ─── Module card (collapsed view) ────────────────────────────────────────────

function ModuleCard({ module, index, onSelect }: { module: any; index: number; onSelect: () => void }) {
  const Icon = MODULE_ICONS[index] ?? BookOpen;
  const colorClass = MODULE_COLORS[index] ?? "text-primary bg-primary/10";
  const status = module.progress?.status ?? "not_started";
  const isDone = status === "completed";
  const inProgress = status === "in_progress";

  return (
    <button
      onClick={onSelect}
      data-testid={`card-module-${module.id}`}
      className={`w-full text-left p-4 rounded-xl border transition-colors hover:border-primary/30
        ${isDone ? "border-emerald-500/20 bg-emerald-500/[0.02]" : "border-border/40 bg-card/50 hover:bg-card/80"}
      `}
    >
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass.split(" ")[1]}`}>
          {isDone
            ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            : <Icon className={`h-5 w-5 ${colorClass.split(" ")[0]}`} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Module {module.moduleNumber}: {module.title}</p>
            {isDone && (
              <Badge className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                {module.progress.quizScore}%
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{module.description}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {inProgress && <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-blue-400 border-blue-400/30">In Progress</Badge>}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}

// ─── Lesson view ──────────────────────────────────────────────────────────────

function LessonView({ module, index, onStartQuiz, onBack }: {
  module: any; index: number; onStartQuiz: () => void; onBack: () => void;
}) {
  const content = module.content as any;
  const sections = content?.sections ?? [];
  const keyTakeaways = content?.keyTakeaways ?? [];
  const Icon = MODULE_ICONS[index] ?? BookOpen;
  const colorClass = MODULE_COLORS[index] ?? "text-primary bg-primary/10";
  const [expanded, setExpanded] = useState<number>(0);
  const isDone = module.progress?.status === "completed";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`p-4 rounded-xl border border-border/30 bg-card/50`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${colorClass.split(" ")[1]}`}>
            <Icon className={`h-5 w-5 ${colorClass.split(" ")[0]}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Module {module.moduleNumber}</p>
            <h2 className="font-bold text-base">{module.title}</h2>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{module.description}</p>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {sections.map((section: any, i: number) => (
          <button
            key={i}
            onClick={() => setExpanded(expanded === i ? -1 : i)}
            className="w-full text-left p-4 rounded-xl border border-border/30 bg-card/50 hover:border-border/60 transition-colors"
            data-testid={`section-${i}`}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">{section.heading}</p>
              {expanded === i ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
            {expanded === i && (
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{section.body}</p>
            )}
          </button>
        ))}
      </div>

      {/* Key Takeaways */}
      {keyTakeaways.length > 0 && (
        <Card className="p-4 border-amber-400/20 bg-amber-400/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-1.5">
            <Star className="h-3 w-3" /> Key Takeaways
          </p>
          <ul className="space-y-2">
            {keyTakeaways.map((t: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* CTA */}
      <Button
        onClick={onStartQuiz}
        className="w-full"
        data-testid="button-start-quiz"
        variant={isDone ? "outline" : "default"}
      >
        {isDone ? (
          <><RotateCcw className="h-4 w-4 mr-1.5" /> Retake Quiz</>
        ) : (
          <><Zap className="h-4 w-4 mr-1.5" /> Take the Quiz</>
        )}
      </Button>
    </div>
  );
}

// ─── Quiz view ────────────────────────────────────────────────────────────────

function QuizView({ module, slug, onBack, onComplete }: {
  module: any; slug: string; onBack: () => void; onComplete: (score: number, passed: boolean, results: any[]) => void;
}) {
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { data: questions, isLoading } = useQuery<any[]>({
    queryKey: ["/api/org/nutrition/modules", module.id, "questions"],
    queryFn: () =>
      fetchJson(`/api/org/nutrition/modules/${module.id}/questions`, { headers: { "X-Org-Auth-Token": orgToken } }),
  });

  const submitMutation = useMutation({
    mutationFn: (ans: number[]) =>
      fetch(`/api/org/nutrition/modules/${module.id}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ answers: ans }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setResult(data);
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/org/nutrition/modules", slug] });
      onComplete(data.score, data.passed, data.results);
    },
    onError: () => toast({ title: "Error submitting quiz", variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;

  const qs = questions ?? [];
  const allAnswered = qs.every((_, i) => answers[i] !== undefined);

  if (submitted && result) {
    return (
      <div className="space-y-4">
        {/* Score card */}
        <Card className={`p-5 text-center space-y-2 ${result.passed ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-orange-500/20 bg-orange-500/[0.03]"}`}>
          <div className={`h-14 w-14 rounded-full mx-auto flex items-center justify-center text-xl font-bold
            ${result.passed ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400"}`}>
            {result.score}%
          </div>
          <p className="font-bold text-base">{result.passed ? "Quiz Passed! 🎉" : "Not quite — try again"}</p>
          <p className="text-sm text-muted-foreground">
            {result.correct} of {result.total} correct · Passing score: 80%
          </p>
          {result.passed && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Module Complete
            </Badge>
          )}
        </Card>

        {/* Question results */}
        <div className="space-y-3">
          {result.results.map((r: any, i: number) => (
            <Card key={i} className={`p-4 ${r.isCorrect ? "border-emerald-500/20" : "border-red-500/20"}`}
              data-testid={`result-q-${i}`}>
              <p className="text-sm font-medium mb-2">{r.question}</p>
              <div className="space-y-1.5">
                {(r.options as string[]).map((opt, oi) => (
                  <div key={oi} className={`text-xs px-3 py-2 rounded-lg
                    ${oi === r.correctAnswer ? "bg-emerald-500/10 text-emerald-400 font-medium" : ""}
                    ${oi === r.yourAnswer && !r.isCorrect && oi !== r.correctAnswer ? "bg-red-500/10 text-red-400 line-through" : ""}
                  `}>{opt}</div>
                ))}
              </div>
              {r.explanation && (
                <p className="text-xs text-muted-foreground mt-2 italic">{r.explanation}</p>
              )}
            </Card>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="flex-1">Back to Module</Button>
          {!result.passed && (
            <Button onClick={() => { setSubmitted(false); setResult(null); setAnswers({}); }} className="flex-1">
              <RotateCcw className="h-4 w-4 mr-1.5" /> Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{module.title} — Quiz</h2>
        <Badge variant="outline" className="text-xs">{qs.length} questions</Badge>
      </div>

      <div className="space-y-4">
        {qs.map((q: any, qi: number) => (
          <Card key={q.id} className="p-4 space-y-3" data-testid={`quiz-q-${qi}`}>
            <p className="text-sm font-medium">{qi + 1}. {q.question}</p>
            <div className="space-y-2">
              {(q.options as string[]).map((opt, oi) => (
                <button
                  key={oi}
                  onClick={() => setAnswers((prev) => ({ ...prev, [qi]: oi }))}
                  data-testid={`answer-${qi}-${oi}`}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm border transition-colors
                    ${answers[qi] === oi
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border/40 hover:border-border/80"}
                  `}
                >
                  {opt}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="h-4 w-4 mr-1" /> Lesson
        </Button>
        <Button
          onClick={() => submitMutation.mutate(qs.map((_: any, i: number) => answers[i] ?? -1))}
          disabled={!allAnswered || submitMutation.isPending}
          className="flex-1"
          data-testid="button-submit-quiz"
        >
          {submitMutation.isPending ? "Submitting…" : `Submit (${Object.keys(answers).length}/${qs.length})`}
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type ViewState =
  | { mode: "list" }
  | { mode: "lesson"; moduleId: string }
  | { mode: "quiz"; moduleId: string }
  | { mode: "result"; moduleId: string; score: number; passed: boolean; results: any[] };

export default function OrgNutritionPage() {
  const { slug } = useParams<{ slug: string }>();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<ViewState>({ mode: "list" });

  const startMutation = useMutation({
    mutationFn: (moduleId: string) =>
      fetch(`/api/org/nutrition/modules/${moduleId}/start`, {
        method: "POST",
        headers: { "X-Org-Auth-Token": orgToken },
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org/nutrition/modules", slug] }),
  });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/nutrition/modules", slug],
    queryFn: () =>
      fetchJson("/api/org/nutrition/modules", { headers: { "X-Org-Auth-Token": orgToken } }),
  });

  const modules: any[] = data?.modules ?? [];
  const stats = data?.stats ?? { total: 6, completed: 0, inProgress: 0, notStarted: 6, percentComplete: 0 };

  const activeModule = view.mode !== "list"
    ? modules.find((m) => m.id === (view as any).moduleId)
    : null;
  const activeIndex = activeModule ? modules.indexOf(activeModule) : 0;

  function handleSelectModule(module: any, i: number) {
    if (module.progress?.status === "not_started") {
      startMutation.mutate(module.id);
    }
    setView({ mode: "lesson", moduleId: module.id });
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          {view.mode !== "list" ? (
            <button onClick={() => setView({ mode: "list" })} data-testid="button-back-to-list">
              <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
            </button>
          ) : (
            <a href={`/org/${slug}/portal`}>
              <Button size="sm" variant="ghost"><ArrowLeft className="h-4 w-4" /></Button>
            </a>
          )}
          <BookOpen className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <h1 className="font-semibold text-sm leading-tight">
              {view.mode === "list" ? "Nutrition Education"
                : view.mode === "lesson" ? activeModule?.title ?? "Lesson"
                : view.mode === "quiz" ? `${activeModule?.title} — Quiz`
                : "Quiz Results"}
            </h1>
          </div>
          {stats.percentComplete > 0 && view.mode === "list" && (
            <Badge variant="outline" className="text-xs">{stats.percentComplete}% done</Badge>
          )}
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-xl" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : view.mode === "list" ? (
          <>
            <PathwayProgress stats={stats} />
            <div className="space-y-2 pb-4">
              {modules.map((m, i) => (
                <ModuleCard
                  key={m.id}
                  module={m}
                  index={i}
                  onSelect={() => handleSelectModule(m, i)}
                />
              ))}
            </div>
          </>
        ) : view.mode === "lesson" && activeModule ? (
          <LessonView
            module={activeModule}
            index={activeIndex}
            onBack={() => setView({ mode: "list" })}
            onStartQuiz={() => setView({ mode: "quiz", moduleId: activeModule.id })}
          />
        ) : view.mode === "quiz" && activeModule ? (
          <QuizView
            module={activeModule}
            slug={slug}
            onBack={() => setView({ mode: "lesson", moduleId: activeModule.id })}
            onComplete={(score, passed, results) =>
              setView({ mode: "result", moduleId: activeModule.id, score, passed, results })
            }
          />
        ) : view.mode === "result" ? (
          <div className="space-y-4">
            <Card className={`p-6 text-center space-y-3
              ${(view as any).passed ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-orange-500/20 bg-orange-500/[0.03]"}`}>
              <div className={`h-16 w-16 rounded-full mx-auto flex items-center justify-center text-2xl font-bold
                ${(view as any).passed ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400"}`}>
                {(view as any).score}%
              </div>
              <p className="font-bold text-lg">{(view as any).passed ? "Module Complete! 🎉" : "Not quite — try again"}</p>
              <p className="text-sm text-muted-foreground">Passing score: 80%</p>
            </Card>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setView({ mode: "list" })} className="flex-1">
                All Modules
              </Button>
              {!(view as any).passed && activeModule && (
                <Button onClick={() => setView({ mode: "quiz", moduleId: activeModule.id })} className="flex-1">
                  <RotateCcw className="h-4 w-4 mr-1.5" /> Retry Quiz
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
