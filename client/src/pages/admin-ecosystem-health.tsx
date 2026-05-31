import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Zap, Star, TrendingUp, Activity, BarChart2,
  Droplets, RotateCcw, CheckCircle2, XCircle, AlertCircle,
  Building2, Trophy, Target,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
function VerdictBadge({ v }: { v: string }) {
  const map: Record<string, string> = {
    PASS: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    IN_PROGRESS: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    NEEDS_WORK: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return <Badge className={`border ${map[v] ?? map["NEEDS_WORK"]} text-xs font-semibold`}>{v.replace("_", " ")}</Badge>;
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#334155" strokeWidth="6" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.5s" }} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fill={color} fontSize="14" fontWeight="bold" style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>
        {score}
      </text>
    </svg>
  );
}

function MetricBar({ label, actual, target, unit = "" }: { label: string; actual: number; target: number; unit?: string }) {
  const pct = Math.min(Math.round((actual / target) * 100), 100);
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1" data-testid={`metric-bar-${label.toLowerCase().replace(/\s+/g,"-")}`}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={pct >= 100 ? "text-emerald-400" : ""}>{actual}{unit} / {target}{unit}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CriterionRow({ criterion, met }: { criterion: string; met: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0"
      data-testid={`criterion-${criterion.slice(0,20).replace(/\s+/g,"-")}`}>
      {met
        ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
        : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
      <span className="text-sm text-muted-foreground">{criterion}</span>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function AdminEcosystemHealth() {
  const { data: scorecard, isLoading: scLoading } = useQuery<any>({ queryKey: ["/api/platform/beta-wave1-scorecard"] });
  const { data: liquidity, isLoading: lqLoading } = useQuery<any>({ queryKey: ["/api/marketplace/liquidity"] });
  const { data: flywheel, isLoading: fwLoading } = useQuery<any>({ queryKey: ["/api/platform/flywheel"] });
  const { data: funnel,   isLoading: fnLoading } = useQuery<any>({ queryKey: ["/api/marketplace/funnel"] });
  const { data: adoption, isLoading: adLoading } = useQuery<any>({ queryKey: ["/api/marketplace/adoption-wave1"] });
  const { data: reviews,  isLoading: rvLoading } = useQuery<any>({ queryKey: ["/api/marketplace/review-health"] });
  const { data: economics,isLoading: ecLoading } = useQuery<any>({ queryKey: ["/api/developer/economics"] });
  const { data: firstVal, isLoading: fvLoading } = useQuery<any>({ queryKey: ["/api/platform/first-value"] });

  const loading = scLoading || lqLoading || fwLoading;

  const liquidityLevel = liquidity?.level ?? "—";
  const liquidityColor: Record<string, string> = {
    "Self-Sustaining": "text-emerald-400",
    "Healthy":         "text-green-400",
    "Active":          "text-yellow-400",
    "Emerging":        "text-orange-400",
    "Inactive":        "text-red-400",
  };

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-ecosystem-health">
            Ecosystem Health Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Beta Wave 1 — Command Center</p>
        </div>
        {scorecard && <VerdictBadge v={scorecard.verdict ?? "NEEDS_WORK"} />}
      </div>

      {/* Hero KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Beta Score */}
        <Card className="bg-card border-border" data-testid="card-beta-score">
          <CardContent className="p-4 flex items-center gap-4">
            <ScoreRing score={loading ? 0 : (scorecard?.overallScore ?? 0)} />
            <div>
              <p className="text-xs text-muted-foreground">Beta Score</p>
              <p className="text-lg font-bold">{loading ? "…" : `${scorecard?.overallScore ?? 0}/100`}</p>
              <p className="text-xs text-muted-foreground">Target: 70+</p>
            </div>
          </CardContent>
        </Card>

        {/* Liquidity Score */}
        <Card className="bg-card border-border" data-testid="card-liquidity">
          <CardContent className="p-4 flex items-center gap-4">
            <ScoreRing score={lqLoading ? 0 : (liquidity?.liquidityScore ?? 0)} size={80} />
            <div>
              <p className="text-xs text-muted-foreground">Liquidity</p>
              <p className="text-lg font-bold">{lqLoading ? "…" : `${liquidity?.liquidityScore ?? 0}/100`}</p>
              <p className={`text-xs font-semibold ${liquidityColor[liquidityLevel] ?? "text-muted-foreground"}`}>{liquidityLevel}</p>
            </div>
          </CardContent>
        </Card>

        {/* Flywheel Score */}
        <Card className="bg-card border-border" data-testid="card-flywheel-score">
          <CardContent className="p-4 flex items-center gap-4">
            <ScoreRing score={fwLoading ? 0 : (flywheel?.flywheelScore ?? 0)} size={80} />
            <div>
              <p className="text-xs text-muted-foreground">Flywheel</p>
              <p className="text-lg font-bold">{fwLoading ? "…" : `${flywheel?.flywheelScore ?? 0}/100`}</p>
              <p className="text-xs text-muted-foreground">{fwLoading ? "…" : `${flywheel?.reachedCount ?? 0}/${flywheel?.totalStages ?? 8} stages`}</p>
            </div>
          </CardContent>
        </Card>

        {/* Exit Criteria */}
        <Card className="bg-card border-border" data-testid="card-exit-criteria">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="relative">
              <ScoreRing score={loading ? 0 : Math.round(((scorecard?.metCriteriaCount ?? 0) / (scorecard?.totalCriteria ?? 10)) * 100)} size={80} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Exit Criteria</p>
              <p className="text-lg font-bold">{loading ? "…" : `${scorecard?.metCriteriaCount ?? 0}/${scorecard?.totalCriteria ?? 10}`}</p>
              <p className="text-xs text-muted-foreground">criteria met</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-4 md:grid-cols-8 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="overview"    className="text-xs" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="flywheel"    className="text-xs" data-testid="tab-flywheel">Flywheel</TabsTrigger>
          <TabsTrigger value="funnel"      className="text-xs" data-testid="tab-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="adoption"    className="text-xs" data-testid="tab-adoption">Adoption</TabsTrigger>
          <TabsTrigger value="developers"  className="text-xs" data-testid="tab-developers">Developers</TabsTrigger>
          <TabsTrigger value="reviews"     className="text-xs" data-testid="tab-reviews">Reviews</TabsTrigger>
          <TabsTrigger value="firstvalue"  className="text-xs" data-testid="tab-firstvalue">First Value</TabsTrigger>
          <TabsTrigger value="exit"        className="text-xs" data-testid="tab-exit">Exit Criteria</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Scorecard Metrics */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><BarChart2 className="h-4 w-4 text-primary" /> Beta Wave 1 Scorecard</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {scLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : scorecard?.metrics && Object.entries(scorecard.metrics).map(([k, v]: [string, any]) => (
                  <MetricBar key={k}
                    label={k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                    actual={v.actual} target={v.target}
                    unit={k.includes("Rate") ? "%" : ""}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Liquidity Components */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Droplets className="h-4 w-4 text-blue-400" /> Marketplace Liquidity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lqLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : liquidity?.components && [
                  { k: "developers",    label: "Developers",     target: 5  },
                  { k: "agents",        label: "Agents",         target: 10 },
                  { k: "organizations", label: "Organizations",  target: 10 },
                  { k: "installs",      label: "Installs",       target: 25 },
                  { k: "executions",    label: "Executions",     target: 50 },
                  { k: "reviews",       label: "Reviews",        target: 10 },
                  { k: "revenueEvents", label: "Revenue Events", target: 1  },
                ].map(({ k, label, target }) => (
                  <MetricBar key={k} label={label} actual={liquidity.components[k] ?? 0} target={target} />
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* FLYWHEEL */}
        <TabsContent value="flywheel" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><RotateCcw className="h-4 w-4 text-purple-400" /> Ecosystem Flywheel</CardTitle>
            </CardHeader>
            <CardContent>
              {fwLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : (
                <>
                  <div className="mb-4 p-3 rounded-lg bg-muted/40 text-sm">
                    <span className="text-muted-foreground">Biggest bottleneck: </span>
                    <span className="font-semibold text-orange-400" data-testid="flywheel-bottleneck">{flywheel?.biggestBottleneck}</span>
                  </div>
                  <div className="space-y-3">
                    {flywheel?.stages?.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-3" data-testid={`flywheel-stage-${i}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s.count > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-muted-foreground"}`}>
                          {i + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className={s.count > 0 ? "text-foreground" : "text-muted-foreground"}>{s.stage}</span>
                            <span className={s.count >= s.target ? "text-emerald-400" : "text-muted-foreground"}>{s.count} / {s.target}</span>
                          </div>
                          <Progress value={Math.min(Math.round((s.count / s.target) * 100), 100)} className="h-1.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FUNNEL */}
        <TabsContent value="funnel" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-400" /> Agent Installation Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {fnLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : (
                <>
                  <div className="mb-4 flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-orange-400" />
                    <span className="text-muted-foreground">Biggest drop-off: </span>
                    <span className="font-semibold text-orange-400" data-testid="funnel-dropoff">{funnel?.biggestDropOff}</span>
                    <span className="ml-auto text-xs text-muted-foreground">Overall conversion: {funnel?.overallConversion}%</span>
                  </div>
                  <div className="space-y-2">
                    {funnel?.funnel?.map((stage: any, i: number) => (
                      <div key={i} className="flex items-center gap-3" data-testid={`funnel-stage-${i}`}>
                        <span className="text-xs text-muted-foreground w-36 shrink-0">{stage.stage}</span>
                        <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
                          <div className="bg-cyan-500 h-2 rounded-full transition-all" style={{ width: `${stage.conversionRate}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-20 text-right">{stage.count} ({stage.conversionRate}%)</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADOPTION */}
        <TabsContent value="adoption" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Installs",   val: adoption?.summary?.totalInstalls ?? "—",   icon: <Activity className="h-4 w-4 text-blue-400" /> },
              { label: "Active Installs",  val: adoption?.summary?.activeInstalls ?? "—",  icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
              { label: "Retention Rate",   val: adLoading ? "…" : `${adoption?.retentionRate ?? 0}%`, icon: <TrendingUp className="h-4 w-4 text-green-400" /> },
              { label: "Review Rate",      val: adLoading ? "…" : `${adoption?.reviewRate ?? 0}%`, icon: <Star className="h-4 w-4 text-yellow-400" /> },
            ].map((m, i) => (
              <Card key={i} className="bg-card border-border" data-testid={`adoption-stat-${i}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">{m.icon}<span className="text-xs text-muted-foreground">{m.label}</span></div>
                  <p className="text-xl font-bold">{m.val}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-yellow-400" /> Top Performing Agents</CardTitle></CardHeader>
              <CardContent>
                {adLoading ? <p className="text-xs text-muted-foreground">Loading…</p> :
                  adoption?.topPerforming?.length > 0
                    ? adoption.topPerforming.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-border/40 last:border-0 text-sm" data-testid={`top-agent-${i}`}>
                        <span className="text-foreground truncate">{a.name ?? a.agentId}</span>
                        <span className="text-xs text-muted-foreground ml-2 shrink-0">{a.installs} installs · {a.executions} execs</span>
                      </div>
                    ))
                    : <p className="text-xs text-muted-foreground">No data yet</p>
                }
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><XCircle className="h-4 w-4 text-red-400" /> Top Abandoned Agents</CardTitle></CardHeader>
              <CardContent>
                {adLoading ? <p className="text-xs text-muted-foreground">Loading…</p> :
                  adoption?.topAbandoned?.length > 0
                    ? adoption.topAbandoned.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-border/40 last:border-0 text-sm" data-testid={`abandoned-agent-${i}`}>
                        <span className="text-foreground truncate">{a.name ?? a.agentId}</span>
                        <span className="text-xs text-red-400 ml-2 shrink-0">{a.uninstalls} uninstalls</span>
                      </div>
                    ))
                    : <p className="text-xs text-muted-foreground">No abandoned agents yet</p>
                }
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* DEVELOPERS */}
        <TabsContent value="developers" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Active Developers",  val: economics?.summary?.activeDevelopers ?? "—" },
              { label: "Published Agents",   val: economics?.summary?.totalPublishedAgents ?? "—" },
              { label: "Total Royalties",    val: ecLoading ? "…" : `$${(economics?.summary?.totalRoyalties ?? 0).toLocaleString()}` },
              { label: "Avg Agents/Dev",     val: ecLoading ? "…" : economics?.insights?.avgAgentsPerDev ?? "—" },
            ].map((m, i) => (
              <Card key={i} className="bg-card border-border" data-testid={`dev-stat-${i}`}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                  <p className="text-xl font-bold">{m.val}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Developer Breakdown</CardTitle></CardHeader>
            <CardContent>
              {ecLoading ? <p className="text-xs text-muted-foreground">Loading…</p> :
                economics?.developers?.length > 0
                  ? economics.developers.slice(0, 10).map((d: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-border/40 last:border-0 text-sm" data-testid={`dev-row-${i}`}>
                      <div>
                        <span className="font-medium">{d.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{d.publishedAgents} agent{d.publishedAgents !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{d.totalInstalls} installs · ${d.royalties}</div>
                    </div>
                  ))
                  : <p className="text-xs text-muted-foreground">No developer data yet</p>
              }
            </CardContent>
          </Card>
        </TabsContent>

        {/* REVIEWS */}
        <TabsContent value="reviews" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Reviews",    val: reviews?.summary?.totalReviews ?? "—" },
              { label: "Avg Rating",       val: rvLoading ? "…" : `${reviews?.summary?.avgRating ?? 0} ★` },
              { label: "Review Rate",      val: rvLoading ? "…" : `${reviews?.summary?.conversionRate ?? 0}%` },
              { label: "Quality Score",    val: reviews?.summary?.qualityScore ?? "—" },
            ].map((m, i) => (
              <Card key={i} className="bg-card border-border" data-testid={`review-stat-${i}`}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                  <p className="text-xl font-bold">{m.val}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="h-4 w-4 text-yellow-400" /> Rating Distribution</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {rvLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : reviews?.distribution && [
                { label: "5 ★", val: reviews.distribution.fiveStar },
                { label: "4 ★", val: reviews.distribution.fourStar },
                { label: "3 ★", val: reviews.distribution.threeStar },
                { label: "1-2 ★", val: reviews.distribution.lowStar },
              ].map((r, i) => {
                const total = reviews.summary.totalReviews;
                const pct = total > 0 ? Math.round((r.val / total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="w-8 text-muted-foreground">{r.label}</span>
                    <div className="flex-1 bg-slate-700 rounded h-2 overflow-hidden">
                      <div className="bg-yellow-400 h-2 rounded transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-12 text-right text-muted-foreground">{r.val} ({pct}%)</span>
                  </div>
                );
              })}
              {reviews?.recommendation && (
                <p className="mt-3 text-xs text-muted-foreground border-t border-border/40 pt-3" data-testid="review-recommendation">
                  💡 {reviews.recommendation}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FIRST VALUE */}
        <TabsContent value="firstvalue" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-yellow-400" /> First Value Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {fvLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : firstVal?.milestones && Object.entries(firstVal.milestones).map(([k, v]: [string, any]) => (
                <div key={k} className="flex items-center gap-3" data-testid={`milestone-${k}`}>
                  {v.reached
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    : <AlertCircle className="h-5 w-5 text-slate-500 shrink-0" />}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.reached
                        ? `Reached ${v.minutesAgo ? `${v.minutesAgo} min ago` : ""}`
                        : "Not yet reached"}
                    </p>
                  </div>
                  {v.reached && <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-xs">✓</Badge>}
                </div>
              ))}
              {firstVal?.timeToValueMinutes != null && (
                <div className="mt-4 p-3 rounded-lg bg-muted/40">
                  <p className="text-xs text-muted-foreground">Time to First Value (Install → Execution)</p>
                  <p className="text-lg font-bold text-foreground" data-testid="time-to-value">{firstVal.timeToValueMinutes} min</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXIT CRITERIA */}
        <TabsContent value="exit" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Beta Wave 1 Exit Criteria
                {!scLoading && scorecard && (
                  <span className="ml-auto text-xs text-muted-foreground">{scorecard.metCriteriaCount}/{scorecard.totalCriteria} met</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scLoading ? <p className="text-xs text-muted-foreground">Loading…</p>
                : scorecard?.exitCriteria?.map((c: any, i: number) => (
                  <CriterionRow key={i} criterion={c.criterion} met={c.met} />
                ))}
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-400" /> Liquidity Exit Check</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lqLoading ? <p className="text-xs text-muted-foreground">Loading…</p>
                : liquidity?.exitCriteria && Object.entries(liquidity.exitCriteria).filter(([k]) => k.endsWith("Met")).map(([k, v], i) => {
                  const baseKey = k.replace("Met", "");
                  const target = liquidity.exitCriteria[`${baseKey}Target`];
                  const actual = liquidity.exitCriteria[`${baseKey}Actual`];
                  const label = baseKey.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                  return <CriterionRow key={i} criterion={`${label}: ${actual} / ${target}`} met={v as boolean} />;
                })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
