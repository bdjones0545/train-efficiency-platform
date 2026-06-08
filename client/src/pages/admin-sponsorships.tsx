import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeDollarSign, Plus, RefreshCw, Zap, TrendingUp, Users,
  CheckCircle, Clock, Star, AlertTriangle, ChevronRight,
  Building2, Mail, BookOpen, BarChart3, Brain, DollarSign,
  Heart, Shield,
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
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
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
  { id: "proposal",       label: "Proposal",       color: "bg-pink-500" },
  { id: "negotiation",    label: "Negotiation",    color: "bg-red-500" },
  { id: "sponsored",      label: "Sponsored",      color: "bg-green-500" },
  { id: "declined",       label: "Declined",       color: "bg-slate-400" },
];

const SPONSORSHIP_TYPES = [
  "local_business","national_brand","equipment_company","sports_nutrition",
  "recovery_company","community_organization","foundation","corporate_sponsor",
  "media_partner","general",
];

const SOURCES = ["referral","website","social_media","event","manual","partner","research"];

const DRAFT_TYPES = [
  { value: "introduction",                    label: "Introduction" },
  { value: "partnership_proposal",            label: "Partnership Proposal" },
  { value: "community_sponsorship",           label: "Community Sponsorship" },
  { value: "event_sponsorship",               label: "Event Sponsorship" },
  { value: "athlete_development_sponsorship", label: "Athlete Development" },
  { value: "facility_sponsorship",            label: "Facility Sponsorship" },
];

