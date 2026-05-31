import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, TrendingUp, Star, Shield, DollarSign, Users, Zap } from "lucide-react";

function n(v: unknown): number { return Number(v ?? 0); }
function fmt(v: unknown): string { const x = n(v); return x >= 1000 ? `$${(x/1000).toFixed(1)}k` : x > 0 ? `$${x}` : "—"; }

function RankBadge({ rank }: { rank: number }) {
  const colors = ["bg-yellow-500 text-black", "bg-slate-300 text-black", "bg-amber-600 text-white"];
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${colors[rank] ?? "bg-slate-700 text-muted-foreground"}`}>
      {rank + 1}
    </div>
  );
}

function AgentRow({ agent, rank, show = "installs" }: { agent: any; rank: number; show?: "installs" | "rating" | "revenue" | "trust" }) {
  const metric = show === "installs" ? { label: "installs", val: n(agent.installs) }
    : show === "rating"   ? { label: "rating",   val: agent.avgRating ?? "—" }
    : show === "revenue"  ? { label: "revenue",  val: fmt(agent.revenue) }
    : { label: "trust",   val: n(agent.trustScore) };
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`agent-row-${rank}`}>
      <RankBadge rank={rank} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{agent.name ?? agent.agentId}</p>
        {agent.roi != null && agent.roi > 0 && <p className="text-xs text-muted-foreground">ROI: {n(agent.roi)}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-primary">{String(metric.val)}</p>
        <p className="text-xs text-muted-foreground">{metric.label}</p>
      </div>
    </div>
  );
}

function DevRow({ dev, rank }: { dev: any; rank: number }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`dev-row-${rank}`}>
      <RankBadge rank={rank} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{dev.developerId}</p>
        <p className="text-xs text-muted-foreground">{n(dev.agentsPublished)} agents · {n(dev.totalInstalls)} installs · {n(dev.totalReviews)} reviews</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-emerald-400">{fmt(dev.lifetimeEarned)}</p>
        <p className="text-xs text-muted-foreground">earned</p>
      </div>
    </div>
  );
}

export default function AdminAgentEconomy() {
  const { data: lb }          = useQuery<any>({ queryKey: ["/api/platform/agent-economy-leaderboard"] });
  const { data: devAct }      = useQuery<any>({ queryKey: ["/api/developer/activation"] });
  const { data: orgAct }      = useQuery<any>({ queryKey: ["/api/org/activation"] });
  const { data: candidates }  = useQuery<any>({ queryKey: ["/api/platform/success-story-candidates"] });
  const { data: revProof }    = useQuery<any>({ queryKey: ["/api/platform/revenue-proof"] });

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-economy">
            Agent Economy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Leaderboard · Developer Activation · Revenue Attribution</p>
        </div>
        <div className="flex items-center gap-3">
          {devAct && <Badge className="border border-primary/30 bg-primary/10 text-primary text-xs">{n(devAct.summary?.total)} Developers</Badge>}
          {candidates && <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs">{n(candidates.publishReady)} Publish-Ready Stories</Badge>}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Superstars",    val: devAct?.summary?.superstars ?? 0,   icon: <Trophy className="h-4 w-4 text-yellow-400" /> },
          { label: "Champions",     val: orgAct?.summary?.champions ?? 0,    icon: <Star className="h-4 w-4 text-yellow-400" /> },
          { label: "Verified Stories", val: candidates?.verified ?? 0,       icon: <Shield className="h-4 w-4 text-emerald-400" /> },
          { label: "Revenue Events",val: revProof?.summary?.totalEvents ?? 0,icon: <DollarSign className="h-4 w-4 text-primary" /> },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`economy-summary-${i}`}>
            <CardContent className="p-4 flex items-center gap-3">
              {s.icon}
              <div>
                <p className="text-xl font-bold text-foreground">{s.val}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="leaderboard">
        <TabsList className="grid grid-cols-3 md:grid-cols-5 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="leaderboard"  className="text-xs" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="developers"   className="text-xs" data-testid="tab-developers">Developer Activation</TabsTrigger>
          <TabsTrigger value="orgs"         className="text-xs" data-testid="tab-orgs">Org Activation</TabsTrigger>
          <TabsTrigger value="stories"      className="text-xs" data-testid="tab-stories">Success Candidates</TabsTrigger>
          <TabsTrigger value="revenue"      className="text-xs" data-testid="tab-revenue">Revenue Proof</TabsTrigger>
        </TabsList>

        {/* LEADERBOARD */}
        <TabsContent value="leaderboard" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Top by Installs</CardTitle></CardHeader>
              <CardContent>
                {(lb?.topByInstalls ?? []).map((a: any, i: number) => <AgentRow key={a.agentId} agent={a} rank={i} show="installs" />)}
                {!lb?.topByInstalls?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="h-4 w-4 text-yellow-400" /> Top by Rating</CardTitle></CardHeader>
              <CardContent>
                {(lb?.topByRating ?? []).map((a: any, i: number) => <AgentRow key={a.agentId} agent={a} rank={i} show="rating" />)}
                {!lb?.topByRating?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> Top Revenue Agents</CardTitle></CardHeader>
              <CardContent>
                {(lb?.topByRevenue ?? []).map((a: any, i: number) => <AgentRow key={a.agentId} agent={a} rank={i} show="revenue" />)}
                {!lb?.topByRevenue?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-blue-400" /> Most Trusted</CardTitle></CardHeader>
              <CardContent>
                {(lb?.topByTrust ?? []).map((a: any, i: number) => <AgentRow key={a.agentId} agent={a} rank={i} show="trust" />)}
                {!lb?.topByTrust?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border md:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-yellow-400" /> Highest Royalty Earners</CardTitle></CardHeader>
              <CardContent>
                {(lb?.topDevelopers ?? []).map((d: any, i: number) => <DevRow key={d.developerId} dev={d} rank={i} />)}
                {!lb?.topDevelopers?.length && <p className="text-sm text-muted-foreground text-center py-4">No developers yet</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* DEVELOPER ACTIVATION */}
        <TabsContent value="developers" className="mt-4 space-y-4">
          {devAct && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Devs", val: devAct.summary.total,      color: "text-foreground" },
                { label: "Superstars", val: devAct.summary.superstars,  color: "text-yellow-400" },
                { label: "Active",     val: devAct.summary.active,      color: "text-primary" },
                { label: "Avg Score",  val: devAct.summary.avgScore,    color: "text-muted-foreground" },
              ].map((s, i) => (
                <Card key={i} className="bg-card border-border" data-testid={`dev-summary-${i}`}>
                  <CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-xl font-bold ${s.color}`}>{s.val}</p></CardContent>
                </Card>
              ))}
            </div>
          )}
          {devAct?.biggestDropoff && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm">
              <span className="text-red-400 font-semibold">Biggest drop-off: </span>
              <span className="text-muted-foreground">{devAct.biggestDropoff}</span>
            </div>
          )}
          <div className="space-y-2">
            {(devAct?.developers ?? []).map((d: any) => (
              <Card key={d.developerId} className="bg-card border-border" data-testid={`dev-card-${d.developerId}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${d.tier === "Superstar" ? "bg-yellow-500/20 text-yellow-400" : d.tier === "Active" ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                    {d.activationScore}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.developerId}</p>
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                      {Object.entries(d.milestones).map(([k, v]: [string, any]) => (
                        <span key={k} className={`text-xs ${v ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                          {v ? "✓" : "○"} {k.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Badge className={`text-xs border-0 shrink-0 ${d.tier === "Superstar" ? "bg-yellow-500/20 text-yellow-400" : d.tier === "Active" ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                    {d.tier}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {!devAct?.developers?.length && <p className="text-center text-sm text-muted-foreground py-8">No developers yet</p>}
          </div>
        </TabsContent>

        {/* ORG ACTIVATION */}
        <TabsContent value="orgs" className="mt-4 space-y-4">
          {orgAct && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Orgs",  val: orgAct.summary.total,      color: "text-foreground" },
                { label: "Champions",   val: orgAct.summary.champions,   color: "text-yellow-400" },
                { label: "Active",      val: orgAct.summary.active,      color: "text-primary" },
                { label: "Avg Score",   val: orgAct.summary.avgScore,    color: "text-muted-foreground" },
              ].map((s, i) => (
                <Card key={i} className="bg-card border-border" data-testid={`org-summary-${i}`}>
                  <CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-xl font-bold ${s.color}`}>{s.val}</p></CardContent>
                </Card>
              ))}
            </div>
          )}
          {(orgAct?.frictionPoints ?? []).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {orgAct.frictionPoints.map((fp: any) => (
                <div key={fp.stage} className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20" data-testid={`friction-${fp.stage}`}>
                  <p className="text-xs text-yellow-400 font-semibold">Friction Point</p>
                  <p className="text-sm text-foreground mt-1">{fp.stage}</p>
                  <p className="text-xl font-bold text-yellow-400">{fp.count} orgs stuck</p>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {(orgAct?.organizations ?? []).map((o: any) => (
              <Card key={o.orgId} className="bg-card border-border" data-testid={`org-card-${o.orgId}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${o.tier === "Champion" ? "bg-yellow-500/20 text-yellow-400" : o.tier === "Active" ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                    {o.activationScore}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{o.orgId}</p>
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                      {Object.entries(o.milestones).map(([k, v]: [string, any]) => (
                        <span key={k} className={`text-xs ${v ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                          {v ? "✓" : "○"} {k.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Badge className={`text-xs border-0 shrink-0 ${o.tier === "Champion" ? "bg-yellow-500/20 text-yellow-400" : o.tier === "Active" ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                    {o.tier}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {!orgAct?.organizations?.length && <p className="text-center text-sm text-muted-foreground py-8">No organizations yet</p>}
          </div>
        </TabsContent>

        {/* SUCCESS CANDIDATES */}
        <TabsContent value="stories" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Verified Stories",      val: candidates?.verified ?? 0,            color: "text-emerald-400" },
              { label: "Publish Ready",          val: candidates?.publishReady ?? 0,        color: "text-primary" },
              { label: "Verification Needed",    val: candidates?.verificationNeeded ?? 0,  color: "text-yellow-400" },
            ].map((s, i) => (
              <Card key={i} className="bg-card border-border" data-testid={`story-summary-${i}`}>
                <CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-xl font-bold ${s.color}`}>{s.val}</p></CardContent>
              </Card>
            ))}
          </div>
          <div className="space-y-2">
            {(candidates?.candidates ?? []).map((c: any) => (
              <Card key={c.agentId} className={`border ${c.publishReady ? "border-emerald-500/30 bg-emerald-500/5" : c.readyForCaseStudy ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-card"}`} data-testid={`candidate-${c.agentId}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      <Badge className={`text-xs border-0 shrink-0 ${c.publishReady ? "bg-emerald-500/20 text-emerald-400" : c.readyForCaseStudy ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-700 text-muted-foreground"}`}>
                        {c.status}
                      </Badge>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{c.installs} installs</span>
                      <span>{c.reviews} reviews</span>
                      {c.avgRating && <span>{c.avgRating}★</span>}
                      {c.executions > 0 && <span>{c.executions} execs</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!candidates?.candidates?.length && <p className="text-center text-sm text-muted-foreground py-8">No agents yet</p>}
          </div>
        </TabsContent>

        {/* REVENUE PROOF */}
        <TabsContent value="revenue" className="mt-4 space-y-4">
          <Card className={`border ${n(revProof?.summary?.totalEvents) > 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
            <CardContent className="p-4 flex items-center gap-4">
              <Zap className={`h-8 w-8 shrink-0 ${n(revProof?.summary?.totalEvents) > 0 ? "text-emerald-400" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{revProof?.verdict ?? "Checking…"}</p>
                <p className="text-xs text-muted-foreground mt-1">{n(revProof?.summary?.verifiedEvents)} verified of {n(revProof?.summary?.totalEvents)} events · Total: ${n(revProof?.summary?.totalRevenue)}</p>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {(revProof?.events ?? []).map((e: any) => (
              <Card key={e.id} className="bg-card border-border" data-testid={`rev-event-${e.id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{e.actionType}</p>
                      <Badge className={`text-xs border-0 ${e.verified ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-muted-foreground"}`}>
                        {e.outcomeStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{e.orgId} · {e.timestamp ? new Date(e.timestamp).toLocaleDateString() : "—"}</p>
                  </div>
                  <p className="text-sm font-bold text-primary shrink-0">${n(e.outcomeValue)}</p>
                </CardContent>
              </Card>
            ))}
            {!revProof?.events?.length && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <p>No revenue events yet.</p>
                <p className="mt-1 text-xs">Wave 3 target: ≥1 real revenue event</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
