import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Handshake, Plus, RefreshCw, Zap, TrendingUp, Users,
  CheckCircle, Clock, Star, AlertTriangle, ChevronRight,
  Building2, Mail, BookOpen, BarChart3, Brain,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES = [
  { id: "new",            label: "New",            color: "bg-gray-500" },
  { id: "qualified",      label: "Qualified",      color: "bg-blue-500" },
  { id: "outreach_ready", label: "Outreach Ready", color: "bg-purple-500" },
  { id: "contacted",      label: "Contacted",      color: "bg-yellow-500" },
  { id: "interested",     label: "Interested",     color: "bg-orange-500" },
  { id: "meeting",        label: "Meeting",        color: "bg-indigo-500" },
  { id: "negotiation",    label: "Negotiation",    color: "bg-red-500" },
  { id: "partnered",      label: "Partnered",      color: "bg-green-500" },
  { id: "declined",       label: "Declined",       color: "bg-slate-400" },
];

const PARTNERSHIP_TYPES = [
  "school","sports_club","facility","clinic","league","team",
  "sponsor","community_program","franchise","general",
];

const SOURCES = ["referral","website","social_media","event","manual","partner"];

const DRAFT_TYPES = [
  { id: "introduction",           label: "Introduction" },
  { id: "collaboration_proposal", label: "Collaboration Proposal" },
  { id: "facility_partnership",   label: "Facility Partnership" },
  { id: "community_partnership",  label: "Community Partnership" },
  { id: "referral_partnership",   label: "Referral Partnership" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreBadge(score: number) {
  if (score >= 70) return <Badge className="bg-green-100 text-green-800">{score}</Badge>;
  if (score >= 45) return <Badge className="bg-yellow-100 text-yellow-800">{score}</Badge>;
  return <Badge className="bg-red-100 text-red-800">{score}</Badge>;
}

function stageBadge(status: string) {
  const stage = STAGES.find(s => s.id === status);
  return (
    <Badge variant="outline" className="text-xs">
      {stage?.label ?? status}
    </Badge>
  );
}

function fmt(dt: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString();
}

// ─── Add Partner Dialog ───────────────────────────────────────────────────────

function AddPartnerDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen]     = useState(false);
  const [form, setForm]     = useState({
    organizationName: "", contactName: "", contactEmail: "",
    contactPhone: "", website: "", location: "",
    partnershipType: "general", source: "manual", notes: "",
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/partnerships", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partnerships"] });
      setOpen(false);
      setForm({ organizationName:"",contactName:"",contactEmail:"",contactPhone:"",website:"",location:"",partnershipType:"general",source:"manual",notes:"" });
      toast({ title: "Partner added", description: "Partnership opportunity created." });
      onCreated();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target?.value ?? e }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-partner" size="sm">
          <Plus className="h-4 w-4 mr-2" /> Add Partner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Partnership Opportunity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Organization Name *</Label>
            <Input data-testid="input-org-name" value={form.organizationName} onChange={set("organizationName")} placeholder="e.g. Lincoln High School" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact Name</Label>
              <Input data-testid="input-contact-name" value={form.contactName} onChange={set("contactName")} placeholder="Jane Smith" />
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input data-testid="input-contact-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="jane@org.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input data-testid="input-contact-phone" value={form.contactPhone} onChange={set("contactPhone")} />
            </div>
            <div>
              <Label>Website</Label>
              <Input data-testid="input-website" value={form.website} onChange={set("website")} placeholder="https://" />
            </div>
          </div>
          <div>
            <Label>Location</Label>
            <Input data-testid="input-location" value={form.location} onChange={set("location")} placeholder="City, State" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Partnership Type</Label>
              <Select value={form.partnershipType} onValueChange={v => setForm(f => ({ ...f, partnershipType: v }))}>
                <SelectTrigger data-testid="select-partnership-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PARTNERSHIP_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                <SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea data-testid="input-notes" value={form.notes} onChange={set("notes")} rows={2} placeholder="Any additional context..." />
          </div>
          <Button
            data-testid="button-submit-partner"
            className="w-full"
            onClick={() => createMut.mutate(form)}
            disabled={!form.organizationName || createMut.isPending}
          >
            {createMut.isPending ? "Adding..." : "Add Partner"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPartnerships() {
  const [tab, setTab] = useState("partners");
  const { toast } = useToast();
  const qc          = useQueryClient();

  const partnersQ  = useQuery<any[]>({ queryKey: ["/api/partnerships"] });
  const assessQ    = useQuery<any[]>({ queryKey: ["/api/partnerships/assessments"] });
  const draftsQ    = useQuery<any[]>({ queryKey: ["/api/partnerships/outreach-drafts"] });
  const pipelineQ  = useQuery<any[]>({ queryKey: ["/api/partnerships/pipeline"] });
  const learningQ  = useQuery<any>({   queryKey: ["/api/partnerships/learning"] });
  const executiveQ = useQuery<any>({   queryKey: ["/api/partnerships/executive"] });

  const partners = Array.isArray(partnersQ.data) ? partnersQ.data : [];
  const total     = partners.length;
  const qualified = partners.filter((p: any) => p.status === "qualified").length;
  const meeting   = partners.filter((p: any) => p.status === "meeting").length;
  const partnered = partners.filter((p: any) => p.status === "partnered").length;

  const assessMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/partnerships/${id}/assess`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partnerships/assessments"] });
      qc.invalidateQueries({ queryKey: ["/api/partnerships"] });
      toast({ title: "Assessment complete" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const draftMut = useMutation({
    mutationFn: ({ id, draftType }: { id: string; draftType: string }) =>
      apiRequest("POST", `/api/partnerships/${id}/draft-outreach`, { draftType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partnerships/outreach-drafts"] });
      toast({ title: "Draft generated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/partnerships/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partnerships"] });
      qc.invalidateQueries({ queryKey: ["/api/partnerships/pipeline"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/partnerships/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partnerships"] });
      toast({ title: "Partner removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Handshake className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Partnerships Department</h1>
            <p className="text-sm text-muted-foreground">Department OS v2 · Strategic Partner Management</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs gap-1">
          <Zap className="h-3 w-3" /> Department #3
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="partners"    data-testid="tab-partners">Partners</TabsTrigger>
          <TabsTrigger value="assessments" data-testid="tab-assessments">Assessments</TabsTrigger>
          <TabsTrigger value="outreach"    data-testid="tab-outreach">Outreach</TabsTrigger>
          <TabsTrigger value="pipeline"    data-testid="tab-pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="learning"    data-testid="tab-learning">Learning</TabsTrigger>
          <TabsTrigger value="executive"   data-testid="tab-executive">Executive Intelligence</TabsTrigger>
        </TabsList>

        {/* ── Partners Tab ───────────────────────────────────────────────── */}
        <TabsContent value="partners" className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Opportunities", value: total,     icon: Building2,    color: "text-blue-500" },
              { label: "Qualified",           value: qualified,  icon: Star,         color: "text-purple-500" },
              { label: "Meetings",            value: meeting,    icon: Users,        color: "text-orange-500" },
              { label: "Partnered",           value: partnered,  icon: CheckCircle,  color: "text-green-500" },
            ].map(card => (
              <Card key={card.label} data-testid={`card-${card.label.toLowerCase().replace(/\s+/g,"-")}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{card.label}</p>
                      <p className="text-2xl font-bold">{partnersQ.isLoading ? "—" : card.value}</p>
                    </div>
                    <card.icon className={`h-8 w-8 ${card.color} opacity-80`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">All Partners</CardTitle>
                <AddPartnerDialog onCreated={() => qc.invalidateQueries({ queryKey: ["/api/partnerships"] })} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {partnersQ.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : partners.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Handshake className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No partnership opportunities yet.</p>
                  <p className="text-xs">Add your first partner to get started.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Fit Score</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partners.map((p: any) => (
                      <TableRow key={p.id} data-testid={`row-partner-${p.id}`}>
                        <TableCell className="font-medium">
                          <div>{p.organization_name}</div>
                          {p.contact_name && <div className="text-xs text-muted-foreground">{p.contact_name}</div>}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs capitalize">{(p.partnership_type ?? "general").replace(/_/g," ")}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{p.source ?? "—"}</span>
                        </TableCell>
                        <TableCell>{stageBadge(p.status)}</TableCell>
                        <TableCell>{scoreBadge(p.fit_score ?? 0)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(p.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              data-testid={`button-assess-${p.id}`}
                              size="sm" variant="outline"
                              onClick={() => assessMut.mutate(p.id)}
                              disabled={assessMut.isPending}
                            >
                              Assess
                            </Button>
                            <Select
                              onValueChange={v => statusMut.mutate({ id: p.id, status: v })}
                            >
                              <SelectTrigger data-testid={`select-status-${p.id}`} className="h-8 w-28 text-xs">
                                <SelectValue placeholder="Move to…" />
                              </SelectTrigger>
                              <SelectContent>
                                {STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Assessments Tab ────────────────────────────────────────────── */}
        <TabsContent value="assessments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-500" /> Partner Assessments
              </CardTitle>
              <CardDescription>Run from the Partners tab — click "Assess" on any partner.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {assessQ.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : (Array.isArray(assessQ.data) ? assessQ.data : []).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Star className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No assessments yet. Run an assessment from the Partners tab.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Fit Score</TableHead>
                      <TableHead>Strategic</TableHead>
                      <TableHead>Reach</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(Array.isArray(assessQ.data) ? assessQ.data : []).map((a: any) => (
                      <TableRow key={a.id} data-testid={`row-assessment-${a.id}`}>
                        <TableCell className="font-medium">{a.organization_name}</TableCell>
                        <TableCell>{scoreBadge(a.fit_score ?? 0)}</TableCell>
                        <TableCell>
                          <span className="text-sm">{a.strategic_value_score ?? 0}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{a.reach_score ?? 0}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{a.confidence_score ?? 0}%</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {a.recommended_action ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(a.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Outreach Tab ───────────────────────────────────────────────── */}
        <TabsContent value="outreach" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Draft-only. Select a partner and type to generate an outreach email.
            </p>
            <div className="flex gap-2">
              {partners.slice(0, 5).map((p: any) => (
                <Button
                  key={p.id}
                  data-testid={`button-draft-${p.id}`}
                  size="sm" variant="outline"
                  onClick={() => draftMut.mutate({ id: p.id, draftType: "introduction" })}
                  disabled={draftMut.isPending}
                >
                  <Mail className="h-3 w-3 mr-1" />
                  {p.organization_name.split(" ")[0]}
                </Button>
              ))}
            </div>
          </div>

          {draftsQ.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : (Array.isArray(draftsQ.data) ? draftsQ.data : []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Mail className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No drafts yet. Generate outreach from a partner above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(Array.isArray(draftsQ.data) ? draftsQ.data : []).map((d: any) => (
                <Card key={d.id} data-testid={`card-draft-${d.id}`}>
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{d.organization_name}</div>
                      <div className="flex gap-2 items-center">
                        {scoreBadge(d.confidence_score ?? 0)}
                        <Badge variant="outline" className="text-xs">{d.status}</Badge>
                      </div>
                    </div>
                    <div className="font-semibold text-sm">📧 {d.subject}</div>
                    <div className="text-xs text-muted-foreground line-clamp-3">{d.body}</div>
                    {d.positioning_angle && (
                      <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                        Angle: {d.positioning_angle}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">{fmt(d.created_at)}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Pipeline Tab ───────────────────────────────────────────────── */}
        <TabsContent value="pipeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-500" /> Partnership Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pipelineQ.isLoading ? (
                <div className="p-4 text-center text-muted-foreground">Loading...</div>
              ) : (
                <div className="space-y-3">
                  {(pipelineQ.data ?? STAGES.map(s => ({ stage: s.id, count: 0 }))).map((item: any) => {
                    const stage = STAGES.find(s => s.id === item.stage);
                    const maxCount = Math.max(1, ...(Array.isArray(pipelineQ.data) ? pipelineQ.data : []).map((i: any) => i.count));
                    const pct = Math.round((item.count / maxCount) * 100);
                    return (
                      <div key={item.stage} className="flex items-center gap-3" data-testid={`pipeline-stage-${item.stage}`}>
                        <div className="w-28 text-xs text-right text-muted-foreground">{stage?.label ?? item.stage}</div>
                        <div className="flex-1 bg-muted rounded-full h-5 relative overflow-hidden">
                          <div
                            className={`h-full rounded-full ${stage?.color ?? "bg-gray-500"} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-8 text-xs font-bold text-right">{item.count}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Learning Tab ───────────────────────────────────────────────── */}
        <TabsContent value="learning" className="space-y-4">
          {learningQ.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading learning data...</div>
          ) : !learningQ.data ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No learning data available yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* Report metrics */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Learning Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Total Signals",    value: learningQ.data.report?.totalSignals ?? 0, unit: "" },
                    { label: "Reply Rate",        value: learningQ.data.report?.replyRate ?? 0,    unit: "%" },
                    { label: "Conversion Rate",   value: learningQ.data.report?.conversionRate ?? 0, unit: "%" },
                    { label: "Decline Rate",      value: learningQ.data.report?.declineRate ?? 0,  unit: "%" },
                  ].map(m => (
                    <div key={m.label} className="flex justify-between items-center" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g,"-")}`}>
                      <span className="text-sm text-muted-foreground">{m.label}</span>
                      <span className="font-bold">{m.value}{m.unit}</span>
                    </div>
                  ))}
                  {learningQ.data.report?.topSource && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Top Source</span>
                      <Badge variant="outline">{learningQ.data.report.topSource}</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Insights */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">AI Insights</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(learningQ.data.insights ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Insights will appear once learning signals are collected.</p>
                  ) : (
                    (learningQ.data.insights ?? []).map((insight: any, i: number) => (
                      <div
                        key={i}
                        data-testid={`insight-${i}`}
                        className={`rounded-lg p-2 text-xs ${
                          insight.type === "positive" ? "bg-green-50 border border-green-100" :
                          insight.type === "negative" ? "bg-red-50 border border-red-100" :
                          "bg-gray-50 border border-gray-100"
                        }`}
                      >
                        <p className="font-medium">{insight.message}</p>
                        {insight.suggestion && (
                          <p className="text-muted-foreground mt-0.5">{insight.suggestion}</p>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── Executive Intelligence Tab ─────────────────────────────────── */}
        <TabsContent value="executive" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              Generated by the Partnership Executive Agent
            </p>
            <Button
              data-testid="button-refresh-executive"
              size="sm" variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/partnerships/executive"] })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>

          {executiveQ.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Generating executive intelligence...</div>
          ) : !executiveQ.data ? null : (
            <div className="space-y-4">
              {/* Best Action */}
              {executiveQ.data.bestAction && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-sm">Best Action Today</p>
                        <p className="text-sm mt-1">{executiveQ.data.bestAction.action}</p>
                        <p className="text-xs text-muted-foreground mt-1">{executiveQ.data.bestAction.why}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Brief */}
              {executiveQ.data.brief && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Executive Brief</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>{executiveQ.data.brief.summary}</p>
                    {executiveQ.data.brief.keyInsight && (
                      <div className="bg-blue-50 rounded px-3 py-2 text-xs text-blue-800">
                        💡 {executiveQ.data.brief.keyInsight}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Recommendations */}
              {(executiveQ.data.recommendations ?? []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(executiveQ.data.recommendations ?? []).map((r: any, i: number) => (
                      <div key={i} data-testid={`rec-${i}`} className="flex gap-2 items-start rounded-lg border p-3">
                        <ChevronRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{r.recommendation}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.reasoning}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{r.category}</Badge>
                            <span className="text-xs text-muted-foreground">{r.confidenceScore}% confidence</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
