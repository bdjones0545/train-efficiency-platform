import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Plus, UserCheck, Building, Clock, MessageSquare, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function n(v: unknown) { return Number(v ?? 0); }

const STATUSES = ["invited","activated","published","installed","reviewed","generating_revenue"];
function statusColor(s: string) {
  if (s === "generating_revenue") return "bg-emerald-500/20 text-emerald-400";
  if (s === "reviewed") return "bg-blue-500/20 text-blue-400";
  if (s === "installed" || s === "published") return "bg-primary/20 text-primary";
  if (s === "activated") return "bg-yellow-500/20 text-yellow-400";
  return "bg-muted/40 text-muted-foreground";
}

function AddParticipantForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ type: "developer", external_name: "", external_email: "", organization: "", notes: "" });
  const mut = useMutation({
    mutationFn: (d: typeof form) => apiRequest("POST", "/api/validation-participants", d),
    onSuccess: () => { toast({ title: "Participant added" }); queryClient.invalidateQueries({ queryKey: ["/api/validation-participants"] }); onClose(); },
    onError: () => toast({ title: "Failed to add", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-2">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Type</label>
        <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
          <SelectTrigger data-testid="select-participant-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="developer">Developer</SelectItem>
            <SelectItem value="org">Organization</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {[["external_name","Full Name *"],["external_email","Email"],["organization","Organization"]].map(([k,l]) => (
        <div key={k}>
          <label className="text-xs text-muted-foreground mb-1 block">{l}</label>
          <Input value={(form as any)[k]} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} placeholder={l} data-testid={`input-participant-${k}`} />
        </div>
      ))}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
        <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="How did you meet them? Context?" rows={2} data-testid="input-participant-notes" />
      </div>
      <Button className="w-full" disabled={!form.external_name || mut.isPending} onClick={() => mut.mutate(form)} data-testid="btn-add-participant">
        {mut.isPending ? "Adding…" : "Add Participant"}
      </Button>
    </div>
  );
}

function UpdateStatusForm({ participant, onClose }: { participant: any; onClose: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(participant.status ?? "invited");
  const mut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/validation-participants/${participant.id}`, {
      status,
      ...(status === "activated" ? { activated_at: new Date().toISOString() } : {}),
      ...(status === "published"  ? { first_publish_at: new Date().toISOString() } : {}),
      ...(status === "installed"  ? { first_install_at: new Date().toISOString() } : {}),
      ...(status === "reviewed"   ? { first_review_at: new Date().toISOString() } : {}),
      ...(status === "generating_revenue" ? { first_revenue_at: new Date().toISOString() } : {}),
    }),
    onSuccess: () => { toast({ title: "Status updated" }); queryClient.invalidateQueries({ queryKey: ["/api/validation-participants"] }); onClose(); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });
  return (
    <div className="space-y-3 mt-2">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">New Status</label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">Updating status will auto-record the timestamp for this milestone.</p>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()} data-testid="btn-update-status">{mut.isPending ? "Saving…" : "Update"}</Button>
    </div>
  );
}

function FeedbackForm({ participants, onClose }: { participants: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    participant_id: "", confused_by: "", expected: "", loved: "", almost_quit: "",
    use_again: "" as "" | "true" | "false", recommend: "" as "" | "true" | "false",
    pay_for_it: "" as "" | "true" | "false", publish_another: "" as "" | "true" | "false",
    overall_rating: "",
  });
  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/participant-feedback", {
      ...form,
      use_again:       form.use_again      !== "" ? form.use_again      === "true" : null,
      recommend:       form.recommend      !== "" ? form.recommend      === "true" : null,
      pay_for_it:      form.pay_for_it     !== "" ? form.pay_for_it     === "true" : null,
      publish_another: form.publish_another !== "" ? form.publish_another === "true" : null,
      overall_rating:  form.overall_rating ? parseInt(form.overall_rating) : null,
    }),
    onSuccess: () => { toast({ title: "Feedback saved" }); queryClient.invalidateQueries({ queryKey: ["/api/participant-feedback"] }); onClose(); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const textFields = [
    { key: "confused_by",  label: "What confused them?" },
    { key: "expected",     label: "What did they expect?" },
    { key: "loved",        label: "What did they love?" },
    { key: "almost_quit",  label: "What almost caused them to quit?" },
  ];
  const boolFields = [
    { key: "use_again",       label: "Would use again?" },
    { key: "recommend",       label: "Would recommend?" },
    { key: "pay_for_it",      label: "Would pay for it?" },
    { key: "publish_another", label: "Would publish another agent?" },
  ];

  return (
    <div className="space-y-3 mt-2 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Participant *</label>
        <Select value={form.participant_id} onValueChange={v => setForm(p => ({ ...p, participant_id: v }))}>
          <SelectTrigger data-testid="select-feedback-participant"><SelectValue placeholder="Select participant" /></SelectTrigger>
          <SelectContent>{participants.map(p => <SelectItem key={p.id} value={p.id}>{p.external_name} ({p.type})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {textFields.map(f => (
        <div key={f.key}>
          <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
          <Textarea value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder="Free text…" rows={2} data-testid={`input-fb-${f.key}`} />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        {boolFields.map(f => (
          <div key={f.key}>
            <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
            <Select value={(form as any)[f.key]} onValueChange={v => setForm(p => ({ ...p, [f.key]: v }))}>
              <SelectTrigger className="h-8 text-xs" data-testid={`select-fb-${f.key}`}><SelectValue placeholder="?" /></SelectTrigger>
              <SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Overall Rating (1–5)</label>
        <Select value={form.overall_rating} onValueChange={v => setForm(p => ({ ...p, overall_rating: v }))}>
          <SelectTrigger data-testid="select-fb-rating"><SelectValue placeholder="Select rating" /></SelectTrigger>
          <SelectContent>{[1,2,3,4,5].map(v => <SelectItem key={v} value={String(v)}>{v} Star{v > 1 ? "s" : ""}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={!form.participant_id || mut.isPending} onClick={() => mut.mutate()} data-testid="btn-submit-feedback">
        {mut.isPending ? "Saving…" : "Submit Feedback"}
      </Button>
    </div>
  );
}

function YesNoIcon({ val }: { val: boolean | null }) {
  if (val === true)  return <CheckCircle className="h-4 w-4 text-emerald-400 inline" />;
  if (val === false) return <XCircle className="h-4 w-4 text-red-400 inline" />;
  return <span className="text-muted-foreground text-xs">—</span>;
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="text-xs text-muted-foreground italic">No data yet</span>
    </div>
  );
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-40 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden relative">
        <div className={`h-4 rounded ${value >= 50 ? "bg-emerald-500" : value >= 25 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${value}%` }} />
        <span className="absolute left-2 top-0 text-xs text-white font-medium">{value}%</span>
      </div>
    </div>
  );
}

function FrictionThemes({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-muted-foreground mb-1">{title}</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className={`text-xs p-2 rounded border-l-2 bg-muted/20 ${color}`} data-testid={`theme-${i}`}>{item}</div>
        ))}
      </div>
    </div>
  );
}

export default function AdminHumanValidation() {
  const { data: participants } = useQuery<any[]>({ queryKey: ["/api/validation-participants"] });
  const { data: feedback }     = useQuery<any[]>({ queryKey: ["/api/participant-feedback"] });
  const { data: report }       = useQuery<any>({ queryKey: ["/api/platform/human-validation-report"] });
  const { data: devFriction }  = useQuery<any>({ queryKey: ["/api/platform/developer-friction-report"] });
  const { data: orgFriction }  = useQuery<any>({ queryKey: ["/api/platform/org-friction-report"] });
  const { data: scorecard }    = useQuery<any>({ queryKey: ["/api/platform/wave-x-scorecard"] });

  const [addOpen,      setAddOpen]      = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [editPart,     setEditPart]     = useState<any>(null);

  const devs = (participants ?? []).filter(p => p.type === "developer");
  const orgs = (participants ?? []).filter(p => p.type === "org");

  const verdictColor = (v: string) =>
    v?.includes("Complete")   ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
    v?.includes("Partially")  ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
    v?.includes("Early")      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
    "bg-muted/40 text-muted-foreground border-border";

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-human-validation">First Human Validation Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Can someone who is not Bryan Jones successfully participate in the TrainEfficiency Agent Economy?</p>
        </div>
        <div className="flex items-center gap-2">
          {report && <Badge className={`border text-xs font-semibold ${verdictColor(report.verdict)}`}>{report.verdict}</Badge>}
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-1" data-testid="btn-open-add-participant"><Plus className="h-3.5 w-3.5" />Add Participant</Button></DialogTrigger>
            <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Add External Participant</DialogTitle></DialogHeader><AddParticipantForm onClose={() => setAddOpen(false)} /></DialogContent>
          </Dialog>
          <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-1" data-testid="btn-open-feedback"><MessageSquare className="h-3.5 w-3.5" />Record Feedback</Button></DialogTrigger>
            <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Record Participant Feedback</DialogTitle></DialogHeader><FeedbackForm participants={participants ?? []} onClose={() => setFeedbackOpen(false)} /></DialogContent>
          </Dialog>
        </div>
      </div>

      {/* The Big Question */}
      <div className={`p-5 rounded-lg border ${report?.canSomeoneOtherThanBryanJonesParticipate ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border"}`}>
        <p className="text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">The Final Question</p>
        <p className="text-lg font-bold text-foreground">Can someone who is not Bryan Jones participate?</p>
        <p className={`text-base font-semibold mt-2 ${report?.canSomeoneOtherThanBryanJonesParticipate ? "text-emerald-400" : "text-muted-foreground"}`}>
          {report?.canSomeoneOtherThanBryanJonesParticipate ? "YES — External participation confirmed." : "Not yet — waiting for first external action."}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Devs Invited",   val: devs.length,                                     icon: <UserCheck className="h-4 w-4" /> },
          { label: "Devs Activated", val: devs.filter(d => d.activated_at).length,          icon: <UserCheck className="h-4 w-4" /> },
          { label: "Orgs Invited",   val: orgs.length,                                     icon: <Building className="h-4 w-4" /> },
          { label: "Orgs Activated", val: orgs.filter(o => o.activated_at).length,          icon: <Building className="h-4 w-4" /> },
          { label: "Feedback Items", val: (feedback ?? []).length,                          icon: <MessageSquare className="h-4 w-4" /> },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`summary-stat-${i}`}>
            <CardContent className="p-3 flex items-center gap-2">
              <div className="text-muted-foreground">{s.icon}</div>
              <div><p className="text-xl font-bold text-foreground">{s.val}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="participants">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="participants"  className="text-xs" data-testid="tab-participants">Participants</TabsTrigger>
          <TabsTrigger value="feedback"      className="text-xs" data-testid="tab-feedback-list">Feedback</TabsTrigger>
          <TabsTrigger value="dev-friction"  className="text-xs" data-testid="tab-dev-friction">Dev Friction</TabsTrigger>
          <TabsTrigger value="org-friction"  className="text-xs" data-testid="tab-org-friction">Org Friction</TabsTrigger>
          <TabsTrigger value="report"        className="text-xs" data-testid="tab-validation-report">Validation Report</TabsTrigger>
          <TabsTrigger value="scorecard"     className="text-xs" data-testid="tab-wave-x-score">Wave X Score</TabsTrigger>
        </TabsList>

        {/* PARTICIPANTS */}
        <TabsContent value="participants" className="mt-4 space-y-3">
          {(participants ?? []).length === 0 ? (
            <div className="text-center py-12">
              <UserCheck className="h-8 w-8 mx-auto opacity-30 mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No external participants yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Add the first developer or org to start tracking.</p>
            </div>
          ) : (participants ?? []).map((p: any) => (
            <Card key={p.id} className="bg-card border-border" data-testid={`participant-${p.id}`}>
              <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                <div className="shrink-0 text-muted-foreground">
                  {p.type === "developer" ? <UserCheck className="h-5 w-5" /> : <Building className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{p.external_name}</p>
                    <Badge className={`text-xs border-0 ${statusColor(p.status)}`}>{p.status?.replace(/_/g," ").replace(/\b\w/g,(c: string)=>c.toUpperCase())}</Badge>
                    <Badge className="text-xs border-0 bg-muted/40 text-muted-foreground">{p.type}</Badge>
                  </div>
                  {p.external_email && <p className="text-xs text-muted-foreground mt-0.5">{p.external_email}</p>}
                  {p.organization && <p className="text-xs text-muted-foreground">{p.organization}</p>}
                  {/* Timeline */}
                  <div className="flex gap-3 mt-2 flex-wrap">
                    {[["Invited",p.invited_at],["Activated",p.activated_at],["Published",p.first_publish_at],["Installed",p.first_install_at],["Reviewed",p.first_review_at]].map(([l,d]) => (
                      d ? <div key={String(l)} className="flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground" /><span className="text-xs text-muted-foreground">{l}: {new Date(String(d)).toLocaleDateString()}</span></div> : null
                    ))}
                  </div>
                </div>
                <Dialog open={editPart?.id === p.id} onOpenChange={open => setEditPart(open ? p : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid={`btn-update-participant-${p.id}`}>Update Status</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Update: {p.external_name}</DialogTitle></DialogHeader>
                    {editPart?.id === p.id && <UpdateStatusForm participant={p} onClose={() => setEditPart(null)} />}
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* FEEDBACK LIST */}
        <TabsContent value="feedback" className="mt-4 space-y-3">
          {(feedback ?? []).length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="h-8 w-8 mx-auto opacity-30 mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No feedback recorded yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Use "Record Feedback" to capture participant experiences.</p>
            </div>
          ) : (feedback ?? []).map((fb: any) => (
            <Card key={fb.id} className="bg-card border-border" data-testid={`feedback-${fb.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{fb.external_name ?? "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{fb.participant_type} · {new Date(fb.submitted_at).toLocaleDateString()}</p>
                  </div>
                  {fb.overall_rating && (
                    <div className="flex gap-0.5">{[1,2,3,4,5].map(i => <span key={i} className={`text-sm ${i <= fb.overall_rating ? "text-yellow-400" : "text-muted-foreground/30"}`}>★</span>)}</div>
                  )}
                </div>
                <div className="space-y-2">
                  {fb.confused_by   && <div><p className="text-xs font-semibold text-red-400 mb-0.5">Confused by</p><p className="text-sm text-muted-foreground">{fb.confused_by}</p></div>}
                  {fb.loved         && <div><p className="text-xs font-semibold text-emerald-400 mb-0.5">Loved</p><p className="text-sm text-muted-foreground">{fb.loved}</p></div>}
                  {fb.almost_quit   && <div><p className="text-xs font-semibold text-yellow-400 mb-0.5">Almost quit because</p><p className="text-sm text-muted-foreground">{fb.almost_quit}</p></div>}
                  {fb.expected      && <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Expected</p><p className="text-sm text-muted-foreground">{fb.expected}</p></div>}
                </div>
                <div className="flex gap-4 mt-3 flex-wrap">
                  {[["Use Again",fb.use_again],["Recommend",fb.recommend],["Pay For It",fb.pay_for_it],["Publish Another",fb.publish_another]].map(([l,v]) => (
                    <div key={String(l)} className="flex items-center gap-1"><p className="text-xs text-muted-foreground">{l}:</p><YesNoIcon val={v as boolean|null} /></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* DEV FRICTION */}
        <TabsContent value="dev-friction" className="mt-4 space-y-4">
          {devFriction && (
            <>
              <div className={`p-4 rounded-lg border ${devFriction.totalDevelopers > 0 && devFriction.withFeedback > 0 ? "bg-card border-border" : "bg-muted/20 border-border"}`}>
                <p className="text-sm font-bold text-foreground">{devFriction.verdict}</p>
                <p className="text-xs text-muted-foreground mt-1">{devFriction.totalDevelopers} developers tracked · {devFriction.withFeedback} with feedback</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {devFriction.scores && Object.entries(devFriction.scores).map(([k, v]: [string, any]) => (
                  <Card key={k} className="bg-card border-border" data-testid={`dev-score-${k}`}>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g," $1").replace(/^./,s=>s.toUpperCase())}</p>
                      {k === "avgRating" ? (
                        <p className={`text-2xl font-bold ${v === null ? "text-muted-foreground" : v >= 4 ? "text-emerald-400" : v >= 3 ? "text-yellow-400" : "text-red-400"}`}>{v === null ? "—" : `${v}/5`}</p>
                      ) : (
                        <p className={`text-2xl font-bold ${v === null ? "text-muted-foreground" : v >= 50 ? "text-emerald-400" : v >= 25 ? "text-yellow-400" : "text-red-400"}`}>{v === null ? "—" : `${v}%`}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {devFriction.timings.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Time-to-Metrics (hours)</CardTitle></CardHeader>
                  <CardContent>
                    {devFriction.timings.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                        <p className="text-sm text-muted-foreground">{t.name}</p>
                        <div className="flex gap-4 text-xs">
                          <span className="text-primary">{t.timeToPublish}h to publish</span>
                          {t.timeToInstall && <span className="text-muted-foreground">{t.timeToInstall}h to install</span>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-400" /> Developer Friction Themes</CardTitle></CardHeader>
                <CardContent>
                  {devFriction.confusionThemes.length + devFriction.lovedThemes.length + devFriction.quittingRisks.length === 0
                    ? <p className="text-xs text-muted-foreground">No themes yet — collect feedback to surface patterns.</p>
                    : (<>
                      <FrictionThemes title="Confusion" items={devFriction.confusionThemes} color="border-red-500 text-red-300" />
                      <FrictionThemes title="Loved"     items={devFriction.lovedThemes}     color="border-emerald-500 text-emerald-300" />
                      <FrictionThemes title="Quit Risk" items={devFriction.quittingRisks}   color="border-yellow-500 text-yellow-300" />
                    </>)
                  }
                </CardContent>
              </Card>
              {devFriction.developers.length > 0 && (
                <div className="space-y-2">
                  {devFriction.developers.map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0" data-testid={`dev-friction-row-${i}`}>
                      <div>
                        <p className="text-sm text-foreground font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{d.status} · {d.source ?? d.organization ?? ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.hasFeedback && <Badge className="text-xs border-0 bg-primary/20 text-primary">Has Feedback</Badge>}
                        {d.rating && <div className="flex">{[1,2,3,4,5].map(s => <span key={s} className={`text-xs ${s <= d.rating ? "text-yellow-400" : "text-muted-foreground/30"}`}>★</span>)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ORG FRICTION */}
        <TabsContent value="org-friction" className="mt-4 space-y-4">
          {orgFriction && (
            <>
              <div className="p-4 rounded-lg border bg-card border-border">
                <p className="text-sm font-bold text-foreground">{orgFriction.verdict}</p>
                <p className="text-xs text-muted-foreground mt-1">{orgFriction.totalOrgs} organizations tracked · {orgFriction.withFeedback} with feedback</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {orgFriction.scores && Object.entries(orgFriction.scores).map(([k, v]: [string, any]) => (
                  <Card key={k} className="bg-card border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g," $1").replace(/^./,s=>s.toUpperCase())}</p>
                      {k === "avgRating"
                        ? <p className={`text-2xl font-bold ${v === null ? "text-muted-foreground" : v >= 4 ? "text-emerald-400" : "text-yellow-400"}`}>{v === null ? "—" : `${v}/5`}</p>
                        : <p className={`text-2xl font-bold ${v === null ? "text-muted-foreground" : v >= 50 ? "text-emerald-400" : "text-yellow-400"}`}>{v === null ? "—" : `${v}%`}</p>
                      }
                    </CardContent>
                  </Card>
                ))}
              </div>
              {orgFriction.timings.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Time-to-Metrics (hours)</CardTitle></CardHeader>
                  <CardContent>
                    {orgFriction.timings.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                        <p className="text-sm text-muted-foreground">{t.name}</p>
                        <div className="flex gap-3 text-xs flex-wrap">
                          <span className="text-primary">{t.timeToInstall}h install</span>
                          {t.timeToValue   && <span className="text-muted-foreground">{t.timeToValue}h value</span>}
                          {t.timeToReview  && <span className="text-muted-foreground">{t.timeToReview}h review</span>}
                          {t.timeToRevenue && <span className="text-emerald-400">{t.timeToRevenue}h revenue</span>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-400" /> Organization Friction Themes</CardTitle></CardHeader>
                <CardContent>
                  {orgFriction.confusionThemes.length + orgFriction.lovedThemes.length + orgFriction.quittingRisks.length === 0
                    ? <p className="text-xs text-muted-foreground">No themes yet — collect feedback to surface patterns.</p>
                    : (<>
                      <FrictionThemes title="Confusion" items={orgFriction.confusionThemes} color="border-red-500 text-red-300" />
                      <FrictionThemes title="Loved"     items={orgFriction.lovedThemes}     color="border-emerald-500 text-emerald-300" />
                      <FrictionThemes title="Quit Risk" items={orgFriction.quittingRisks}   color="border-yellow-500 text-yellow-300" />
                    </>)
                  }
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* VALIDATION REPORT */}
        <TabsContent value="report" className="mt-4 space-y-4">
          {report && (
            <>
              <Card className={`border ${report.canSomeoneOtherThanBryanJonesParticipate ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border"}`}>
                <CardContent className="p-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-2">First Human Validation Report</p>
                  <p className="text-xl font-bold text-foreground">{report.verdict}</p>
                  <p className="text-sm text-muted-foreground mt-2">{report.metCount}/{report.totalCriteria} success criteria met · Generated {new Date(report.generatedAt).toLocaleString()}</p>
                </CardContent>
              </Card>

              {/* Success criteria */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Success Criteria</CardTitle></CardHeader>
                <CardContent>
                  {report.criteria.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`report-criterion-${i}`}>
                      {c.met ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                      <div className="flex-1">
                        <p className="text-sm text-foreground">{c.criterion}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.evidence}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Time metrics */}
              {report.timeMetrics?.some((t: any) => t.n > 0) && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Time-to-Metrics</CardTitle></CardHeader>
                  <CardContent>
                    {report.timeMetrics.map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                        <p className="text-sm text-muted-foreground">{m.metric}</p>
                        {m.n > 0
                          ? <div className="flex gap-3 text-xs"><span className="text-primary">avg {m.avg}h</span><span className="text-emerald-400">fastest {m.fastest}h</span><span className="text-muted-foreground">slowest {m.slowest}h</span></div>
                          : <span className="text-xs text-muted-foreground italic">No data</span>
                        }
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Real activity */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  ["Agents Published",  report.summary.agentsPublished],
                  ["Real Installs",     report.summary.realInstalls],
                  ["Real Reviews",      report.summary.realReviews],
                  ["Revenue Events",    report.summary.realRevenue],
                  ["Royalties",         report.summary.realRoyalties],
                  ["Feedback Received", report.summary.feedbackCount],
                ].map(([l, v]) => (
                  <Card key={String(l)} className="bg-card border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{l}</p>
                      <p className={`text-2xl font-bold ${n(v) > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{String(v)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* WAVE X SCORECARD */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          {scorecard && (
            <>
              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="text-center px-4">
                  <p className="text-5xl font-bold text-primary">{scorecard.overallScore}</p>
                  <p className="text-xs text-muted-foreground mt-1">/ 100</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{scorecard.verdict}</p>
                  <p className="text-sm text-muted-foreground">{scorecard.metCriteria}/{scorecard.totalCriteria} criteria met</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {scorecard.metrics && Object.entries(scorecard.metrics).map(([k, v]: [string, any]) => {
                  const p = Math.min(Math.round((v.actual / v.target) * 100), 100);
                  return (
                    <Card key={k} className="bg-card border-border" data-testid={`wx-metric-${k}`}>
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g," $1").replace(/^./,s=>s.toUpperCase())}</p>
                        <p className={`text-2xl font-bold ${p >= 100 ? "text-emerald-400" : p >= 50 ? "text-primary" : "text-foreground"}`}>{v.actual}</p>
                        <div className="mt-1 h-1 rounded bg-slate-700 overflow-hidden">
                          <div className={`h-1 rounded ${p >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${p}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">/ {v.target}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
