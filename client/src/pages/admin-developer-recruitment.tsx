import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Users, Target, ArrowRight, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function n(v: unknown) { return Number(v ?? 0); }

const STAGES = ["prospect","contacted","interested","registered","published_agent","generated_install","generated_revenue","generated_royalty"];
const stageLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const stageColor = (s: string) => {
  if (s === "generated_royalty") return "bg-emerald-500/20 text-emerald-400";
  if (s === "generated_revenue") return "bg-blue-500/20 text-blue-400";
  if (s === "generated_install" || s === "published_agent") return "bg-primary/20 text-primary";
  if (s === "registered") return "bg-yellow-500/20 text-yellow-400";
  return "bg-muted/40 text-muted-foreground";
};

function AddDevForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", source: "", industry: "", organization: "", stage: "prospect" });
  const mut = useMutation({
    mutationFn: (d: typeof form) => apiRequest("POST", "/api/developer-pipeline", d),
    onSuccess: () => { toast({ title: "Developer added" }); queryClient.invalidateQueries({ queryKey: ["/api/developer-pipeline"] }); onClose(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });
  const fields = [
    { key: "name", label: "Full Name *" }, { key: "email", label: "Email" },
    { key: "source", label: "Source (e.g. LinkedIn, Referral)" }, { key: "industry", label: "Industry" },
    { key: "organization", label: "Organization" },
  ];
  return (
    <div className="space-y-3 mt-2">
      {fields.map(f => (
        <div key={f.key}>
          <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
          <Input value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label} data-testid={`input-dev-${f.key}`} />
        </div>
      ))}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Starting Stage</label>
        <Select value={form.stage} onValueChange={v => setForm(p => ({ ...p, stage: v }))}>
          <SelectTrigger data-testid="select-dev-stage"><SelectValue /></SelectTrigger>
          <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={!form.name || mut.isPending} onClick={() => mut.mutate(form)} data-testid="btn-add-dev">
        {mut.isPending ? "Adding…" : "Add Developer"}
      </Button>
    </div>
  );
}