const INDUSTRIES = [
  "Sports & Fitness","Nutrition & Supplements","Sports Equipment","Healthcare & Recovery",
  "Apparel & Footwear","Technology","Finance","Real Estate","Food & Beverage","Other",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stageColor(status: string) {
  return STAGES.find(s => s.id === status)?.color ?? "bg-gray-400";
}
function stageLabel(status: string) {
  return STAGES.find(s => s.id === status)?.label ?? status;
}
function scoreColor(score: number) {
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-500";
}
function scoreBadge(score: number) {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

// ─── Add Sponsor Form ─────────────────────────────────────────────────────────

function AddSponsorDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState({
    organizationName: "", contactName: "", contactEmail: "", contactPhone: "",
    website: "", industry: "", location: "", sponsorshipType: "general",
    source: "manual", estimatedValue: "", notes: "",
  });
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/sponsorships", body),
    onSuccess: () => {
      toast({ title: "Sponsor added" });
      setOpen(false);
      setForm({
        organizationName: "", contactName: "", contactEmail: "", contactPhone: "",
        website: "", industry: "", location: "", sponsorshipType: "general",
        source: "manual", estimatedValue: "", notes: "",
      });
      onAdded();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-sponsor"><Plus className="w-4 h-4 mr-2" />Add Sponsor</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Sponsorship Opportunity</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div className="col-span-2">
            <Label>Organization Name *</Label>
            <Input data-testid="input-org-name" value={form.organizationName}
              onChange={e => setForm(f => ({ ...f, organizationName: e.target.value }))}
              placeholder="e.g. GNC Nutrition, Nike, Local Gym" />
          </div>
          <div>
            <Label>Contact Name</Label>
            <Input data-testid="input-contact-name" value={form.contactName}
              onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Jane Smith" />
          </div>
          <div>
            <Label>Contact Email</Label>
            <Input data-testid="input-contact-email" type="email" value={form.contactEmail}
              onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="jane@company.com" />
          </div>
          <div>
            <Label>Contact Phone</Label>
            <Input data-testid="input-contact-phone" value={form.contactPhone}
              onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="(555) 000-0000" />
          </div>
          <div>
            <Label>Website</Label>
            <Input data-testid="input-website" value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
          </div>
          <div>
            <Label>Industry</Label>
            <Select value={form.industry} onValueChange={v => setForm(f => ({ ...f, industry: v }))}>
              <SelectTrigger data-testid="select-industry"><SelectValue placeholder="Select industry" /></SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Location</Label>
            <Input data-testid="input-location" value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="City, State" />
          </div>
          <div>
            <Label>Sponsorship Type</Label>
            <Select value={form.sponsorshipType} onValueChange={v => setForm(f => ({ ...f, sponsorshipType: v }))}>
              <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPONSORSHIP_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
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
          <div>
            <Label>Estimated Value ($)</Label>
            <Input data-testid="input-estimated-value" type="number" value={form.estimatedValue}
              onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value }))} placeholder="5000" />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea data-testid="textarea-notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Brand details, audience, potential deal structure..." rows={3} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button data-testid="button-submit-sponsor"
            onClick={() => mutation.mutate(form)}
            disabled={!form.organizationName || mutation.isPending}>
            {mutation.isPending ? "Adding..." : "Add Sponsor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sponsors Tab ──────────────────────────────────────────────────────────────

function SponsorsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: sponsors = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sponsorships"],
  });

  const assessMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/sponsorships/${id}/assess`),
    onSuccess: () => { toast({ title: "Assessment complete" }); qc.invalidateQueries({ queryKey: ["/api/sponsorships"] }); qc.invalidateQueries({ queryKey: ["/api/sponsorships/assessments"] }); },
    onError: (e: any) => toast({ title: "Assessment failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/sponsorships/${id}/status`, { status }),
    onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: ["/api/sponsorships"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/sponsorships/${id}`),
    onSuccess: () => { toast({ title: "Sponsor removed" }); qc.invalidateQueries({ queryKey: ["/api/sponsorships"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading sponsors...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sponsors.length} total opportunities</p>
        <AddSponsorDialog onAdded={() => qc.invalidateQueries({ queryKey: ["/api/sponsorships"] })} />
      </div>

      {sponsors.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16">
            <BadgeDollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No sponsors yet</h3>
            <p className="text-muted-foreground mb-4">Add local businesses, brands, or organizations to start building your sponsorship pipeline.</p>
            <AddSponsorDialog onAdded={() => qc.invalidateQueries({ queryKey: ["/api/sponsorships"] })} />
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Est. Value</TableHead>
                <TableHead>Fit Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sponsors.map((s: any) => (
                <TableRow key={s.id} data-testid={`row-sponsor-${s.id}`}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{s.organization_name}</p>
                      {s.contact_name && <p className="text-xs text-muted-foreground">{s.contact_name}</p>}
                      {s.location && <p className="text-xs text-muted-foreground">{s.location}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {(s.sponsorship_type ?? "general").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {s.estimated_value > 0 ? `$${Number(s.estimated_value).toLocaleString()}` : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.fit_score > 0 ? (
                      <Badge variant={scoreBadge(s.fit_score)} data-testid={`text-fit-score-${s.id}`}>
                        {s.fit_score}/100
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not assessed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value={s.status}
                      onValueChange={v => statusMutation.mutate({ id: s.id, status: v })}>
                      <SelectTrigger className="w-36 h-7 text-xs" data-testid={`select-status-${s.id}`}>
                        <div className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${stageColor(s.status)}`} />
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map(st => (
                          <SelectItem key={st.id} value={st.id}>
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${st.color}`} />
                              {st.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" data-testid={`button-assess-${s.id}`}
                        onClick={() => assessMutation.mutate(s.id)}
                        disabled={assessMutation.isPending}>
                        <Zap className="w-3 h-3 mr-1" />Assess
                      </Button>
                      <Button size="sm" variant="ghost" data-testid={`button-delete-${s.id}`}
                        onClick={() => deleteMutation.mutate(s.id)}>
                        ✕
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Assessments Tab ──────────────────────────────────────────────────────────

function AssessmentsTab() {
  const { data: assessments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sponsorships/assessments"],
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading assessments...</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{assessments.length} assessments total</p>
      {assessments.length === 0 ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground">
          No assessments yet — run "Assess" on a sponsor to see results here.
        </CardContent></Card>
      ) : assessments.map((a: any) => (
        <Card key={a.id} data-testid={`card-assessment-${a.id}`}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold">{a.organization_name ?? "Unknown Organization"}</p>
                <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <Badge variant={scoreBadge(a.fit_score ?? 0)} className="text-sm">
                  {a.fit_score ?? 0}/100 fit
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">{a.recommended_action?.replace(/_/g, " ")}</p>
              </div>
            </div>
            {a.reasoning && <p className="text-sm text-muted-foreground mb-3">{a.reasoning}</p>}
            <div className="grid grid-cols-2 gap-4">
              {a.strengths?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-600 mb-1">Strengths</p>
                  <ul className="text-xs space-y-1">
                    {a.strengths.map((s: string, i: number) => (
                      <li key={i} className="flex items-start gap-1"><CheckCircle className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {a.concerns?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-500 mb-1">Concerns</p>
                  <ul className="text-xs space-y-1">
                    {a.concerns.map((c: string, i: number) => (
                      <li key={i} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Outreach Tab ──────────────────────────────────────────────────────────────

function OutreachTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [draftType, setDraftType]   = useState("introduction");

  const { data: sponsors = [] } = useQuery<any[]>({ queryKey: ["/api/sponsorships"] });
  const { data: drafts = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/sponsorships/outreach-drafts"] });

  const draftMutation = useMutation({
    mutationFn: ({ id, draftType }: { id: string; draftType: string }) =>
      apiRequest("POST", `/api/sponsorships/${id}/draft-outreach`, { draftType }),
    onSuccess: () => { toast({ title: "Draft generated" }); qc.invalidateQueries({ queryKey: ["/api/sponsorships/outreach-drafts"] }); },
    onError: (e: any) => toast({ title: "Draft failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate Outreach Draft</CardTitle>
          <CardDescription>AI-powered draft generation — no sending, review required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sponsor</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger data-testid="select-draft-sponsor">
                  <SelectValue placeholder="Select sponsor" />
                </SelectTrigger>
                <SelectContent>
                  {sponsors.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.organization_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Draft Type</Label>
              <Select value={draftType} onValueChange={setDraftType}>
                <SelectTrigger data-testid="select-draft-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DRAFT_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button data-testid="button-generate-draft"
            onClick={() => draftMutation.mutate({ id: selectedId, draftType })}
            disabled={!selectedId || draftMutation.isPending}>
            <Zap className="w-4 h-4 mr-2" />
            {draftMutation.isPending ? "Generating..." : "Generate Draft"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading drafts...</div>
      ) : drafts.length === 0 ? (
        <Card><CardContent className="text-center py-8 text-muted-foreground">
          No drafts yet — generate your first outreach above.
        </CardContent></Card>
      ) : drafts.map((d: any) => (
        <Card key={d.id} data-testid={`card-draft-${d.id}`}>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-sm">{d.organization_name}</p>
                <p className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</p>
              </div>
              <Badge variant="outline">{Math.round(d.confidence_score ?? 70)}% confidence</Badge>
            </div>
            <div className="bg-muted/40 rounded p-3 space-y-2">
              <p className="text-xs font-semibold">Subject: {d.subject}</p>
              <p className="text-xs whitespace-pre-wrap">{d.body}</p>
            </div>
            {d.positioning_angle && (
              <p className="text-xs text-muted-foreground italic">Angle: {d.positioning_angle}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Pipeline Tab ──────────────────────────────────────────────────────────────

function PipelineTab() {
  const { data: pipeline = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sponsorships/pipeline"],
  });

  const total = pipeline.reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading pipeline...</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {pipeline.map((row: any) => {
          const stage = STAGES.find(s => s.id === row.stage);
          return (
            <Card key={row.stage} data-testid={`card-pipeline-${row.stage}`}>
              <CardContent className="pt-4 text-center">
                <div className={`w-3 h-3 rounded-full ${stage?.color ?? "bg-gray-400"} mx-auto mb-2`} />
                <p className="text-2xl font-bold">{row.count}</p>
                <p className="text-xs text-muted-foreground">{stage?.label ?? row.stage}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2 flex-wrap">
            {pipeline.map((row: any) => {
              const stage = STAGES.find(s => s.id === row.stage);
              const pct   = total > 0 ? Math.round((Number(row.count) / total) * 100) : 0;
              return (
                <div key={row.stage} style={{ flex: `${Math.max(pct, 2)} 0 0%` }}
                  className={`h-6 ${stage?.color ?? "bg-gray-400"} rounded text-white text-xs flex items-center justify-center min-w-[2rem]`}>
                  {pct > 8 ? `${pct}%` : ""}
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 flex-wrap mt-3">
            {pipeline.map((row: any) => {
              const stage = STAGES.find(s => s.id === row.stage);
              return (
                <div key={row.stage} className="flex items-center gap-1.5 text-xs">
                  <div className={`w-2.5 h-2.5 rounded-full ${stage?.color ?? "bg-gray-400"}`} />
                  <span>{stage?.label ?? row.stage}: {row.count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Learning Tab ──────────────────────────────────────────────────────────────

function LearningTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/sponsorships/learning"],
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Computing learning metrics...</div>;

  const report   = data?.report;
  const insights = data?.insights ?? [];

  return (
    <div className="space-y-4">
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Signals",   value: report.totalSignals ?? 0,     icon: BarChart3 },
            { label: "Response Rate",   value: `${report.responseRate ?? 0}%`, icon: Mail },
            { label: "Conversion Rate", value: `${report.conversionRate ?? 0}%`, icon: TrendingUp },
            { label: "Win Rate",        value: `${report.winRate ?? 0}%`,     icon: Star },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className="w-4 h-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {insights.length === 0 ? (
          <Card><CardContent className="text-center py-8 text-muted-foreground">
            Not enough data yet — log learning signals by updating sponsor statuses.
          </CardContent></Card>
        ) : insights.map((ins: any, i: number) => (
          <Card key={i} data-testid={`card-insight-${i}`}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">{ins.title ?? ins.insight}</p>
                  {ins.detail && <p className="text-xs text-muted-foreground mt-1">{ins.detail}</p>}
                  {ins.recommendation && (
                    <p className="text-xs text-indigo-600 mt-1 font-medium">→ {ins.recommendation}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Executive Intelligence Tab ───────────────────────────────────────────────

function ExecutiveTab() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/sponsorships/executive"],
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Generating executive intelligence...</div>;

  const { brief, recommendations = [], bestAction } = data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-executive">
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {bestAction && (
        <Card className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-indigo-600 mt-0.5" />
              <div>
                <p className="text-xs text-indigo-600 font-semibold uppercase tracking-wide">Best Action Today</p>
                <p className="font-semibold">{bestAction.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{bestAction.description}</p>
                {bestAction.estimatedImpact && (
                  <p className="text-xs text-indigo-600 mt-1">Impact: {bestAction.estimatedImpact}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {brief && (
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { title: "Key Wins",          items: brief.keyWins,          color: "text-green-600",  icon: CheckCircle },
            { title: "Key Risks",         items: brief.keyRisks,         color: "text-red-500",    icon: AlertTriangle },
            { title: "Opportunities",     items: brief.keyOpportunities, color: "text-blue-600",   icon: TrendingUp },
          ].map(section => (
            <Card key={section.title}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm flex items-center gap-2 ${section.color}`}>
                  <section.icon className="w-4 h-4" />{section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {(section.items ?? []).map((item: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                      <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />{item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {brief?.summary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium">Summary</p>
            <p className="text-sm text-muted-foreground mt-1">{brief.summary}</p>
          </CardContent>
        </Card>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Strategic Recommendations</p>
          {recommendations.map((rec: any, i: number) => (
            <Card key={i} data-testid={`card-recommendation-${i}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start gap-3">
                  <Badge variant="outline" className="text-xs shrink-0">{rec.category}</Badge>
                  <div>
                    <p className="text-sm">{rec.recommendation}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rec.reasoning}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs">{rec.confidenceScore}%</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/sponsorships/health"],
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Running health checks...</div>;

  const checks = data?.healthChecks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{data?.checksPassed ?? 0}</p>
            <p className="text-xs text-muted-foreground">Passed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{(data?.checksRun ?? 0) - (data?.checksPassed ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{data?.alertsCreated ?? 0}</p>
            <p className="text-xs text-muted-foreground">Alerts</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-health">
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {checks.map((check: any) => (
        <Card key={check.id} data-testid={`card-health-${check.id}`}
          className={check.passed ? "border-green-200" : check.severity === "high" ? "border-red-300" : "border-yellow-300"}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                {check.passed
                  ? <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                  : <AlertTriangle className={`w-5 h-5 mt-0.5 ${check.severity === "high" ? "text-red-500" : "text-yellow-500"}`} />
                }
                <div>
                  <p className="font-medium text-sm">{check.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                  {!check.passed && check.recommendation && (
                    <p className="text-xs text-blue-600 mt-1">→ {check.recommendation}</p>
                  )}
                </div>
              </div>
              <Badge variant={check.passed ? "outline" : check.severity === "high" ? "destructive" : "secondary"}
                className="text-xs shrink-0">
                {check.passed ? "Pass" : check.severity}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}

      {data?.executiveSummary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium">Summary</p>
            <p className="text-sm text-muted-foreground mt-1">{data.executiveSummary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSponsorshipsPage() {
  const { data: sponsors = [] } = useQuery<any[]>({ queryKey: ["/api/sponsorships"] });
  const { data: pipeline = [] } = useQuery<any[]>({ queryKey: ["/api/sponsorships/pipeline"] });

  const total     = (pipeline as any[]).reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);
  const sponsored = (pipeline as any[]).find((r: any) => r.stage === "sponsored")?.count ?? 0;
  const active    = (pipeline as any[]).filter((r: any) =>
    ["meeting","proposal","negotiation"].includes(r.stage)
  ).reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);
  const qualified = (pipeline as any[]).find((r: any) => r.stage === "qualified")?.count ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <BadgeDollarSign className="w-7 h-7 text-indigo-600" />
            <h1 className="text-2xl font-bold">Sponsorship Department</h1>
            <Badge variant="outline" className="text-xs">Department OS v2</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Identify, qualify, develop, and manage sponsorship opportunities.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Opportunities", value: total,     icon: Users,          color: "text-blue-600" },
          { label: "Active Sponsors",     value: sponsored, icon: BadgeDollarSign, color: "text-green-600" },
          { label: "In Progress",         value: active,    icon: Clock,          color: "text-indigo-600" },
          { label: "Qualified",           value: qualified, icon: Star,           color: "text-yellow-600" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </div>
              <p className="text-3xl font-bold">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="sponsors">
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="sponsors"   data-testid="tab-sponsors"><Building2 className="w-3 h-3 mr-1" />Sponsors</TabsTrigger>
          <TabsTrigger value="assessments" data-testid="tab-assessments"><Star className="w-3 h-3 mr-1" />Assessments</TabsTrigger>
          <TabsTrigger value="outreach"   data-testid="tab-outreach"><Mail className="w-3 h-3 mr-1" />Outreach</TabsTrigger>
          <TabsTrigger value="pipeline"   data-testid="tab-pipeline"><BarChart3 className="w-3 h-3 mr-1" />Pipeline</TabsTrigger>
          <TabsTrigger value="learning"   data-testid="tab-learning"><BookOpen className="w-3 h-3 mr-1" />Learning</TabsTrigger>
          <TabsTrigger value="executive"  data-testid="tab-executive"><Brain className="w-3 h-3 mr-1" />Executive</TabsTrigger>
          <TabsTrigger value="health"     data-testid="tab-health"><Shield className="w-3 h-3 mr-1" />Health</TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="sponsors"><SponsorsTab /></TabsContent>
          <TabsContent value="assessments"><AssessmentsTab /></TabsContent>
          <TabsContent value="outreach"><OutreachTab /></TabsContent>
          <TabsContent value="pipeline"><PipelineTab /></TabsContent>
          <TabsContent value="learning"><LearningTab /></TabsContent>
          <TabsContent value="executive"><ExecutiveTab /></TabsContent>
          <TabsContent value="health"><HealthTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
