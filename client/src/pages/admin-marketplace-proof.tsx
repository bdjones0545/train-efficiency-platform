import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Shield, Zap } from "lucide-react";

function n(v: unknown) { return Number(v ?? 0); }

function RealBadge({ value }: { value: number }) {
  return value > 0
    ? <Badge className="border-0 bg-emerald-500/20 text-emerald-400 text-xs">Real: {value}</Badge>
    : <Badge className="border-0 bg-muted/40 text-muted-foreground text-xs">None yet</Badge>;
}

export default function AdminMarketplaceProof() {
  const { data: audit }    = useQuery<any>({ queryKey: ["/api/platform/adoption-audit"] });
  const { data: hof }      = useQuery<any>({ queryKey: ["/api/community/hall-of-fame-expansion"] });
  const { data: readiness} = useQuery<any>({ queryKey: ["/api/platform/readiness"] });
  const { data: txns }     = useQuery<any>({ queryKey: ["/api/platform/transactions"] });
  const { data: royProof } = useQuery<any>({ queryKey: ["/api/platform/royalty-proof"] });
  const { data: valid }    = useQuery<any>({ queryKey: ["/api/platform/wave6-validation"] });

  const statusColor = (s: string) =>
    s === "Validated" || s === "Strongly Validated" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : s === "Active" || s === "Partially Validated" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : s === "Emerging" || s === "Early" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

  const summary = audit?.summary ?? {};

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-marketplace-proof">Marketplace Proof</h1>
          <p className="text-sm text-muted-foreground mt-1">Single source of truth — real activity only, no seeded data</p>
        </div>
        <div className="flex items-center gap-2">
          {readiness && <Badge className={`border text-xs font-semibold ${statusColor(readiness.status)}`}>{readiness.status} · {readiness.score}/100</Badge>}
          {valid && <Badge className={`border text-xs font-semibold ${statusColor(valid.verdict)}`}>{valid.verdict}</Badge>}
        </div>
      </div>

      {/* Reality strip */}
      <div className={`p-4 rounded-lg border flex items-center gap-4 ${audit?.marketplaceIsReal ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
        {audit?.marketplaceIsReal
          ? <CheckCircle className="h-6 w-6 text-emerald-400 shrink-0" />
          : <XCircle className="h-6 w-6 text-red-400 shrink-0" />
        }
        <div>
          <p className="text-base font-bold text-foreground">
            {audit?.marketplaceIsReal ? "Real external marketplace activity confirmed" : "No real external activity yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {audit?.marketplaceIsReal
              ? `${n(summary.realDevs)} developers · ${n(summary.realInstalls)} installs · ${n(summary.realReviews)} reviews · ${n(summary.realRevenue)} revenue events`
              : "All current data comes from seeded/test entries. Waiting for first external participant."}
          </p>
        </div>
      </div>

      {/* Real activity stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Real Devs",     val: n(summary.realDevs),      target: 5  },
          { label: "Real Orgs",     val: n(summary.realOrgs),      target: 10 },
          { label: "Real Installs", val: n(summary.realInstalls),  target: 25 },
          { label: "Real Reviews",  val: n(summary.realReviews),   target: 10 },
          { label: "Revenue Events",val: n(summary.realRevenue),   target: 1  },
          { label: "Royalties",     val: n(summary.realRoyalties), target: 1  },
        ].map((s, i) => {
          const p = Math.min(Math.round((s.val / s.target) * 100), 100);
          return (
            <Card key={i} className="bg-card border-border" data-testid={`proof-metric-${i}`}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.val >= s.target ? "text-emerald-400" : s.val > 0 ? "text-primary" : "text-muted-foreground"}`}>{s.val}</p>
                <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
                  <div className={`h-1 rounded ${s.val >= s.target ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${p}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">/ {s.target}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="milestones">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="milestones"  className="text-xs" data-testid="tab-proof-milestones">External Milestones</TabsTrigger>
          <TabsTrigger value="installs"    className="text-xs" data-testid="tab-proof-installs">Real Installs</TabsTrigger>
          <TabsTrigger value="revenue"     className="text-xs" data-testid="tab-proof-revenue">Revenue</TabsTrigger>
          <TabsTrigger value="royalties"   className="text-xs" data-testid="tab-proof-royalties">Royalties</TabsTrigger>
          <TabsTrigger value="readiness"   className="text-xs" data-testid="tab-proof-readiness">Readiness</TabsTrigger>
        </TabsList>

        {/* EXTERNAL MILESTONES */}
        <TabsContent value="milestones" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(hof?.expansionMilestones ?? []).map((m: any, i: number) => (
              <Card key={i} className={`bg-card border ${m.met ? "border-emerald-500/30" : "border-border opacity-60"}`} data-testid={`ext-milestone-${i}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{m.icon}</div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-foreground">{m.title}</p>
                      {m.met ? (
                        <>
                          <p className="text-sm text-emerald-400 font-medium mt-0.5">{m.recipient}</p>
                          {m.detail && <p className="text-xs text-muted-foreground mt-0.5">{m.detail}</p>}
                          {m.date && <p className="text-xs text-muted-foreground mt-0.5">{new Date(m.date).toLocaleDateString()}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1 italic">Not yet claimed</p>
                      )}
                    </div>
                    {m.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" /> : <div className="w-4 h-4 rounded-full border border-muted-foreground/30" />}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* REAL INSTALLS */}
        <TabsContent value="installs" className="mt-4 space-y-3">
          {(txns?.installs ?? []).filter((i: any) => !["TrainEfficiency"].includes(i.orgId)).length === 0
            ? (
              <div className="text-center py-12">
                <Zap className="h-8 w-8 mx-auto text-muted-foreground opacity-40 mb-2" />
                <p className="text-sm text-muted-foreground">No real external installs yet.</p>
              </div>
            )
            : (txns?.installs ?? []).filter((i: any) => !["TrainEfficiency"].includes(i.orgId)).map((inst: any, i: number) => (
              <Card key={i} className="bg-card border-border" data-testid={`real-install-${i}`}>
                <CardContent className="p-3 flex items-center gap-4">
                  <Zap className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{inst.agentName ?? inst.agentId}</p>
                    <p className="text-xs text-muted-foreground">{inst.orgId}</p>
                  </div>
                  <div className="text-right">
                    <Badge className="border-0 bg-emerald-500/20 text-emerald-400 text-xs">{inst.status}</Badge>
                    <p className="text-xs text-muted-foreground mt-0.5">{inst.at ? new Date(inst.at).toLocaleDateString() : ""}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* REVENUE */}
        <TabsContent value="revenue" className="mt-4 space-y-3">
          {(txns?.revenueEvents ?? []).filter((e: any) => e.orgId !== "TrainEfficiency").length === 0
            ? <p className="text-sm text-muted-foreground text-center py-12">No real revenue events yet.</p>
            : (txns?.revenueEvents ?? []).filter((e: any) => e.orgId !== "TrainEfficiency").map((ev: any, i: number) => (
              <Card key={i} className="bg-card border-border" data-testid={`real-rev-${i}`}>
                <CardContent className="p-3 flex items-center gap-4">
                  <div className="flex-1"><p className="text-sm font-medium text-foreground">{ev.type}</p><p className="text-xs text-muted-foreground">{ev.orgId}</p></div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400">${n(ev.value)}</p>
                    <Badge className={`border-0 text-xs mt-0.5 ${ev.status === "converted" ? "bg-emerald-500/20 text-emerald-400" : "bg-muted/40 text-muted-foreground"}`}>{ev.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* ROYALTIES */}
        <TabsContent value="royalties" className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[["Total Events", royProof?.totals?.events ?? 0], ["Paid Out", royProof?.totals?.paidCount ?? 0], ["Total Developer", `$${royProof?.totals?.developerTotal ?? 0}`]].map(([l, v]) => (
              <Card key={String(l)} className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold text-foreground">{String(v)}</p></CardContent></Card>
            ))}
          </div>
          {(royProof?.events ?? []).filter((e: any) => e.developer !== "TrainEfficiency").length === 0
            ? <p className="text-sm text-muted-foreground text-center py-8">No external royalties yet. First royalty will appear here.</p>
            : (royProof?.events ?? []).filter((e: any) => e.developer !== "TrainEfficiency").map((r: any, i: number) => (
              <Card key={i} className="bg-card border-border" data-testid={`royalty-proof-${i}`}>
                <CardContent className="p-3 flex items-center gap-4">
                  <Shield className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{r.agent}</p>
                    <p className="text-xs text-muted-foreground">{r.developer}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400">${r.developerShare}</p>
                    <Badge className={`border-0 text-xs ${r.status === "paid" ? "bg-emerald-500/20 text-emerald-400" : "bg-yellow-500/20 text-yellow-400"}`}>{r.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* READINESS */}
        <TabsContent value="readiness" className="mt-4 space-y-4">
          {readiness && (
            <>
              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="text-center px-4">
                  <p className="text-5xl font-bold text-primary">{readiness.score}</p>
                  <p className="text-xs text-muted-foreground mt-1">/ 100</p>
                </div>
                <div className="flex-1">
                  <p className="text-xl font-bold text-foreground">{readiness.status}</p>
                  <p className="text-sm text-muted-foreground">Wave 6 target: 50+</p>
                  <div className="flex gap-1 flex-wrap mt-2">
                    {(readiness.lowestComponents ?? []).map((c: string) => (
                      <Badge key={c} className="text-xs border-0 bg-red-500/20 text-red-400">{c}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(readiness.components ?? {}).map(([k, v]: [string, any]) => (
                  <Card key={k} className="bg-card border-border" data-testid={`readiness-comp-${k}`}>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                      <p className={`text-xl font-bold ${n(v) >= 50 ? "text-emerald-400" : n(v) >= 25 ? "text-yellow-400" : "text-red-400"}`}>{n(v)}</p>
                      <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
                        <div className={`h-1 rounded ${n(v) >= 50 ? "bg-emerald-500" : n(v) >= 25 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${n(v)}%` }} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
