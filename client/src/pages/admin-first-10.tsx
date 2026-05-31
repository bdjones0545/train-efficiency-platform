import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Clock, AlertTriangle, Zap, Target, UserCheck, ArrowRight, MessageSquare } from "lucide-react";
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
function urgencyColor(u: number) {
  return u >= 100 ? "text-red-400" : u >= 70 ? "text-yellow-400" : "text-muted-foreground";
}
function actionTypeColor(t: string) {
  if (t === "recruit")    return "bg-violet-500/15 text-violet-400 border-violet-500/30";
  if (t === "activation") return "bg-primary/15 text-primary border-primary/30";
  if (t === "follow-up")  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  if (t === "amplify")    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (t === "feedback")   return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-muted/40 text-muted-foreground border-border";
}

function MilestoneStep({ step, index }: { step: any; index: number }) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-lg border ${step.met ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`} data-testid={`countdown-step-${index}`}>
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
  );
}

export default function AdminFirst10() {
  const [, navigate] = useLocation();

  const { data: participants } = useQuery<any[]>({ queryKey: ["/api/validation-participants"] });
  const { data: queue }        = useQuery<any>({ queryKey: ["/api/platform/activation-queue"] });
  const { data: countdown }    = useQuery<any>({ queryKey: ["/api/platform/first-revenue-countdown"] });
  const { data: actions }      = useQuery<any>({ queryKey: ["/api/platform/founder-actions"] });
  const { data: scorecard }    = useQuery<any>({ queryKey: ["/api/platform/phase-y-scorecard"] });
  const { data: playbooks }    = useQuery<any[]>({ queryKey: ["/api/first10-playbooks"] });
  const { data: templates }    = useQuery<any>({ queryKey: ["/api/first10-playbooks/templates"] });

  const total = participants?.length ?? 0;
  const activated = (participants ?? []).filter(p => p.status !== "invited").length;
  const completionPct = scorecard?.progressPct ?? 0;

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-first10">First 10 Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Phase Y operating center — track every external participant to first confirmed loop</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`border text-sm font-bold px-3 py-1.5 ${scorecard?.finalQuestion === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-muted/40 text-muted-foreground border-border"}`} data-testid="final-question-badge">
            {scorecard?.finalQuestion ?? "NOT YET CONFIRMED"}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => navigate("/admin/human-validation")} data-testid="btn-go-validation">
            <UserCheck className="h-3.5 w-3.5 mr-1" />Manage Participants
          </Button>
        </div>
      </div>

      {/* The Question */}
      <div className={`p-5 rounded-lg border ${scorecard?.phaseComplete ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border"}`}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">The Final Question</p>
        <p className="text-lg font-bold text-foreground">Can someone who is not Bryan Jones successfully participate in the TrainEfficiency Agent Economy?</p>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <Badge className={`border text-base font-bold px-4 py-1.5 ${scorecard?.finalQuestion === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
            {scorecard?.finalQuestion ?? "NOT YET CONFIRMED"}
          </Badge>
          <span className="text-sm text-muted-foreground">{scorecard?.metCount ?? 0}/5 success criteria met</span>
          <div className="flex-1 max-w-48 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className={`h-2 rounded-full transition-all ${completionPct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${completionPct}%` }} />
          </div>
          <span className="text-sm font-bold text-primary">{completionPct}%</span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Participants Invited",  val: total,                          color: "text-foreground" },
          { label: "Activated",             val: activated,                       color: activated > 0 ? "text-primary" : "text-muted-foreground" },
          { label: "Stuck",                 val: queue?.stuck ?? 0,              color: (queue?.stuck ?? 0) > 0 ? "text-yellow-400" : "text-muted-foreground" },
          { label: "Countdown Steps Met",   val: `${countdown?.metCount ?? 0}/6`, color: n(countdown?.metCount) >= 5 ? "text-emerald-400" : "text-foreground" },
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
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="tracker"    className="text-xs" data-testid="tab-first10-tracker">Progress Tracker</TabsTrigger>
          <TabsTrigger value="queue"      className="text-xs" data-testid="tab-first10-queue">Activation Queue</TabsTrigger>
          <TabsTrigger value="countdown"  className="text-xs" data-testid="tab-first10-countdown">Revenue Countdown</TabsTrigger>
          <TabsTrigger value="actions"    className="text-xs" data-testid="tab-first10-actions">Founder Actions</TabsTrigger>
          <TabsTrigger value="playbooks"  className="text-xs" data-testid="tab-first10-playbooks">Playbooks</TabsTrigger>
          <TabsTrigger value="scorecard"  className="text-xs" data-testid="tab-first10-scorecard">Exit Criteria</TabsTrigger>
        </TabsList>

        {/* PROGRESS TRACKER */}
        <TabsContent value="tracker" className="mt-4 space-y-3">
          {total === 0 ? (
            <div className="text-center py-16">
              <Target className="h-8 w-8 mx-auto opacity-30 mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground font-medium">No participants yet.</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Go to the Human Validation page to add your first external developer or org.</p>
              <Button size="sm" onClick={() => navigate("/admin/human-validation")} data-testid="btn-add-first-participant">Add First Participant</Button>
            </div>
          ) : (
            <>
              {/* Stage summary row */}
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
              {/* Participant rows */}
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
                            <Badge className="text-xs border-0 bg-muted/30 text-muted-foreground">{p.type}</Badge>
                          </div>
                          {p.organization && <p className="text-xs text-muted-foreground mt-0.5">{p.organization}</p>}
                          {p.external_email && <p className="text-xs text-muted-foreground">{p.external_email}</p>}
                          {/* Progress bar */}
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                              <div className={`h-1.5 rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progress}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">{Math.round(progress)}%</span>
                          </div>
                          {/* Milestone timeline */}
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

        {/* ACTIVATION QUEUE */}
        <TabsContent value="queue" className="mt-4 space-y-3">
          {(queue?.queue ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No participants in queue yet.</p>
          ) : (
            <>
              {queue?.stuck > 0 && (
                <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                  <p className="text-sm text-yellow-400">{queue.stuck} participant{queue.stuck > 1 ? "s" : ""} stuck and need{queue.stuck === 1 ? "s" : ""} follow-up</p>
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
                      </div>
                      {p.organization && <p className="text-xs text-muted-foreground mt-0.5">{p.organization}</p>}
                      <div className="flex items-center gap-1 mt-1.5">
                        <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                        <p className="text-xs text-primary">{p.nextAction}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold ${urgencyColor(p.urgency)}`}>Priority {p.urgency}</p>
                      {p.email && <p className="text-xs text-muted-foreground mt-0.5">{p.email}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* REVENUE COUNTDOWN */}
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
                  <Badge className="border text-sm font-bold px-3 py-1 bg-primary/20 text-primary border-primary/30">
                    {countdown.metCount}/{countdown.totalSteps} met
                  </Badge>
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
                  <MilestoneStep key={i} step={step} index={i} />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* FOUNDER ACTIONS */}
        <TabsContent value="actions" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Top actions for this week — generated from live platform data</p>
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
                <Badge className={`text-xs border shrink-0 ${actionTypeColor(a.type)}`}>{a.type}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* PLAYBOOKS */}
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
              {/* Aggregate stats */}
              {(playbooks ?? []).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                  {[
                    ["Sent",      (playbooks ?? []).filter(p => p.sent_at).length],
                    ["Opened",    (playbooks ?? []).filter(p => p.opened_at).length],
                    ["Responded", (playbooks ?? []).filter(p => p.responded_at).length],
                    ["Activated", (playbooks ?? []).filter(p => p.activated_at).length],
                  ].map(([l, v]) => (
                    <Card key={String(l)} className="bg-card border-border">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{l}</p>
                        <p className="text-xl font-bold text-foreground">{String(v)}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {(playbooks ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No outreach tracked yet. Use the Human Validation page to add participants, then log outreach here.</p>
              ) : (playbooks ?? []).map((pb: any, i: number) => (
                <Card key={pb.id} className="bg-card border-border" data-testid={`playbook-row-${i}`}>
                  <CardContent className="p-3 flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{pb.participant_name ?? "Unknown"}</p>
                        <Badge className="text-xs border-0 bg-muted/40 text-muted-foreground">{pb.template_type}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
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

        {/* EXIT CRITERIA */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className={`p-5 rounded-lg border ${scorecard?.phaseComplete ? "bg-emerald-500/5 border-emerald-500/20" : "bg-card border-border"}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Phase Y Exit Criteria</p>
                <p className="text-xl font-bold text-foreground">{scorecard?.phaseComplete ? "Phase Complete 🎉" : "In Progress"}</p>
                <p className="text-sm text-muted-foreground mt-1">{scorecard?.metCount ?? 0}/5 criteria met</p>
              </div>
              <Badge className={`border text-lg font-bold px-4 py-2 ${scorecard?.finalQuestion === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                {scorecard?.finalQuestion ?? "NOT YET CONFIRMED"}
              </Badge>
            </div>
            <div className="mt-4 h-3 rounded-full bg-slate-700 overflow-hidden">
              <div className={`h-3 rounded-full transition-all ${completionPct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${completionPct}%` }} />
            </div>
          </div>
          <div className="space-y-2">
            {(scorecard?.criteria ?? []).map((c: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border" data-testid={`phase-y-criterion-${i}`}>
                {c.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-sm text-foreground">{c.criterion}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.evidence}</p>
                </div>
              </div>
            ))}
          </div>
          {!scorecard?.phaseComplete && (
            <div className="p-4 rounded-lg bg-muted/20 border border-border">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Phase Y Mandate</p>
              <p className="text-sm text-muted-foreground">Do not build another marketplace feature until The Final Question changes from "Not Yet Confirmed" to "Confirmed". The next milestone is not software — it is evidence.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