function MoveStageDialog({ dev, onClose }: { dev: any; onClose: () => void }) {
  const { toast } = useToast();
  const [stage, setStage] = useState(dev.stage);
  const [nextAction, setNextAction] = useState(dev.nextAction ?? "");
  const mut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/developer-pipeline/${dev.id}`, { stage, next_action: nextAction, last_touch: new Date().toISOString() }),
    onSuccess: () => { toast({ title: "Updated" }); queryClient.invalidateQueries({ queryKey: ["/api/developer-pipeline"] }); onClose(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-2">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Stage</label>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Next Action</label>
        <Input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. Schedule intro call" data-testid="input-next-action" />
      </div>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()} data-testid="btn-update-dev">
        {mut.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export default function AdminDeveloperRecruitment() {
  const { data: pipeline } = useQuery<any>({ queryKey: ["/api/platform/developer-success"] });
  const { data: raw }      = useQuery<any[]>({ queryKey: ["/api/developer-pipeline"] });
  const { data: ambassadors } = useQuery<any[]>({ queryKey: ["/api/marketplace-ambassadors"] });
  const { data: kpis }     = useQuery<any>({ queryKey: ["/api/platform/founder-kpis"] });
  const [addOpen, setAddOpen] = useState(false);
  const [editDev, setEditDev] = useState<any>(null);

  const devKpi = kpis?.kpis?.find((k: any) => k.label === "Developers Registered");
  const progress = kpis?.overallProgress ?? 0;

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-dev-recruitment">Developer Recruitment</h1>
          <p className="text-sm text-muted-foreground mt-1">Wave 6 KPI — First 5 external developers</p>
        </div>
        <div className="flex items-center gap-3">
          {devKpi && (
            <Badge className={`border text-xs font-semibold ${n(devKpi.value) >= devKpi.target ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}`}>
              {n(devKpi.value)}/{devKpi.target} registered
            </Badge>
          )}
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1" data-testid="btn-open-add-dev"><Plus className="h-3.5 w-3.5" /> Add Developer</Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Add Developer to Pipeline</DialogTitle></DialogHeader>
              <AddDevForm onClose={() => setAddOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Progress bar */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">Wave 6 Overall Progress</p>
            <span className="text-sm font-bold text-primary">{progress}%</span>
          </div>
          <div className="h-3 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-3 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="pipeline">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="pipeline"    className="text-xs" data-testid="tab-dev-pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="funnel"      className="text-xs" data-testid="tab-dev-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="ambassadors" className="text-xs" data-testid="tab-ambassadors">Ambassadors</TabsTrigger>
          <TabsTrigger value="kpis"        className="text-xs" data-testid="tab-founder-kpis">KPIs</TabsTrigger>
        </TabsList>

        {/* PIPELINE */}
        <TabsContent value="pipeline" className="mt-4 space-y-3">
          {/* Stage columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {STAGES.slice(0, 4).map(s => {
              const count = (raw ?? []).filter(d => d.stage === s).length;
              return (
                <Card key={s} className="bg-card border-border" data-testid={`stage-col-${s}`}>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground mb-1">{stageLabel(s)}</p>
                    <p className="text-2xl font-bold text-foreground">{count}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {(raw ?? []).length === 0
            ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No developers in pipeline yet.</p>
                <p className="text-xs mt-1">Add the first developer to get started.</p>
              </div>
            )
            : (raw ?? []).map((dev: any) => (
              <Card key={dev.id} className="bg-card border-border" data-testid={`dev-row-${dev.id}`}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{dev.name}</p>
                      <Badge className={`text-xs border-0 ${stageColor(dev.stage)}`}>{stageLabel(dev.stage)}</Badge>
                    </div>
                    {dev.email && <p className="text-xs text-muted-foreground mt-0.5">{dev.email}</p>}
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {dev.source && <span className="text-xs text-muted-foreground">Source: {dev.source}</span>}
                      {dev.industry && <span className="text-xs text-muted-foreground">· {dev.industry}</span>}
                      {dev.organization && <span className="text-xs text-muted-foreground">· {dev.organization}</span>}
                    </div>
                    {dev.next_action && (
                      <div className="flex items-center gap-1 mt-1">
                        <ArrowRight className="h-3 w-3 text-primary" />
                        <p className="text-xs text-primary">{dev.next_action}</p>
                      </div>
                    )}
                    {!dev.next_action && ["prospect","contacted"].includes(dev.stage) && (
                      <div className="flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 text-yellow-400" />
                        <p className="text-xs text-yellow-400">No next action defined</p>
                      </div>
                    )}
                  </div>
                  <Dialog open={editDev?.id === dev.id} onOpenChange={open => setEditDev(open ? dev : null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" data-testid={`btn-edit-dev-${dev.id}`}>Update</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm">
                      <DialogHeader><DialogTitle>Update: {dev.name}</DialogTitle></DialogHeader>
                      {editDev?.id === dev.id && <MoveStageDialog dev={dev} onClose={() => setEditDev(null)} />}
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* FUNNEL */}
        <TabsContent value="funnel" className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Total in Pipeline", val: pipeline?.total ?? 0, color: "text-foreground" },
              { label: "Active",            val: pipeline?.active ?? 0,  color: "text-primary" },
              { label: "Blocked",           val: pipeline?.blocked ?? 0, color: "text-yellow-400" },
              { label: "Earners",           val: pipeline?.earners ?? 0, color: "text-emerald-400" },
            ].map((s, i) => (
              <Card key={i} className="bg-card border-border"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-2xl font-bold ${s.color}`}>{s.val}</p></CardContent></Card>
            ))}
          </div>
          {(pipeline?.funnel ?? []).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-3" data-testid={`dev-funnel-${i}`}>
              <span className="text-xs text-muted-foreground w-36 shrink-0">{f.stage}</span>
              <div className="flex-1 h-6 bg-slate-800 rounded overflow-hidden relative">
                <div className="h-6 bg-primary/30 rounded" style={{ width: `${Math.max(f.rate, f.count > 0 ? 2 : 0)}%` }} />
                <span className="absolute left-2 top-0.5 text-xs text-foreground font-medium">{f.count}</span>
              </div>
              <span className="text-xs text-muted-foreground w-10 text-right">{f.rate}%</span>
            </div>
          ))}
          {(pipeline?.dropoffCauses ?? []).length > 0 && (
            <Card className="bg-card border-yellow-500/20 mt-4">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-yellow-400">Drop-off Causes</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {pipeline?.dropoffCauses?.map((d: any, i: number) => (
                  <div key={i} className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{d.cause}</p><span className="text-xs font-bold text-yellow-400">{d.count}</span></div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* AMBASSADORS */}
        <TabsContent value="ambassadors" className="mt-4 space-y-3">
          {(ambassadors ?? []).length === 0
            ? <p className="text-sm text-muted-foreground text-center py-8">No ambassadors yet. Add one to start building distribution channels.</p>
            : (ambassadors ?? []).map((a: any) => (
              <Card key={a.id} className="bg-card border-border" data-testid={`ambassador-${a.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-foreground">{a.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs border-0 bg-primary/20 text-primary">{a.type}</Badge>
                      {a.organization && <span className="text-xs text-muted-foreground">{a.organization}</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-center">
                    {[["Invites", a.invites_sent], ["Devs", a.developers_recruited], ["Orgs", a.orgs_recruited], ["Installs", a.installs_generated], ["Revenue", `$${n(a.revenue_generated)}`]].map(([l, v]) => (
                      <div key={String(l)}><p className="text-base font-bold text-foreground">{String(v)}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* KPIs */}
        <TabsContent value="kpis" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(kpis?.kpis ?? []).map((k: any, i: number) => {
              const p = Math.min(Math.round((k.value / k.target) * 100), 100);
              return (
                <Card key={i} className="bg-card border-border" data-testid={`kpi-${i}`}>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <p className={`text-2xl font-bold ${p >= 100 ? "text-emerald-400" : p >= 50 ? "text-primary" : "text-foreground"}`}>{k.value}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="flex-1 h-1 rounded bg-slate-700 overflow-hidden">
                        <div className={`h-1 rounded ${p >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${p}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">/{k.target}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
