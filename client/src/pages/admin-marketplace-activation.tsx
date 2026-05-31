import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, TrendingUp, AlertTriangle, CheckCircle2, Users, Zap, Star, DollarSign } from "lucide-react";

function n(v: unknown): number { return Number(v ?? 0); }
function pct(a: number, b: number): number { return b > 0 ? Math.round((a / b) * 100) : 0; }

function MetricCard({ label, actual, target, color = "primary" }: { label: string; actual: number; target: number; color?: string }) {
  const p = Math.min(pct(actual, target), 100);
  const colorMap: Record<string, string> = {
    primary: "bg-primary", green: "bg-emerald-500", yellow: "bg-yellow-500", red: "bg-red-500",
  };
  const textMap: Record<string, string> = { primary: "text-primary", green: "text-emerald-400", yellow: "text-yellow-400", red: "text-red-400" };
  return (
    <Card className="bg-card border-border" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="flex items-end justify-between gap-2">
          <p className={`text-2xl font-bold ${textMap[color]}`}>{actual}</p>
          <p className="text-xs text-muted-foreground mb-1">/ {target}</p>
        </div>
        <div className="mt-2 h-1.5 rounded bg-slate-700 overflow-hidden">
          <div className={`h-1.5 rounded transition-all ${colorMap[color]}`} style={{ width: `${p}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ stage, count, rate }: { stage: string; count: number; rate: number }) {
  return (
    <div className="flex items-center gap-3 py-2" data-testid={`funnel-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="w-44 shrink-0 text-xs text-muted-foreground truncate">{stage}</div>
      <div className="flex-1 h-6 bg-slate-800 rounded overflow-hidden relative">
        <div className="h-6 bg-primary/30 rounded transition-all" style={{ width: `${Math.max(rate, 2)}%` }} />
        <span className="absolute left-2 top-0.5 text-xs text-foreground font-medium">{count}</span>
      </div>
      <div className="w-12 shrink-0 text-right text-xs text-muted-foreground">{rate}%</div>
    </div>
  );
}

export default function AdminMarketplaceActivation() {
  const { data: activation }  = useQuery<any>({ queryKey: ["/api/platform/marketplace-activation"] });
  const { data: milestones }  = useQuery<any>({ queryKey: ["/api/platform/revenue-milestones"] });
  const { data: flywheel }    = useQuery<any>({ queryKey: ["/api/platform/flywheel-monitor"] });
  const { data: conversion }  = useQuery<any>({ queryKey: ["/api/marketplace/conversion"] });
  const { data: scorecard }   = useQuery<any>({ queryKey: ["/api/platform/wave3-scorecard"] });
  const { data: healthIndex } = useQuery<any>({ queryKey: ["/api/platform/ecosystem-health-index"] });
  const { data: repeat }      = useQuery<any>({ queryKey: ["/api/platform/repeat-usage"] });
  const { data: referrals }   = useQuery<any>({ queryKey: ["/api/platform/referral-economy"] });

  const t = activation?.totals ?? {};
  const verdict = scorecard?.verdict;
  const verdictColor = verdict === "Strongly Validated" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : verdict === "Validated" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : verdict === "Partially Validated" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-activation">
            Marketplace Activation Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Wave 3 — First Revenue &amp; Flywheel Validation</p>
        </div>
        <div className="flex items-center gap-3">
          {healthIndex && (
            <Badge className="border border-blue-500/30 bg-blue-500/10 text-blue-400 font-semibold" data-testid="badge-health-grade">
              Health: {healthIndex.score}/100 ({healthIndex.grade})
            </Badge>
          )}
          {verdict && (
            <Badge className={`border font-semibold ${verdictColor}`} data-testid="badge-verdict">
              {verdict}
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Metric Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard label="Devs Registered" actual={n(t.devsRegistered)} target={10} color="primary" />
        <MetricCard label="Agents Published" actual={n(t.agentsPublished)} target={5} color="green" />
        <MetricCard label="Orgs Installed" actual={n(t.orgsInstalled)} target={15} color="primary" />
        <MetricCard label="Executions" actual={n(t.executions)} target={100} color="yellow" />
        <MetricCard label="Reviews" actual={n(t.reviews)} target={20} color="green" />
        <MetricCard label="Revenue Events" actual={n(t.revenueEvents)} target={1} color={n(t.revenueEvents) >= 1 ? "green" : "red"} />
      </div>

      <Tabs defaultValue="funnel">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="funnel"     className="text-xs" data-testid="tab-funnel">Activation Funnel</TabsTrigger>
          <TabsTrigger value="flywheel"   className="text-xs" data-testid="tab-flywheel">Flywheel</TabsTrigger>
          <TabsTrigger value="conversion" className="text-xs" data-testid="tab-conversion">Conversion</TabsTrigger>
          <TabsTrigger value="milestones" className="text-xs" data-testid="tab-milestones">Milestones</TabsTrigger>
          <TabsTrigger value="stickiness" className="text-xs" data-testid="tab-stickiness">Stickiness</TabsTrigger>
          <TabsTrigger value="scorecard"  className="text-xs" data-testid="tab-scorecard">Wave 3 Score</TabsTrigger>
        </TabsList>

        {/* ACTIVATION FUNNEL */}
        <TabsContent value="funnel" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Activation Funnel
                {activation?.bottleneck && (
                  <Badge className="ml-auto bg-red-500/20 text-red-400 border-red-500/30 text-xs border">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Bottleneck: {activation.bottleneck}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(activation?.funnel ?? []).map((s: any) => (
                <FunnelBar key={s.stage} stage={s.stage} count={s.count} rate={s.rate} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FLYWHEEL */}
        <TabsContent value="flywheel" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-400" /> Flywheel Monitor
                {flywheel?.completedLoop && <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs">Loop Complete!</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {flywheel?.stages?.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3" data-testid={`flywheel-stage-${i}`}>
                  <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${s.count > 0 ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${s.count > 0 ? "text-foreground" : "text-muted-foreground"}`}>{s.name}</span>
                      <span className={`text-sm font-bold ${s.count > 0 ? "text-primary" : "text-muted-foreground"}`}>{s.count}</span>
                    </div>
                    {s.prev !== null && s.prev > 0 && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1 bg-slate-700 rounded overflow-hidden">
                          <div className="h-1 bg-primary/50 rounded" style={{ width: `${s.conversion}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{s.conversion}%</span>
                      </div>
                    )}
                  </div>
                  {i < (flywheel?.stages?.length ?? 0) - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                </div>
              ))}
              {flywheel && (
                <div className="mt-4 p-3 rounded-lg bg-muted/30 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Failure Point</p><p className="text-red-400 font-medium">{flywheel.mostCommonFailurePoint}</p></div>
                  <div><p className="text-xs text-muted-foreground">Best Stage</p><p className="text-emerald-400 font-medium">{flywheel.mostSuccessfulPath}</p></div>
                  <div><p className="text-xs text-muted-foreground">Loop Completion</p><p className="text-foreground font-medium">{flywheel.flywheelCompletionRate}%</p></div>
                  <div><p className="text-xs text-muted-foreground">Avg Publish→Install</p><p className="text-foreground font-medium">{flywheel.avgDaysPublishToInstall ? `${flywheel.avgDaysPublishToInstall}d` : "—"}</p></div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONVERSION */}
        <TabsContent value="conversion" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Conversion Funnel
                {conversion?.biggestDrop && (
                  <Badge className="ml-auto bg-red-500/20 text-red-400 border-red-500/30 text-xs border">
                    Drop: {conversion.biggestDrop}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(conversion?.stages ?? []).map((s: any) => (
                <FunnelBar key={s.stage} stage={s.stage} count={s.count} rate={s.rate} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MILESTONES */}
        <TabsContent value="milestones" className="mt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {milestones?.milestones?.map((m: any, i: number) => (
              <Card key={i} className={`border ${m.reached ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`} data-testid={`milestone-${i}`}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.reached ? "bg-emerald-500/20" : "bg-slate-700"}`}>
                    {m.reached ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <DollarSign className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${m.reached ? "text-emerald-400" : "text-muted-foreground"}`}>{m.name}</p>
                    {m.date && <p className="text-xs text-muted-foreground">{new Date(m.date).toLocaleDateString()}</p>}
                    {m.agent && <p className="text-xs text-muted-foreground">Agent: {m.agent}</p>}
                  </div>
                  <Badge className={`text-xs border-0 ${m.reached ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-muted-foreground"}`}>
                    {m.reached ? "Reached" : "Pending"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Next milestone</p>
                <p className="text-sm font-semibold text-foreground">{milestones?.nextMilestone ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total revenue</p>
                <p className="text-xl font-bold text-primary">${n(milestones?.totalRevenue)}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STICKINESS */}
        <TabsContent value="stickiness" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Repeat Publishers */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Repeat Publishers</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">{n(repeat?.repeatPublishers?.count)}</p>
                <p className="text-xs text-muted-foreground">{n(repeat?.repeatPublishers?.rate)}% of developers</p>
                <Badge className={`mt-2 text-xs border-0 ${n(repeat?.repeatPublishers?.count) >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-muted-foreground"}`}>
                  Wave 3: {n(repeat?.repeatPublishers?.count) >= 1 ? "Met ✓" : "Target: 1"}
                </Badge>
              </CardContent>
            </Card>
            {/* Repeat Installers */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Repeat Installers</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">{n(repeat?.repeatInstallers?.count)}</p>
                <p className="text-xs text-muted-foreground">{n(repeat?.repeatInstallers?.rate)}% of organizations</p>
                <Badge className={`mt-2 text-xs border-0 ${n(repeat?.repeatInstallers?.count) >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-muted-foreground"}`}>
                  Wave 3: {n(repeat?.repeatInstallers?.count) >= 1 ? "Met ✓" : "Target: 1"}
                </Badge>
              </CardContent>
            </Card>
            {/* Referral Economy */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Referral Economy</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">{n(referrals?.combined?.totalReferrals)}</p>
                <p className="text-xs text-muted-foreground">{n(referrals?.combined?.conversionRate)}% accepted</p>
                <div className="mt-2 h-1.5 rounded bg-slate-700 overflow-hidden">
                  <div className="h-1.5 rounded bg-primary transition-all" style={{ width: `${n(referrals?.wave3Progress)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Target: 5 referrals</p>
              </CardContent>
            </Card>
          </div>

          {/* Ecosystem Health Components */}
          {healthIndex && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-400" /> Ecosystem Health Components
                  <span className="ml-auto text-lg font-bold text-primary">{healthIndex.score}/100</span>
                  <Badge className="ml-2 text-xs border border-primary/30 bg-primary/10 text-primary">{healthIndex.grade}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(healthIndex.components ?? {}).map(([k, v]: [string, any]) => (
                    <div key={k} className="space-y-1" data-testid={`health-${k}`}>
                      <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                      <p className="text-base font-bold text-foreground">{n(v)}</p>
                      <Progress value={n(v)} className="h-1.5" />
                    </div>
                  ))}
                </div>
                {healthIndex.improvementAreas?.length > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                    <p className="text-xs font-semibold text-yellow-400 mb-1">Improvement Areas</p>
                    <p className="text-xs text-muted-foreground">{healthIndex.improvementAreas.join(" · ")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* WAVE 3 SCORECARD */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {scorecard && Object.entries(scorecard.metrics ?? {}).map(([k, v]: [string, any]) => {
              const p = Math.min(Math.round((v.actual / v.target) * 100), 100);
              const col = p >= 100 ? "text-emerald-400" : p >= 50 ? "text-yellow-400" : "text-red-400";
              return (
                <Card key={k} className="bg-card border-border" data-testid={`score-${k}`}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                    <p className={`text-xl font-bold ${col}`}>{v.actual}</p>
                    <p className="text-xs text-muted-foreground">/ {v.target}</p>
                    <div className="mt-1.5 h-1 rounded bg-slate-700 overflow-hidden">
                      <div className={`h-1 rounded ${p >= 100 ? "bg-emerald-500" : p >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${p}%` }} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                Exit Criteria — {scorecard?.metCriteriaCount ?? 0}/{scorecard?.totalCriteria ?? 11} met
                <Badge className={`ml-auto border text-xs ${verdictColor}`}>{verdict ?? "—"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scorecard?.exitCriteria?.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0" data-testid={`exit-${i}`}>
                  <span className={`text-sm w-4 ${c.met ? "text-emerald-400" : "text-muted-foreground"}`}>{c.met ? "✓" : "○"}</span>
                  <span className="text-sm text-muted-foreground flex-1">{c.criterion}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
