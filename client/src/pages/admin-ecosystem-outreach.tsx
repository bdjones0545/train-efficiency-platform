import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Plus, Users, Zap, Trophy, ArrowRight, Target } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function n(v: unknown) { return Number(v ?? 0); }
function pct(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0; }

function FunnelBar({ stage, count, rate }: { stage: string; count: number; rate: number }) {
  return (
    <div className="flex items-center gap-3 py-2" data-testid={`funnel-${stage.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="w-40 shrink-0 text-xs text-muted-foreground truncate">{stage}</div>
      <div className="flex-1 h-6 bg-slate-800 rounded overflow-hidden relative">
        <div className="h-6 bg-primary/30 rounded" style={{ width: `${Math.max(rate, 2)}%` }} />
        <span className="absolute left-2 top-0.5 text-xs text-foreground font-medium">{count}</span>
      </div>
      <span className="w-10 text-right text-xs text-muted-foreground">{rate}%</span>
    </div>
  );
}

function CampaignForm({ endpoint, invalidateKey, onClose }: { endpoint: string; invalidateKey: string; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", audience: "", channel: "email" });
  const mutation = useMutation({
    mutationFn: (d: typeof form) => apiRequest("POST", endpoint, d),
    onSuccess: () => { toast({ title: "Campaign created" }); queryClient.invalidateQueries({ queryKey: [invalidateKey] }); onClose(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-2">
      {[{ key: "name", label: "Campaign Name" }, { key: "audience", label: "Target Audience" }].map(f => (
        <div key={f.key}>
          <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
          <Input value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label} data-testid={`input-campaign-${f.key}`} />
        </div>
      ))}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Channel</label>
        <Select value={form.channel} onValueChange={v => setForm(p => ({ ...p, channel: v }))}>
          <SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["email", "linkedin", "twitter", "direct", "referral"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={mutation.isPending} onClick={() => mutation.mutate(form)} data-testid="btn-create-campaign">
        {mutation.isPending ? "Creating…" : "Create Campaign"}
      </Button>
    </div>
  );
}

export default function AdminEcosystemOutreach() {
  const { data: outreach } = useQuery<any>({ queryKey: ["/api/platform/ecosystem-outreach"] });
  const { data: devCamps } = useQuery<any[]>({ queryKey: ["/api/campaigns/developer"] });
  const { data: orgCamps } = useQuery<any[]>({ queryKey: ["/api/campaigns/org"] });
  const { data: friction } = useQuery<any>({ queryKey: ["/api/platform/friction"] });
  const { data: score }    = useQuery<any>({ queryKey: ["/api/platform/activation-score"] });
  const { data: w4score }  = useQuery<any>({ queryKey: ["/api/platform/wave4-scorecard"] });
  const { data: validation}= useQuery<any>({ queryKey: ["/api/platform/marketplace-validation"] });
  const [devOpen, setDevOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);

  const t = outreach?.totals ?? {};
  const verdictColor = (v: string) => v === "Validated" || v === "Wave 4 Complete" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : v === "Active" || v === "Nearly There" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : v === "Emerging" || v === "In Progress" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-outreach">Ecosystem Outreach Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Wave 4 — Activation, Distribution & First Transactions</p>
        </div>
        <div className="flex items-center gap-3">
          {score && <Badge className={`border text-xs font-semibold ${verdictColor(score.status)}`}>{score.status} · {score.score}/100</Badge>}
          {validation && <Badge className={`border text-xs font-semibold ${verdictColor(validation.verdict)}`}>{validation.verdict}</Badge>}
        </div>
      </div>

      {/* Quick metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Devs Onboarded",  val: n(t.devsOnboarded),   target: 5,  color: "text-primary" },
          { label: "Agents Published",val: n(t.agentsPublished),  target: 10, color: "text-emerald-400" },
          { label: "Orgs Activated",  val: n(t.orgsActivated),    target: 10, color: "text-primary" },
          { label: "Installations",   val: n(t.installations),    target: 25, color: "text-yellow-400" },
          { label: "Revenue Events",  val: n(t.revenueEvents),    target: 1,  color: n(t.revenueEvents) >= 1 ? "text-emerald-400" : "text-red-400" },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`outreach-metric-${i}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
              <div className="mt-1.5 h-1 rounded bg-slate-700 overflow-hidden">
                <div className="h-1 rounded bg-primary transition-all" style={{ width: `${Math.min(pct(s.val, s.target), 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">/ {s.target}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="funnels">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="funnels"    className="text-xs" data-testid="tab-funnels">Funnels</TabsTrigger>
          <TabsTrigger value="campaigns"  className="text-xs" data-testid="tab-campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="friction"   className="text-xs" data-testid="tab-friction">Friction</TabsTrigger>
          <TabsTrigger value="validation" className="text-xs" data-testid="tab-validation">Validation</TabsTrigger>
          <TabsTrigger value="scorecard"  className="text-xs" data-testid="tab-scorecard">Wave 4 Score</TabsTrigger>
          <TabsTrigger value="activation" className="text-xs" data-testid="tab-activation">Activation Score</TabsTrigger>
        </TabsList>

        {/* FUNNELS */}
        <TabsContent value="funnels" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Developer Funnel</CardTitle></CardHeader>
            <CardContent>
              {(outreach?.developerFunnel ?? []).map((s: any) => <FunnelBar key={s.stage} stage={s.stage} count={s.count} rate={s.rate} />)}
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-yellow-400" /> Organization Funnel</CardTitle></CardHeader>
            <CardContent>
              {(outreach?.organizationFunnel ?? []).map((s: any) => <FunnelBar key={s.stage} stage={s.stage} count={s.count} rate={s.rate} />)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CAMPAIGNS */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Developer campaigns */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Developer Campaigns</h3>
                <Dialog open={devOpen} onOpenChange={setDevOpen}>
                  <DialogTrigger asChild><Button size="sm" className="gap-1" data-testid="btn-new-dev-campaign"><Plus className="h-3.5 w-3.5" /> New</Button></DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Developer Campaign</DialogTitle></DialogHeader>
                    <CampaignForm endpoint="/api/campaigns/developer" invalidateKey="/api/campaigns/developer" onClose={() => setDevOpen(false)} />
                  </DialogContent>
                </Dialog>
              </div>
              {(devCamps ?? []).length === 0
                ? <p className="text-sm text-muted-foreground py-4 text-center">No campaigns yet</p>
                : (devCamps ?? []).map((c: any) => (
                  <Card key={c.id} className="bg-card border-border" data-testid={`dev-camp-${c.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{c.name}</p>
                        <Badge className="text-xs border-0 bg-primary/20 text-primary">{c.channel}</Badge>
                      </div>
                      {c.audience && <p className="text-xs text-muted-foreground mb-2">{c.audience}</p>}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[["Sent", c.messages_sent], ["Responded", c.responses], ["Registered", c.registrations]].map(([l, v]) => (
                          <div key={String(l)}><p className="text-base font-bold text-foreground">{n(v)}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              }
            </div>
            {/* Org campaigns */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Organization Campaigns</h3>
                <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
                  <DialogTrigger asChild><Button size="sm" className="gap-1" data-testid="btn-new-org-campaign"><Plus className="h-3.5 w-3.5" /> New</Button></DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Org Campaign</DialogTitle></DialogHeader>
                    <CampaignForm endpoint="/api/campaigns/org" invalidateKey="/api/campaigns/org" onClose={() => setOrgOpen(false)} />
                  </DialogContent>
                </Dialog>
              </div>
              {(orgCamps ?? []).length === 0
                ? <p className="text-sm text-muted-foreground py-4 text-center">No campaigns yet</p>
                : (orgCamps ?? []).map((c: any) => (
                  <Card key={c.id} className="bg-card border-border" data-testid={`org-camp-${c.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{c.name}</p>
                        <Badge className="text-xs border-0 bg-yellow-500/20 text-yellow-400">{c.channel}</Badge>
                      </div>
                      {c.audience && <p className="text-xs text-muted-foreground mb-2">{c.audience}</p>}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[["Invited", c.invitations], ["Activated", c.activations], ["Installed", c.installs]].map(([l, v]) => (
                          <div key={String(l)}><p className="text-base font-bold text-foreground">{n(v)}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              }
            </div>
          </div>
        </TabsContent>

        {/* FRICTION */}
        <TabsContent value="friction" className="mt-4 space-y-4">
          {friction?.topPriority && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-400">Top Priority: {friction.topPriority.stage}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{friction.topPriority.fix}</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Developer Friction Points</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(friction?.developerFrictions ?? []).map((f: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-muted/30" data-testid={`dev-friction-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground font-medium">{f.stage}</span>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs font-bold ${f.count > 3 ? "text-red-400" : "text-yellow-400"}`}>{f.count}</span>
                        <Badge className={`text-xs border-0 ${f.priority === "high" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>{f.priority}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{f.fix}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Organization Friction Points</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(friction?.organizationFrictions ?? []).map((f: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-muted/30" data-testid={`org-friction-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground font-medium">{f.stage}</span>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs font-bold ${f.count > 3 ? "text-red-400" : "text-yellow-400"}`}>{f.count}</span>
                        <Badge className={`text-xs border-0 ${f.priority === "high" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>{f.priority}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{f.fix}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* VALIDATION */}
        <TabsContent value="validation" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Marketplace Activity Audit
                {validation && (
                  <Badge className={`ml-auto border text-xs ${verdictColor(validation.verdict)}`}>{validation.verdict}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(validation?.checks ?? []).map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`validation-check-${i}`}>
                  <span className={`text-base ${c.met ? "text-emerald-400" : "text-muted-foreground"}`}>{c.met ? "✓" : "○"}</span>
                  <span className="text-sm text-muted-foreground flex-1">{c.question}</span>
                  <span className={`text-sm font-bold ${c.met ? "text-emerald-400" : "text-muted-foreground"}`}>{c.value}</span>
                </div>
              ))}
              {validation && (
                <div className="mt-3 p-3 rounded-lg bg-muted/30 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{validation.metCount}/{validation.totalChecks} checks passed</span>
                  <span className="text-sm font-bold text-foreground">{validation.marketplaceExists ? "Marketplace activity detected" : "No marketplace activity yet"}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* WAVE 4 SCORECARD */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {w4score && Object.entries(w4score.metrics ?? {}).map(([k, v]: [string, any]) => {
              const p = Math.min(Math.round((v.actual / v.target) * 100), 100);
              const col = p >= 100 ? "text-emerald-400" : p >= 50 ? "text-yellow-400" : "text-red-400";
              return (
                <Card key={k} className="bg-card border-border" data-testid={`w4-metric-${k}`}>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</p>
                    <p className={`text-xl font-bold ${col}`}>{v.actual}</p>
                    <p className="text-xs text-muted-foreground">/ {v.target}</p>
                    <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
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
                Exit Criteria — {w4score?.metCriteriaCount ?? 0}/{w4score?.totalCriteria ?? 10} met
                {w4score?.verdict && <Badge className={`ml-auto border text-xs ${verdictColor(w4score.verdict)}`}>{w4score.verdict}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {w4score?.exitCriteria?.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0" data-testid={`w4-exit-${i}`}>
                  <span className={`text-sm ${c.met ? "text-emerald-400" : "text-muted-foreground"}`}>{c.met ? "✓" : "○"}</span>
                  <span className="text-sm text-muted-foreground">{c.criterion}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACTIVATION SCORE */}
        <TabsContent value="activation" className="mt-4 space-y-4">
          {score && (
            <>
              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="text-center px-4">
                  <p className="text-5xl font-bold text-primary">{score.score}</p>
                  <p className="text-sm text-muted-foreground mt-1">/ 100</p>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold text-foreground">{score.status}</p>
                    <Badge className={`border text-sm font-bold ${verdictColor(score.status)}`}>{score.grade}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Wave 4 target: 50+</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(score.weakestAreas ?? []).map((a: string) => (
                      <Badge key={a} className="text-xs border-0 bg-red-500/20 text-red-400">{a}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(score.components ?? {}).map(([k, v]: [string, any]) => (
                  <Card key={k} className="bg-card border-border" data-testid={`act-component-${k}`}>
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
