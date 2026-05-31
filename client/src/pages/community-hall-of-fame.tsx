import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Zap, Star, Target, ArrowUpRight } from "lucide-react";

function n(v: unknown) { return Number(v ?? 0); }

function StageBar({ stages, currentIndex }: { stages: any[]; currentIndex: number }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.name} className="flex items-center gap-1">
          <div className={`px-2.5 py-1 rounded text-xs font-medium ${i < currentIndex ? "bg-emerald-500/20 text-emerald-400" : i === currentIndex ? "bg-primary/20 text-primary ring-1 ring-primary/30" : "bg-muted/40 text-muted-foreground"}`}>
            {s.name}
          </div>
          {i < stages.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function CommunityHallOfFame() {
  const { data: hof }    = useQuery<any>({ queryKey: ["/api/community/hall-of-fame"] });
  const { data: stage }  = useQuery<any>({ queryKey: ["/api/platform/marketplace-stage"] });
  const { data: momentum}= useQuery<any>({ queryKey: ["/api/platform/momentum"] });
  const { data: cohorts }= useQuery<any>({ queryKey: ["/api/platform/cohorts"] });
  const { data: velocity}= useQuery<any>({ queryKey: ["/api/platform/velocity"] });

  const stageColor = (s: string) => s === "Self-Sustaining" || s === "Accelerating" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : s === "Growing" || s === "Active" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : s === "Emerging" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-slate-500/20 text-slate-400 border-slate-500/30";

  const metStage = stage?.stages?.filter((s: any) => s.completed) ?? [];

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-hall-of-fame">Hall of Fame</h1>
          <p className="text-sm text-muted-foreground mt-1">First movers, top performers, and marketplace milestones</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stage && <Badge className={`border text-xs font-semibold ${stageColor(stage.currentStage)}`}>{stage.currentStage}</Badge>}
          {momentum && <Badge className={`border text-xs font-semibold ${stageColor(momentum.stage)}`}>Momentum: {momentum.stage} · {momentum.score}/100</Badge>}
        </div>
      </div>

      {/* Marketplace stage progression */}
      {stage && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Marketplace Stage Progression</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <StageBar stages={stage.stages ?? []} currentIndex={stage.currentIndex} />
            {stage.nextStage && (
              <div className="mt-3 p-3 rounded bg-muted/30">
                <p className="text-xs text-muted-foreground mb-2">Next: <span className="text-foreground font-medium">{stage.nextStage}</span> — {stage.distanceToNext}% there</p>
                <div className="flex flex-wrap gap-2">
                  {(stage.requirementsRemaining ?? []).map((r: any, i: number) => (
                    <Badge key={i} className="text-xs border-0 bg-red-500/20 text-red-400">{r.check}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="halloffame">
        <TabsList className="grid grid-cols-3 md:grid-cols-5 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="halloffame" className="text-xs" data-testid="tab-hof">Hall of Fame</TabsTrigger>
          <TabsTrigger value="momentum"   className="text-xs" data-testid="tab-momentum">Momentum</TabsTrigger>
          <TabsTrigger value="cohorts"    className="text-xs" data-testid="tab-cohorts">Retention</TabsTrigger>
          <TabsTrigger value="velocity"   className="text-xs" data-testid="tab-velocity">Velocity</TabsTrigger>
          <TabsTrigger value="stage"      className="text-xs" data-testid="tab-stage">Stage Details</TabsTrigger>
        </TabsList>

        {/* HALL OF FAME */}
        <TabsContent value="halloffame" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(hof?.hallOfFame ?? []).map((entry: any, i: number) => (
              <Card key={i} className={`bg-card border ${entry.met ? "border-primary/30" : "border-border opacity-60"}`} data-testid={`hof-entry-${i}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{entry.icon}</div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-foreground">{entry.title}</p>
                      {entry.met ? (
                        <>
                          <p className="text-sm text-primary font-medium mt-0.5">{entry.recipient}</p>
                          {entry.detail && <p className="text-xs text-muted-foreground mt-0.5">{entry.detail}</p>}
                          {entry.date && <p className="text-xs text-muted-foreground mt-0.5">{new Date(entry.date).toLocaleDateString()}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1 italic">Not yet claimed</p>
                      )}
                    </div>
                    {entry.met && <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* MOMENTUM */}
        <TabsContent value="momentum" className="mt-4 space-y-4">
          {momentum && (
            <>
              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="text-center px-4">
                  <p className="text-5xl font-bold text-primary">{momentum.score}</p>
                  <p className="text-xs text-muted-foreground mt-1">/ 100</p>
                </div>
                <div className="flex-1">
                  <Badge className={`border text-sm font-bold mb-2 ${stageColor(momentum.stage)}`}>{momentum.stage}</Badge>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {[["Installs", momentum.last30?.installs, momentum.trends?.installs], ["Reviews", momentum.last30?.reviews, momentum.trends?.reviews]].map(([l, v, t]) => (
                      <div key={String(l)} className="text-center">
                        <p className={`text-xs font-medium ${t === "up" ? "text-emerald-400" : t === "down" ? "text-red-400" : "text-muted-foreground"}`}>{l}: {String(v)} {t === "up" ? "↑" : t === "down" ? "↓" : "→"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(momentum.components ?? {}).map(([k, v]: [string, any]) => (
                  <Card key={k} className="bg-card border-border" data-testid={`momentum-component-${k}`}>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, (s: string) => s.toUpperCase())}</p>
                      <p className={`text-xl font-bold ${n(v) >= 50 ? "text-emerald-400" : n(v) >= 25 ? "text-yellow-400" : "text-red-400"}`}>{n(v)}</p>
                      <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
                        <div className={`h-1 rounded ${n(v) >= 50 ? "bg-emerald-500" : n(v) >= 25 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${n(v)}%` }} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[["Installs", momentum.last30?.installs], ["Reviews", momentum.last30?.reviews], ["Revenue", momentum.last30?.revenue], ["Royalties", momentum.last30?.royalties], ["Referrals", momentum.last30?.referrals]].map(([l, v]) => (
                  <Card key={String(l)} className="bg-card border-border">
                    <CardContent className="p-3"><p className="text-xs text-muted-foreground">{l} (30d)</p><p className="text-xl font-bold text-foreground">{String(v)}</p></CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* COHORTS / RETENTION */}
        <TabsContent value="cohorts" className="mt-4 space-y-4">
          {cohorts && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[["developer", "Developer Retention"], ["organization", "Organization Retention"]].map(([key, title]) => {
                  const c = (cohorts as any)[key];
                  if (!c) return null;
                  return (
                    <Card key={key} className={`bg-card border ${c.atRisk ? "border-red-500/30" : "border-emerald-500/30"}`} data-testid={`cohort-${key}`}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          {title}
                          <Badge className={`ml-auto border-0 text-xs ${c.health === "Healthy" ? "bg-emerald-500/20 text-emerald-400" : c.health === "At Risk" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>{c.health}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-3xl font-bold text-primary">{c.total} <span className="text-base text-muted-foreground font-normal">total</span></p>
                        {[["30d", c.active30, c.retention30], ["60d", c.active60, c.retention60], ["90d", c.active90, c.retention90]].map(([label, active, ret]) => (
                          <div key={String(label)} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-8">{label}</span>
                            <div className="flex-1 h-2 bg-slate-700 rounded overflow-hidden">
                              <div className={`h-2 rounded ${n(ret) >= 50 ? "bg-emerald-500" : n(ret) >= 25 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${n(ret)}%` }} />
                            </div>
                            <span className="text-xs text-foreground w-16">{String(active)} ({n(ret)}%)</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {cohorts.churnDrivers?.length > 0 && (
                <Card className="bg-card border-red-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-red-400">Churn Drivers</CardTitle></CardHeader>
                  <CardContent>
                    {cohorts.churnDrivers.map((d: string, i: number) => (
                      <p key={i} className="text-sm text-muted-foreground py-1 flex items-start gap-2"><span className="text-red-400 mt-0.5">→</span>{d}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* VELOCITY */}
        <TabsContent value="velocity" className="mt-4 space-y-4">
          {velocity && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Growth Velocity</p><p className={`text-2xl font-bold ${velocity.growthVelocity > 0 ? "text-emerald-400" : "text-red-400"}`}>{velocity.growthVelocity > 0 ? "+" : ""}{velocity.growthVelocity}%</p></CardContent></Card>
                <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Acceleration</p><p className={`text-2xl font-bold ${velocity.acceleration >= 0 ? "text-emerald-400" : "text-yellow-400"}`}>{velocity.acceleration >= 0 ? "+" : ""}{velocity.acceleration}</p></CardContent></Card>
                <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Trend</p><p className="text-2xl font-bold text-foreground">{velocity.trend}</p></CardContent></Card>
              </div>
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Weekly Activity</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(velocity.weeks ?? []).slice(-8).reverse().map((w: any, i: number) => {
                      const total = n(w.total);
                      const max = Math.max(...(velocity.weeks ?? []).map((x: any) => n(x.total)), 1);
                      return (
                        <div key={i} className="flex items-center gap-3" data-testid={`velocity-week-${i}`}>
                          <span className="text-xs text-muted-foreground w-24 shrink-0">{w.week}</span>
                          <div className="flex-1 h-5 bg-slate-800 rounded overflow-hidden">
                            <div className="h-5 bg-primary/30 rounded" style={{ width: `${Math.max((total / max) * 100, total > 0 ? 3 : 0)}%` }} />
                          </div>
                          <span className="text-xs text-foreground w-8 text-right">{total}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* STAGE DETAILS */}
        <TabsContent value="stage" className="mt-4 space-y-3">
          {(stage?.stages ?? []).map((s: any, i: number) => (
            <Card key={i} className={`bg-card border ${s.current ? "border-primary/40" : s.completed ? "border-emerald-500/20" : "border-border"}`} data-testid={`stage-detail-${i}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xl font-bold ${s.current ? "text-primary" : s.completed ? "text-emerald-400" : "text-muted-foreground"}`}>{i + 1}</span>
                  <div>
                    <p className="text-sm font-bold text-foreground flex items-center gap-2">
                      {s.name}
                      {s.current && <Badge className="border-0 bg-primary/20 text-primary text-xs">Current</Badge>}
                      {s.completed && !s.current && <Badge className="border-0 bg-emerald-500/20 text-emerald-400 text-xs">Complete</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.requirements.map((r: any, j: number) => (
                    <Badge key={j} className={`text-xs border-0 ${r.met ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{r.check}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
