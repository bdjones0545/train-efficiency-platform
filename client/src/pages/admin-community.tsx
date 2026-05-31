import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Megaphone, Zap, FileText, Trophy, Star, Pin, Plus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return ts; }
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    general:     "bg-blue-500/20 text-blue-400",
    milestone:   "bg-emerald-500/20 text-emerald-400",
    update:      "bg-yellow-500/20 text-yellow-400",
    warning:     "bg-red-500/20 text-red-400",
    improvement: "bg-purple-500/20 text-purple-400",
    bugfix:      "bg-orange-500/20 text-orange-400",
    feature:     "bg-cyan-500/20 text-cyan-400",
  };
  return <Badge className={`text-xs ${map[type] ?? map.general}`}>{type}</Badge>;
}

// ── Post form ─────────────────────────────────────────────────────────────────
function PostForm({ endpoint, fields, typeOptions, onSuccess }: {
  endpoint: string;
  fields: { key: string; label: string; multiline?: boolean; required?: boolean }[];
  typeOptions: string[];
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", endpoint, data),
    onSuccess: () => {
      toast({ title: "Posted successfully" });
      setForm({});
      setOpen(false);
      onSuccess();
    },
    onError: () => toast({ title: "Failed to post", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1" data-testid="btn-post-new"><Plus className="h-3.5 w-3.5" /> Post</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Post</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          {fields.map(f => (
            f.multiline
              ? <div key={f.key}>
                  <label className="text-xs text-muted-foreground mb-1 block">{f.label}{f.required && " *"}</label>
                  <Textarea
                    rows={4}
                    placeholder={f.label}
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    data-testid={`input-${f.key}`}
                  />
                </div>
              : <div key={f.key}>
                  <label className="text-xs text-muted-foreground mb-1 block">{f.label}{f.required && " *"}</label>
                  <Input
                    placeholder={f.label}
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    data-testid={`input-${f.key}`}
                  />
                </div>
          ))}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Type</label>
            <Select value={form.type ?? typeOptions[0]} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
              <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
              <SelectContent>{typeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(form)}
            data-testid="btn-submit-post"
          >
            {mutation.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function AdminCommunity() {
  const { data: announcements = [], refetch: refAnn } = useQuery<any[]>({ queryKey: ["/api/community/announcements"] });
  const { data: devUpdates = [],    refetch: refDev } = useQuery<any[]>({ queryKey: ["/api/community/developer-updates"] });
  const { data: releaseNotes = [],  refetch: refRel } = useQuery<any[]>({ queryKey: ["/api/community/release-notes"] });
  const { data: reviews = [] }                        = useQuery<any[]>({ queryKey: ["/api/beta/case-studies"] });
  const { data: scorecard }                           = useQuery<any>({ queryKey: ["/api/platform/beta-wave2-scorecard"] });
  const { data: maturity }                            = useQuery<any>({ queryKey: ["/api/marketplace/maturity"] });

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-community">
            Marketplace Community
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Agents · Developers · Organizations · Stories</p>
        </div>
        <div className="flex items-center gap-3">
          {maturity && (
            <Badge className="border border-primary/30 bg-primary/10 text-primary text-xs font-semibold" data-testid="badge-maturity">
              Stage {maturity.currentStage}: {maturity.currentName}
            </Badge>
          )}
          {scorecard && (
            <Badge className={`text-xs border ${scorecard.overallScore >= 70 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : scorecard.overallScore >= 40 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
              Wave 2 Score: {scorecard.overallScore}/100
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Announcements",    val: announcements.length, icon: <Megaphone className="h-4 w-4 text-blue-400" /> },
          { label: "Dev Updates",      val: devUpdates.length,    icon: <Zap className="h-4 w-4 text-yellow-400" /> },
          { label: "Release Notes",    val: releaseNotes.length,  icon: <FileText className="h-4 w-4 text-purple-400" /> },
          { label: "Case Studies",     val: reviews.length,       icon: <Trophy className="h-4 w-4 text-emerald-400" /> },
          { label: "Marketplace Stage",val: maturity ? `${maturity.currentName}` : "—", icon: <Star className="h-4 w-4 text-primary" /> },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`community-stat-${i}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-muted-foreground">{s.label}</span></div>
              <p className="text-xl font-bold">{s.val}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="announcements">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="announcements"  className="text-xs" data-testid="tab-announcements">Announcements</TabsTrigger>
          <TabsTrigger value="agent-updates"  className="text-xs" data-testid="tab-agent-updates">Agent Updates</TabsTrigger>
          <TabsTrigger value="release-notes"  className="text-xs" data-testid="tab-release-notes">Release Notes</TabsTrigger>
          <TabsTrigger value="case-studies"   className="text-xs" data-testid="tab-case-studies">Success Stories</TabsTrigger>
          <TabsTrigger value="wave2"          className="text-xs" data-testid="tab-wave2">Wave 2 Progress</TabsTrigger>
          <TabsTrigger value="maturity"       className="text-xs" data-testid="tab-maturity">Maturity Model</TabsTrigger>
        </TabsList>

        {/* ANNOUNCEMENTS */}
        <TabsContent value="announcements" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-foreground">Marketplace Announcements</h2>
            <PostForm
              endpoint="/api/community/announcements"
              fields={[
                { key: "title", label: "Title", required: true },
                { key: "body",  label: "Message", multiline: true, required: true },
                { key: "author_name", label: "Author Name" },
              ]}
              typeOptions={["general", "milestone", "update", "warning"]}
              onSuccess={() => refAnn()}
            />
          </div>
          {announcements.length === 0
            ? <Card className="bg-card border-border"><CardContent className="p-6 text-center text-sm text-muted-foreground">No announcements yet. Post the first one!</CardContent></Card>
            : announcements.map((a: any) => (
              <Card key={a.id} className="bg-card border-border" data-testid={`announcement-${a.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {a.pinned && <Pin className="h-3 w-3 text-primary" />}
                        <TypeBadge type={a.type} />
                        <span className="text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
                      </div>
                      <p className="font-semibold text-sm text-foreground">{a.title}</p>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{a.body}</p>
                      {a.author_name && <p className="text-xs text-muted-foreground mt-2">— {a.author_name}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* AGENT UPDATES */}
        <TabsContent value="agent-updates" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-foreground">Developer Agent Updates</h2>
            <PostForm
              endpoint="/api/community/developer-updates"
              fields={[
                { key: "developer_id", label: "Developer ID", required: true },
                { key: "agent_name",   label: "Agent Name" },
                { key: "title",        label: "Update Title", required: true },
                { key: "body",         label: "Update Details", multiline: true, required: true },
              ]}
              typeOptions={["update", "announcement", "deprecation", "migration"]}
              onSuccess={() => refDev()}
            />
          </div>
          {devUpdates.length === 0
            ? <Card className="bg-card border-border"><CardContent className="p-6 text-center text-sm text-muted-foreground">No developer updates yet.</CardContent></Card>
            : devUpdates.map((u: any) => (
              <Card key={u.id} className="bg-card border-border" data-testid={`dev-update-${u.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TypeBadge type={u.update_type} />
                    {u.agent_name && <Badge variant="outline" className="text-xs">{u.agent_name}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{timeAgo(u.created_at)}</span>
                  </div>
                  <p className="font-semibold text-sm text-foreground">{u.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{u.body}</p>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* RELEASE NOTES */}
        <TabsContent value="release-notes" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-foreground">Agent Release Notes</h2>
            <PostForm
              endpoint="/api/community/release-notes"
              fields={[
                { key: "agent_id",   label: "Agent ID", required: true },
                { key: "agent_name", label: "Agent Name" },
                { key: "version",    label: "Version (e.g. 1.2.0)" },
                { key: "title",      label: "Release Title", required: true },
                { key: "body",       label: "What changed", multiline: true, required: true },
              ]}
              typeOptions={["improvement", "feature", "bugfix", "breaking"]}
              onSuccess={() => refRel()}
            />
          </div>
          {releaseNotes.length === 0
            ? <Card className="bg-card border-border"><CardContent className="p-6 text-center text-sm text-muted-foreground">No release notes yet.</CardContent></Card>
            : releaseNotes.map((r: any) => (
              <Card key={r.id} className="bg-card border-border" data-testid={`release-note-${r.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TypeBadge type={r.change_type} />
                    {r.agent_name && <Badge variant="outline" className="text-xs">{r.agent_name}</Badge>}
                    {r.version && <Badge variant="outline" className="text-xs">v{r.version}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{timeAgo(r.released_at)}</span>
                  </div>
                  <p className="font-semibold text-sm text-foreground">{r.title}</p>
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{r.body}</p>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* CASE STUDIES */}
        <TabsContent value="case-studies" className="space-y-3 mt-4">
          <h2 className="text-sm font-semibold text-foreground">Verified Success Stories</h2>
          {reviews.filter((cs: any) => cs.verification_status === 'verified').length === 0
            ? <Card className="bg-card border-border"><CardContent className="p-6 text-center text-sm text-muted-foreground">No verified case studies yet. Use /admin/ecosystem-health to add them.</CardContent></Card>
            : reviews.filter((cs: any) => cs.verification_status === 'verified').map((cs: any) => (
              <Card key={cs.id} className="bg-card border-border" data-testid={`case-study-${cs.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-emerald-500/20 text-emerald-400 text-xs border-0">Verified</Badge>
                        <span className="text-xs text-muted-foreground">{cs.organization}</span>
                      </div>
                      <p className="font-semibold text-sm text-foreground">{cs.agent_name}</p>
                      {cs.outcome && <p className="text-sm text-muted-foreground mt-1">{cs.outcome}</p>}
                      <div className="flex gap-4 mt-2">
                        {cs.revenue_impact && <span className="text-xs text-emerald-400">+${cs.revenue_impact} revenue</span>}
                        {cs.hours_saved    && <span className="text-xs text-blue-400">{cs.hours_saved}h saved</span>}
                        {cs.review_score   && <span className="text-xs text-yellow-400">{cs.review_score}★ rating</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* WAVE 2 PROGRESS */}
        <TabsContent value="wave2" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {scorecard && Object.entries(scorecard.metrics ?? {}).slice(0, 8).map(([k, v]: [string, any]) => {
              const pct = Math.min(Math.round((v.actual / v.target) * 100), 100);
              const color = pct >= 100 ? "text-emerald-400" : pct >= 50 ? "text-yellow-400" : "text-red-400";
              return (
                <Card key={k} className="bg-card border-border" data-testid={`wave2-metric-${k}`}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g," $1").replace(/^./,s=>s.toUpperCase())}</p>
                    <p className={`text-xl font-bold ${color}`}>{v.actual}</p>
                    <p className="text-xs text-muted-foreground">target: {v.target}</p>
                    <div className="mt-2 h-1.5 rounded bg-slate-700 overflow-hidden">
                      <div className={`h-1.5 rounded transition-all ${pct>=100?"bg-emerald-500":pct>=50?"bg-yellow-500":"bg-red-500"}`} style={{width:`${pct}%`}} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Exit Criteria</CardTitle></CardHeader>
            <CardContent>
              {scorecard?.exitCriteria?.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                  <span className={`text-sm ${c.met ? "text-emerald-400" : "text-muted-foreground"}`}>{c.met ? "✓" : "○"}</span>
                  <span className="text-sm text-muted-foreground">{c.criterion}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MATURITY MODEL */}
        <TabsContent value="maturity" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Marketplace Maturity
                {maturity && <Badge className="ml-auto border border-primary/30 bg-primary/10 text-primary text-xs">Stage {maturity.currentStage}: {maturity.currentName}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {maturity?.stages?.map((s: any) => {
                const isCurrent = s.stage === maturity.currentStage;
                const isPassed  = s.met;
                return (
                  <div key={s.stage} className={`p-3 rounded-lg border ${isCurrent ? "border-primary/50 bg-primary/5" : isPassed ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40 bg-muted/20"}`}
                    data-testid={`maturity-stage-${s.stage}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isPassed ? "bg-emerald-500/20 text-emerald-400" : isCurrent ? "bg-primary/20 text-primary" : "bg-slate-700 text-muted-foreground"}`}>
                        {s.stage}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${isCurrent ? "text-primary" : isPassed ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {s.name} {isCurrent && "← Current"}
                        </p>
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                      </div>
                      {isPassed ? <Badge className="bg-emerald-500/20 text-emerald-400 text-xs border-0">Reached</Badge>
                        : <Badge className="bg-slate-700 text-muted-foreground text-xs border-0">Pending</Badge>}
                    </div>
                  </div>
                );
              })}
              {maturity?.nextStage && (
                <div className="mt-4 p-3 rounded-lg bg-muted/40">
                  <p className="text-xs font-semibold text-foreground mb-2">Next stage requires:</p>
                  {Object.entries(maturity.nextStage.criteria).map(([k, v]) => (
                    <p key={k} className="text-xs text-muted-foreground">
                      · {k}: {n(maturity?.components?.[k])} / {String(v)}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function n(v: unknown): number { return Number(v ?? 0); }
