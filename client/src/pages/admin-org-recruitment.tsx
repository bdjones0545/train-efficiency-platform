import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building, CheckCircle, XCircle, AlertCircle } from "lucide-react";

function n(v: unknown) { return Number(v ?? 0); }
function pct(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0; }

function MetricCard({ label, value, target, color = "text-foreground" }: { label: string; value: number; target: number; color?: string }) {
  const p = Math.min(Math.round((value / target) * 100), 100);
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
          <div className={`h-1 rounded ${p >= 100 ? "bg-emerald-500" : p >= 50 ? "bg-primary" : "bg-muted-foreground"}`} style={{ width: `${p}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">target: {target}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminOrgRecruitment() {
  const { data: audit }   = useQuery<any>({ queryKey: ["/api/platform/adoption-audit"] });
  const { data: w6 }      = useQuery<any>({ queryKey: ["/api/platform/wave6-scorecard"] });
  const { data: kpis }    = useQuery<any>({ queryKey: ["/api/platform/founder-kpis"] });
  const { data: success } = useQuery<any>({ queryKey: ["/api/platform/first-success-stories"] });
  const { data: royalty } = useQuery<any>({ queryKey: ["/api/platform/royalty-readiness"] });
  const { data: valid }   = useQuery<any>({ queryKey: ["/api/platform/wave6-validation"] });

  const realOrgs     = audit?.summary?.realOrgs ?? 0;
  const realInstalls = audit?.summary?.realInstalls ?? 0;
  const realReviews  = audit?.summary?.realReviews ?? 0;

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-org-recruitment">Organization Recruitment</h1>
          <p className="text-sm text-muted-foreground mt-1">Wave 6 KPI — First 10 active organizations</p>
        </div>
        {w6 && (
          <Badge className={`border text-xs font-semibold ${w6.verdict === "Wave 6 Complete" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : w6.verdict === "In Progress" ? "bg-primary/20 text-primary border-primary/30" : "bg-muted/40 text-muted-foreground border-border"}`}>
            {w6.verdict} · {w6.overallScore}/100
          </Badge>
        )}
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Real Organizations" value={realOrgs}     target={10} color={realOrgs >= 10 ? "text-emerald-400" : "text-primary"} />
        <MetricCard label="Real Installs"      value={realInstalls} target={25} color={realInstalls >= 25 ? "text-emerald-400" : "text-primary"} />
        <MetricCard label="Real Reviews"       value={realReviews}  target={10} color={realReviews >= 10 ? "text-emerald-400" : "text-primary"} />
        <MetricCard label="Revenue Events"     value={audit?.summary?.realRevenue ?? 0} target={1} color={n(audit?.summary?.realRevenue) >= 1 ? "text-emerald-400" : "text-red-400"} />
      </div>

      <Tabs defaultValue="audit">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="audit"    className="text-xs" data-testid="tab-audit">Adoption Audit</TabsTrigger>
          <TabsTrigger value="royalty"  className="text-xs" data-testid="tab-royalty">Royalty Loop</TabsTrigger>
          <TabsTrigger value="stories"  className="text-xs" data-testid="tab-stories">Success Stories</TabsTrigger>
          <TabsTrigger value="scorecard"className="text-xs" data-testid="tab-w6-scorecard">Wave 6 Score</TabsTrigger>
          <TabsTrigger value="validation"className="text-xs" data-testid="tab-w6-validation">Validation</TabsTrigger>
        </TabsList>

        {/* ADOPTION AUDIT */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Marketplace Reality Check</p>
            <p className={`text-lg font-bold ${audit?.marketplaceIsReal ? "text-emerald-400" : "text-red-400"}`}>
              {audit?.marketplaceIsReal ? "Real external activity detected" : "No real external activity yet — all data is seeded"}
            </p>
          </div>
          {(audit?.metrics ?? []).map((m: any, i: number) => (
            <div key={i} className="flex items-center gap-4 py-2.5 border-b border-border/40 last:border-0" data-testid={`audit-row-${i}`}>
              <div className="w-36 shrink-0">
                <p className="text-sm text-foreground font-medium">{m.label}</p>
              </div>
              <div className="flex-1 grid grid-cols-3 gap-4 text-center">
                <div><p className="text-base font-bold text-foreground">{m.total}</p><p className="text-xs text-muted-foreground">Total</p></div>
                <div><p className={`text-base font-bold ${m.real > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{m.real}</p><p className="text-xs text-muted-foreground">Real</p></div>
                <div><p className="text-base font-bold text-yellow-400">{m.seeded}</p><p className="text-xs text-muted-foreground">Seeded</p></div>
              </div>
              <div className="w-6 shrink-0">
                {m.real > 0 ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* ROYALTY READINESS */}
        <TabsContent value="royalty" className="mt-4 space-y-4">
          {royalty && (
            <>
              <div className={`p-4 rounded-lg border ${royalty.isReady ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/30 border-border"}`}>
                <p className="text-sm font-bold text-foreground">{royalty.isReady ? "✓ First royalty has been paid" : "Royalty Loop Not Yet Complete"}</p>
                <p className="text-sm text-muted-foreground mt-1">{royalty.projectedFirstRoyalty}</p>
                <p className="text-xs text-muted-foreground mt-1">Next step: {royalty.nextStep}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Card className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">Requirements Met</p><p className="text-2xl font-bold text-primary">{royalty.metCount}/{royalty.totalRequirements}</p></CardContent></Card>
                <Card className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pending Royalties</p><p className="text-2xl font-bold text-foreground">{royalty.pendingCount}</p></CardContent></Card>
                <Card className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pending Amount</p><p className="text-2xl font-bold text-foreground">${royalty.pendingAmount}</p></CardContent></Card>
              </div>
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Requirements</CardTitle></CardHeader>
                <CardContent>
                  {(royalty.requirements ?? []).map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0" data-testid={`royalty-req-${i}`}>
                      {r.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" /> : <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <span className="text-sm text-muted-foreground flex-1">{r.requirement}</span>
                      <span className={`text-sm font-bold ${r.met ? "text-emerald-400" : "text-muted-foreground"}`}>{r.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* SUCCESS STORIES */}
        <TabsContent value="stories" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[["Total Candidates", success?.candidates?.length ?? 0, "text-foreground"], ["Verified", success?.verified ?? 0, "text-emerald-400"], ["Ready to Publish", success?.readyToPublish ?? 0, "text-primary"]].map(([l, v, c]) => (
              <Card key={String(l)} className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{l}</p><p className={`text-2xl font-bold ${c}`}>{String(v)}</p></CardContent></Card>
            ))}
          </div>
          {(success?.candidates ?? []).length === 0
            ? <p className="text-sm text-muted-foreground text-center py-8">No external success story candidates yet.</p>
            : (success?.candidates ?? []).map((c: any, i: number) => (
              <Card key={i} className="bg-card border-border" data-testid={`story-${i}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{c.agentName ?? c.agentId}</p>
                      <Badge className={`text-xs border-0 ${c.status === "verified" ? "bg-emerald-500/20 text-emerald-400" : c.status === "candidate" ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"}`}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.developerId}</p>
                  </div>
                  <div className="flex gap-4 text-center shrink-0">
                    {[["Installs", c.installs], ["Reviews", c.reviews], ["Rating", c.avgRating ? c.avgRating.toFixed(1) : "—"], ["Earned", `$${c.earned}`]].map(([l, v]) => (
                      <div key={String(l)}><p className="text-sm font-bold text-foreground">{String(v)}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* WAVE 6 SCORECARD */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {w6 && Object.entries(w6.metrics ?? {}).map(([k, v]: [string, any]) => {
              const p = Math.min(Math.round((v.actual / v.target) * 100), 100);
              return (
                <Card key={k} className="bg-card border-border" data-testid={`w6-metric-${k}`}>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                    <p className={`text-xl font-bold ${p >= 100 ? "text-emerald-400" : p >= 50 ? "text-primary" : "text-foreground"}`}>{v.actual}</p>
                    <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
                      <div className={`h-1 rounded ${p >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${p}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">/ {v.target}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center justify-between">Exit Criteria{w6 && <Badge className="border-0 bg-primary/20 text-primary text-xs">{w6.metCriteriaCount}/{w6.totalCriteria} met</Badge>}</CardTitle></CardHeader>
            <CardContent>
              {(w6?.exitCriteria ?? []).map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                  {c.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="text-sm text-muted-foreground">{c.criterion}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* WAVE 6 VALIDATION */}
        <TabsContent value="validation" className="mt-4 space-y-4">
          {valid && (
            <>
              <div className={`p-4 rounded-lg border ${valid.verdict === "Strongly Validated" ? "bg-emerald-500/5 border-emerald-500/30" : valid.verdict === "Validated" ? "bg-blue-500/5 border-blue-500/30" : valid.verdict === "Partially Validated" ? "bg-yellow-500/5 border-yellow-500/30" : "bg-muted/30 border-border"}`}>
                <p className="text-lg font-bold text-foreground">{valid.verdict}</p>
                <p className="text-sm text-muted-foreground mt-1">{valid.metCount}/{valid.totalChecks} checks passed</p>
                <p className={`text-xs mt-1 font-medium ${valid.marketplaceIsReal ? "text-emerald-400" : "text-red-400"}`}>{valid.marketplaceIsReal ? "Marketplace activity is real" : "No real marketplace activity detected yet"}</p>
              </div>
              {valid.checks.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`w6-check-${i}`}>
                  {c.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="text-sm text-muted-foreground flex-1">{c.question}</span>
                  <span className="text-xs text-muted-foreground">{c.evidence}</span>
                </div>
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
