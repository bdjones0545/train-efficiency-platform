import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Clock, AlertTriangle, Target, UserCheck, ArrowRight, MessageSquare, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";

function n(v: unknown) { return Number(v ?? 0); }

const STATUS_ORDER = ["invited","activated","published","installed","reviewed","generating_revenue"];
function stageScore(s: string) { return STATUS_ORDER.indexOf(s) * 20; }

function statusColor(s: string) {
  if (s === "generating_revenue") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (s === "reviewed")           return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s === "installed")          return "bg-primary/20 text-primary border-primary/30";
  if (s === "published")          return "bg-violet-500/20 text-violet-400 border-violet-500/30";
  if (s === "activated")          return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-muted/40 text-muted-foreground border-border";
}

function verdictColors(v: string) {
  if (v === "STRONGLY VALIDATED")  return { bg: "bg-emerald-500/10 border-emerald-500/30", badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", bar: "bg-emerald-500" };
  if (v === "VALIDATED")           return { bg: "bg-blue-500/10 border-blue-500/30",    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",    bar: "bg-blue-500" };
  if (v === "PARTIALLY VALIDATED") return { bg: "bg-yellow-500/10 border-yellow-500/30", badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", bar: "bg-yellow-500" };
  return { bg: "bg-red-500/5 border-red-500/20", badge: "bg-red-500/10 text-red-400 border-red-500/20", bar: "bg-red-500/60" };
}

function scoreColor(s: number) {
  return s >= 80 ? "text-emerald-400" : s >= 60 ? "text-blue-400" : s >= 40 ? "text-yellow-400" : "text-red-400";
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-muted-foreground shrink-0 w-8 text-right">{value}</span>
    </div>
  );
}

function CriterionRow({ c, i }: { c: any; i: number }) {
  const pct = c.target > 1 ? Math.min(100, Math.round((c.current / c.target) * 100)) : null;
  return (
    <div className={`p-3 rounded-lg border flex items-start gap-3 ${c.met ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`} data-testid={`phase-y-criterion-${i}`}>
      {c.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{c.criterion}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{c.evidence}</p>
        {pct !== null && !c.met && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-1 rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{c.current}/{c.target}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminFirst10() {
  const [, navigate] = useLocation();

  const { data: participants } = useQuery<any[]>({ queryKey: ["/api/validation-participants"] });
  const { data: queue }        = useQuery<any>({ queryKey: ["/api/platform/activation-queue"] });
  const { data: countdown }    = useQuery<any>({ queryKey: ["/api/platform/first-revenue-countdown"] });
  const { data: actions }      = useQuery<any>({ queryKey: ["/api/platform/founder-actions"] });
  const { data: scorecard }    = useQuery<any>({ queryKey: ["/api/platform/phase-y-scorecard"] });
  const { data: scores }       = useQuery<any>({ queryKey: ["/api/platform/human-validation-scores"] });
  const { data: playbooks }    = useQuery<any[]>({ queryKey: ["/api/first10-playbooks"] });
  const { data: templates }    = useQuery<any>({ queryKey: ["/api/first10-playbooks/templates"] });

  const total          = participants?.length ?? 0;
  const activated      = (participants ?? []).filter(p => p.status !== "invited").length;
  const completionPct  = scorecard?.progressPct ?? 0;
  const verdict        = scorecard?.verdict ?? "NOT VALIDATED";
  const vc             = verdictColors(verdict);

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-first10">First 10 Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Phase Y operating center — 10 Human Marketplace Validation Protocol</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`border text-sm font-bold px-3 py-1.5 ${vc.badge}`} data-testid="verdict-badge">{verdict}</Badge>
          <Button size="sm" variant="outline" onClick={() => navigate("/admin/human-validation")} data-testid="btn-go-validation">
            <UserCheck className="h-3.5 w-3.5 mr-1" />Manage Participants
          </Button>
        </div>
      </div>

      {/* The Final Question */}
      <div className={`p-5 rounded-lg border ${vc.bg}`}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">The Final Question — Part 12</p>
        <p className="text-lg font-bold text-foreground">Can someone who is not Bryan Jones successfully participate in the TrainEfficiency Agent Economy?</p>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <Badge className={`border text-base font-bold px-4 py-1.5 ${vc.badge}`}>{verdict}</Badge>
          <span className="text-sm text-muted-foreground">{scorecard?.metCount ?? 0}/9 success criteria met</span>
          <div className="flex-1 max-w-48 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className={`h-2 rounded-full transition-all ${vc.bar}`} style={{ width: `${completionPct}%` }} />
          </div>
          <span className="text-sm font-bold text-primary">{completionPct}%</span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Participants Invited",      val: total,                           color: "text-foreground" },
          { label: "Activated",                 val: activated,                       color: activated > 0 ? "text-primary" : "text-muted-foreground" },
          { label: "Stuck",                     val: queue?.stuck ?? 0,               color: (queue?.stuck ?? 0) > 0 ? "text-yellow-400" : "text-muted-foreground" },
          { label: "Criteria Met (9)",          val: `${scorecard?.metCount ?? 0}/9`,  color: n(scorecard?.metCount) >= 6 ? "text-emerald-400" : "text-foreground" },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`first10-stat-${i}`}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{String(s.val)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="tracker">
        <TabsList className="grid grid-cols-4 md:grid-cols-7 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="tracker"   className="text-xs" data-testid="tab-first10-tracker">Progress</TabsTrigger>
          <TabsTrigger value="queue"     className="text-xs" data-testid="tab-first10-queue">Queue</TabsTrigger>
          <TabsTrigger value="countdown" className="text-xs" data-testid="tab-first10-countdown">Countdown</TabsTrigger>
          <TabsTrigger value="actions"   className="text-xs" data-testid="tab-first10-actions">Actions</TabsTrigger>
          <TabsTrigger value="scores"    className="text-xs" data-testid="tab-first10-scores">Scores</TabsTrigger>
          <TabsTrigger value="playbooks" className="text-xs" data-testid="tab-first10-playbooks">Playbooks</TabsTrigger>
          <TabsTrigger value="scorecard" className="text-xs" data-testid="tab-first10-scorecard">Exit Criteria</TabsTrigger>
        </TabsList>

        {/* ── PROGRESS TRACKER ─────────────────────────────────────────────── */}
        <TabsContent value="tracker" className="mt-4 space-y-3">
          {total === 0 ? (
            <div className="text-center py-16">
              <Target className="h-8 w-8 mx-auto opacity-30 mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground font-medium">No participants yet.</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Recruit exactly 10 participants: 5 Group A creators (developers) + 5 Group B consumers (orgs).</p>
              <Button size="sm" onClick={() => navigate("/admin/human-validation")} data-testid="btn-add-first-participant">Add First Participant</Button>
            </div>
          ) : (
            <>
              {/* Group A vs B summary */}
              <div className="grid grid-cols-2 gap-3 mb-1">
                {[
                  { label: "Group A — Creators", sub: "Developers who publish agents", type: "developer", target: 5 },
                  { label: "Group B — Consumers", sub: "Organizations that install agents", type: "org", target: 5 },
                ].map(g => {
                  const cnt = (participants ?? []).filter(p => p.type === g.type).length;
                  return (
                    <div key={g.type} className={`p-3 rounded-lg border ${cnt >= g.target ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`}>
                      <p className="text-sm font-medium text-foreground">{g.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{g.sub}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                          <div className={`h-1.5 rounded-full ${cnt >= g.target ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${Math.min(100, cnt / g.target * 100)}%` }} />
                        </div>
                        <span className={`text-sm font-bold shrink-0 ${cnt >= g.target ? "text-emerald-400" : "text-foreground"}`}>{cnt}/{g.target}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stage columns */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {STATUS_ORDER.map(s => {
                  const cnt = (participants ?? []).filter(p => p.status === s).length;
                  return (
                    <div key={s} className={`p-2 rounded-lg border text-center ${cnt > 0 ? "bg-card border-border" : "opacity-40 bg-muted/10 border-border/40"}`}>
                      <p className="text-xs text-muted-foreground leading-tight">{s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</p>
                      <p className="text-xl font-bold text-foreground mt-0.5">{cnt}</p>
                    </div>
                  );
                })}
              </div>

              {/* Participant cards */}
              {(participants ?? []).sort((a: any, b: any) => stageScore(b.status) - stageScore(a.status)).map((p: any) => {
                const progress = ((STATUS_ORDER.indexOf(p.status) + 1) / STATUS_ORDER.length) * 100;
                return (
                  <Card key={p.id} className="bg-card border-border" data-testid={`first10-row-${p.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{p.external_name}</p>
                            <Badge className={`text-xs border ${statusColor(p.status)}`}>{p.status.replace(/_/g," ").replace(/\b\w/g,(c: string)=>c.toUpperCase())}</Badge>
                            <Badge className="text-xs border-0 bg-muted/30 text-muted-foreground">{p.type === "developer" ? "Group A" : "Group B"}</Badge>
                            {p.subtype && <Badge className="text-xs border-0 bg-muted/20 text-muted-foreground">{p.subtype}</Badge>}
                          </div>
                          {p.organization && <p className="text-xs text-muted-foreground mt-0.5">{p.organization}</p>}
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                              <div className={`h-1.5 rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progress}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">{Math.round(progress)}%</span>
                          </div>
                          <div className="flex gap-3 mt-2 flex-wrap">
                            {[["Invited",p.invited_at],["Activated",p.activated_at],["Published",p.first_publish_at],["Installed",p.first_install_at],["Reviewed",p.first_review_at],["Revenue",p.first_revenue_at]].map(([l,d]) =>
                              d ? <span key={String(l)} className="text-xs text-emerald-400 flex items-center gap-0.5"><CheckCircle className="h-3 w-3"/>{l}</span>
                                : <span key={String(l)} className="text-xs text-muted-foreground/40">{l}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </TabsContent>

        {/* ── ACTIVATION QUEUE ─────────────────────────────────────────────── */}
        <TabsContent value="queue" className="mt-4 space-y-3">
          {(queue?.queue ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No participants in queue yet.</p>
          ) : (
            <>
              {queue?.stuck > 0 && (
                <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                  <p className="text-sm text-yellow-400">{queue.stuck} participant{queue.stuck > 1 ? "s" : ""} stuck — founder rule: you may answer questions but not do their work</p>
                </div>
              )}
              {(queue.queue ?? []).map((p: any, i: number) => (
                <Card key={p.id} className={`bg-card border ${p.isStuck ? "border-yellow-500/30" : "border-border"}`} data-testid={`queue-row-${i}`}>
                  <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                        <Badge className={`text-xs border ${statusColor(p.status)}`}>{p.status.replace(/_/g," ").replace(/\b\w/g,(c: string)=>c.toUpperCase())}</Badge>
                        {p.isStuck && <Badge className="text-xs border-0 bg-yellow-500/20 text-yellow-400">Stuck {p.daysSinceUpdate}d</Badge>}
                        <Badge className="text-xs border-0 bg-muted/30 text-muted-foreground">{p.type === "developer" ? "Group A" : "Group B"}</Badge>
                      </div>
                      {p.organization && <p className="text-xs text-muted-foreground mt-0.5">{p.organization}</p>}
                      <div className="flex items-center gap-1 mt-1.5">
                        <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                        <p className="text-xs text-primary">{p.nextAction}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold ${p.urgency >= 100 ? "text-red-400" : p.urgency >= 70 ? "text-yellow-400" : "text-muted-foreground"}`}>Priority {p.urgency}</p>
                      {p.email && <p className="text-xs text-muted-foreground mt-0.5">{p.email}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ── REVENUE COUNTDOWN ────────────────────────────────────────────── */}
        <TabsContent value="countdown" className="mt-4 space-y-4">
          {countdown && (
            <>
              <div className={`p-4 rounded-lg border ${countdown.allMet ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-base font-bold text-foreground">{countdown.allMet ? "All Milestones Complete!" : `Next: ${countdown.nextMilestone}`}</p>
                    {!countdown.allMet && countdown.estimatedDaysToNext > 0 && (
                      <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1"><Clock className="h-3 w-3" />Est. {countdown.estimatedDaysToNext} day{countdown.estimatedDaysToNext > 1 ? "s" : ""} with active follow-up</p>
                    )}
                  </div>
                  <Badge className="border text-sm font-bold px-3 py-1 bg-primary/20 text-primary border-primary/30">{countdown.metCount}/{countdown.totalSteps} met</Badge>
                </div>
                {countdown.nextBlocker && (
                  <div className="mt-3 flex items-center gap-2 text-yellow-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p className="text-sm">{countdown.nextBlocker}</p>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {(countdown.steps ?? []).map((step: any, i: number) => (
                  <div key={i} className={`flex items-start gap-4 p-4 rounded-lg border ${step.met ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`} data-testid={`countdown-step-${i}`}>
                    <div className="shrink-0 mt-0.5">
                      {step.met ? <CheckCircle className="h-5 w-5 text-emerald-400" /> : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${step.met ? "text-foreground" : "text-muted-foreground"}`}>{step.milestone}</p>
                      {step.met
                        ? <p className="text-xs text-emerald-400 mt-0.5">✓ Completed · {step.count} recorded</p>
                        : step.blocker && <p className="text-xs text-yellow-400 mt-0.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3 shrink-0" />{step.blocker}</p>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── FOUNDER ACTIONS ───────────────────────────────────────────────── */}
        <TabsContent value="actions" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Top actions — live from platform data. Bryan may answer questions, fix bugs, and observe. Bryan may NOT do the work for participants.</p>
            <Badge className="border-0 bg-muted/40 text-muted-foreground text-xs">{actions?.weekOf}</Badge>
          </div>
          {(actions?.actions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Add participants to generate actions.</p>
          ) : (actions.actions ?? []).map((a: any, i: number) => (
            <Card key={i} className="bg-card border-border" data-testid={`founder-action-${i}`}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${a.priority === 1 ? "bg-red-500/20 text-red-400" : a.priority === 2 ? "bg-yellow-500/20 text-yellow-400" : "bg-muted/40 text-muted-foreground"}`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{a.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{a.reason}</p>
                </div>
                <Badge className="text-xs border shrink-0 bg-muted/30 border-border text-muted-foreground">{a.type}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── HUMAN VALIDATION SCORES (Part 7) ─────────────────────────────── */}
        <TabsContent value="scores" className="mt-4 space-y-4">
          {/* Aggregate */}
          {scores?.aggregate && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Avg Overall Score",   val: scores.aggregate.avgOverall,       unit: "/100" },
                { label: "Avg Satisfaction",     val: scores.aggregate.avgSatisfaction,  unit: "/100" },
                { label: "Avg Recommendation",   val: scores.aggregate.avgRecommendation, unit: "%" },
                { label: "Avg Return Intent",    val: scores.aggregate.avgReturnIntent,  unit: "%" },
              ].map((s, i) => (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.val !== null ? scoreColor(n(s.val)) : "text-muted-foreground"}`}>
                      {s.val !== null ? `${s.val}${s.unit}` : "—"}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Per-participant scores */}
          {(scores?.scores ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No participants yet. Add participants to see validation scores.</p>
          ) : (
            <div className="space-y-3">
              {(scores.scores ?? []).map((s: any, i: number) => (
                <Card key={s.id} className="bg-card border-border" data-testid={`score-card-${i}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{s.name}</p>
                          <Badge className={`text-xs border ${statusColor(s.status)}`}>{s.status.replace(/_/g," ").replace(/\b\w/g,(c: string)=>c.toUpperCase())}</Badge>
                          <Badge className="text-xs border-0 bg-muted/30 text-muted-foreground">{s.type === "developer" ? "Group A" : "Group B"}</Badge>
                          {!s.hasFeedback && <span className="text-xs text-muted-foreground/60 italic">No feedback yet</span>}
                        </div>
                        {s.organization && <p className="text-xs text-muted-foreground mt-0.5">{s.organization}</p>}
                      </div>
                      <div className={`text-3xl font-bold shrink-0 ${scoreColor(s.overallScore)}`} data-testid={`overall-score-${i}`}>{s.overallScore}</div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {[
                        { label: "Activation",    val: s.activationScore,    color: "bg-primary" },
                        { label: "Completion",     val: s.completionScore,    color: "bg-violet-500" },
                        { label: "Satisfaction",   val: s.satisfactionScore,  color: "bg-emerald-500" },
                        { label: "Recommendation", val: s.recommendationScore, color: "bg-blue-500" },
                        { label: "Return Intent",  val: s.returnIntentScore,  color: "bg-yellow-500" },
                      ].map(dim => (
                        <div key={dim.label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24 shrink-0">{dim.label}</span>
                          {dim.val !== null
                            ? <ScoreBar value={dim.val} color={dim.color} />
                            : <span className="text-xs text-muted-foreground/50 italic">No data</span>
                          }
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── PLAYBOOKS ─────────────────────────────────────────────────────── */}
        <TabsContent value="playbooks" className="mt-4 space-y-4">
          <Tabs defaultValue="templates">
            <TabsList className="grid grid-cols-2 h-auto gap-1 bg-muted/30 p-1">
              <TabsTrigger value="templates" className="text-xs">Message Templates</TabsTrigger>
              <TabsTrigger value="tracking"  className="text-xs">Outreach Tracking</TabsTrigger>
            </TabsList>
            <TabsContent value="templates" className="mt-3 space-y-4">
              {Object.entries(templates?.templates ?? {}).map(([type, msgs]: [string, any]) => (
                <Card key={type} className="bg-card border-border" data-testid={`template-${type}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      {type.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())} Outreach
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {msgs.map((msg: string, i: number) => (
                      <div key={i} className="p-3 rounded bg-muted/30 border border-border/60">
                        <p className="text-xs text-muted-foreground mb-1 font-medium">Message {i + 1}</p>
                        <p className="text-sm text-foreground">{msg}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
            <TabsContent value="tracking" className="mt-3 space-y-3">
              {(playbooks ?? []).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                  {[["Sent",(playbooks ?? []).filter(p => p.sent_at).length],["Opened",(playbooks ?? []).filter(p => p.opened_at).length],["Responded",(playbooks ?? []).filter(p => p.responded_at).length],["Activated",(playbooks ?? []).filter(p => p.activated_at).length]].map(([l,v]) => (
                    <Card key={String(l)} className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold text-foreground">{String(v)}</p></CardContent></Card>
                  ))}
                </div>
              )}
              {(playbooks ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No outreach tracked yet.</p>
              ) : (playbooks ?? []).map((pb: any, i: number) => (
                <Card key={pb.id} className="bg-card border-border" data-testid={`playbook-row-${i}`}>
                  <CardContent className="p-3 flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{pb.participant_name ?? "Unknown"}</p>
                        <Badge className="text-xs border-0 bg-muted/40 text-muted-foreground">{pb.template_type}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      {[["Sent",pb.sent_at],["Opened",pb.opened_at],["Responded",pb.responded_at],["Activated",pb.activated_at]].map(([l,d]) => (
                        <div key={String(l)} className={`text-center ${d ? "opacity-100" : "opacity-30"}`}>
                          {d ? <CheckCircle className="h-3 w-3 text-emerald-400 mx-auto" /> : <XCircle className="h-3 w-3 text-muted-foreground mx-auto" />}
                          <p className="text-xs text-muted-foreground mt-0.5">{l}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── EXIT CRITERIA (9 thresholds + 4-tier verdict) ─────────────────── */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className={`p-5 rounded-lg border ${vc.bg}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Part 9 — Success Thresholds · Part 12 — Verdict</p>
                <p className="text-xl font-bold text-foreground">{scorecard?.phaseComplete ? "Validation Complete 🎉" : "In Progress"}</p>
                <p className="text-sm text-muted-foreground mt-1">{scorecard?.metCount ?? 0}/9 criteria met</p>
              </div>
              <Badge className={`border text-lg font-bold px-4 py-2 ${vc.badge}`}>{verdict}</Badge>
            </div>
            <div className="mt-4 h-3 rounded-full bg-slate-700 overflow-hidden">
              <div className={`h-3 rounded-full transition-all ${vc.bar}`} style={{ width: `${completionPct}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>NOT VALIDATED</span>
              <span>PARTIALLY VALIDATED</span>
              <span>VALIDATED</span>
              <span>STRONGLY VALIDATED</span>
            </div>
          </div>

          {/* Failure conditions (Part 10) — show only when active */}
          {(scorecard?.activeFailures ?? []).length > 0 && (
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 space-y-2">
              <p className="text-xs text-red-400 font-semibold uppercase tracking-wide flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Part 10 — Active Failure Conditions</p>
              {(scorecard.activeFailures ?? []).map((f: any, i: number) => (
                <p key={i} className="text-sm text-red-400">· {f.condition}</p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {(scorecard?.criteria ?? []).map((c: any, i: number) => (
              <CriterionRow key={i} c={c} i={i} />
            ))}
          </div>

          {/* Verdict guidance */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { v: "NOT VALIDATED",       range: "0–2 met", c: "border-red-500/20 bg-red-500/5",      t: "text-red-400" },
              { v: "PARTIALLY VALIDATED", range: "3–5 met", c: "border-yellow-500/20 bg-yellow-500/5", t: "text-yellow-400" },
              { v: "VALIDATED",           range: "6–8 met", c: "border-blue-500/20 bg-blue-500/5",    t: "text-blue-400" },
              { v: "STRONGLY VALIDATED",  range: "9/9 met", c: "border-emerald-500/20 bg-emerald-500/5", t: "text-emerald-400" },
            ].map(tier => (
              <div key={tier.v} className={`p-2 rounded-lg border text-center ${tier.c} ${verdict === tier.v ? "ring-1 ring-current" : "opacity-60"}`}>
                <p className={`text-xs font-bold ${tier.t}`}>{tier.v}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{tier.range}</p>
              </div>
            ))}
          </div>

          {!scorecard?.phaseComplete && (
            <div className="p-4 rounded-lg bg-muted/20 border border-border">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />Phase Y Mandate</p>
              <p className="text-sm text-muted-foreground">Do not build another major marketplace subsystem until this validation is complete. The next milestone is not architecture. The next milestone is proof.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
