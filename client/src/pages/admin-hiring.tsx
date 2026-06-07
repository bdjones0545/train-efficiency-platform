import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, UserPlus, Briefcase, Star, TrendingUp, CheckCircle,
  AlertTriangle, ChevronRight, Brain, Lightbulb, Target,
  Mail, BarChart3, Loader2, Trash2, ArrowRight, Zap,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  position: string;
  source: string;
  experience_level: string;
  resume_url: string | null;
  notes: string | null;
  status: string;
  fit_score: number;
  created_at: string;
  updated_at: string;
}

interface Assessment {
  id: string;
  candidate_id: string;
  fit_score: number;
  experience_score: number;
  culture_score: number;
  confidence_score: number;
  recommended_action: string;
  reasoning: string;
  strengths: string[];
  concerns: string[];
  next_steps: string[];
  created_at: string;
  first_name?: string;
  last_name?: string;
  position?: string;
}

interface OutreachDraft {
  id: string;
  candidate_id: string;
  subject: string;
  body: string;
  status: string;
  positioning_angle: string;
  confidence_score: number;
  created_at: string;
  first_name?: string;
  last_name?: string;
  position?: string;
}

interface PipelineData {
  new: Candidate[];
  qualified: Candidate[];
  outreach_ready: Candidate[];
  contacted: Candidate[];
  interested: Candidate[];
  interview: Candidate[];
  offer: Candidate[];
  hired: Candidate[];
  rejected: Candidate[];
}

interface LearningData {
  metrics: {
    totalSignals: number;
    totalCandidates: number;
    averageFitScore: number;
    interviewRate: number;
    hireRate: number;
    rejectionRate: number;
    topSource: string | null;
    topPosition: string | null;
    sourceBreakdown: Record<string, { count: number; avgFit: number; hireRate: number }>;
  };
  insights: Array<{ category: string; insight: string; confidence: number; impact: string; actionable: boolean }>;
}

interface ExecutiveData {
  brief: {
    id: string;
    summary: string;
    best_action_today: string;
    key_wins: string[];
    key_risks: string[];
    key_opportunities: string[];
    metrics: Record<string, number | string>;
    created_at: string;
  } | null;
  recommendations: Array<{
    id: string;
    category: string;
    recommendation: string;
    reasoning: string;
    confidence_score: number;
    status: string;
    created_at: string;
  }>;
  bestAction: {
    title: string;
    description: string;
    priority: string;
    route: string;
    estimatedImpact?: string;
  } | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new:           "bg-slate-100 text-slate-700",
  qualified:     "bg-blue-100 text-blue-700",
  outreach_ready:"bg-purple-100 text-purple-700",
  contacted:     "bg-yellow-100 text-yellow-700",
  interested:    "bg-orange-100 text-orange-700",
  interview:     "bg-indigo-100 text-indigo-700",
  offer:         "bg-emerald-100 text-emerald-700",
  hired:         "bg-green-100 text-green-700",
  rejected:      "bg-red-100 text-red-700",
};

const PIPELINE_STAGES = [
  { key: "new",           label: "New" },
  { key: "qualified",     label: "Qualified" },
  { key: "outreach_ready",label: "Ready" },
  { key: "contacted",     label: "Contacted" },
  { key: "interested",    label: "Interested" },
  { key: "interview",     label: "Interview" },
  { key: "offer",         label: "Offer" },
  { key: "hired",         label: "Hired" },
];

function FitBadge({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-100 text-green-700" : score >= 55 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${color}`}>{score}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700",
    high:     "bg-orange-100 text-orange-700",
    medium:   "bg-yellow-100 text-yellow-700",
    low:      "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize ${map[priority] ?? map.low}`}>{priority}</span>;
}

// ─── Add Candidate Dialog ──────────────────────────────────────────────────────

function AddCandidateDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", location: "",
    position: "", source: "manual", experienceLevel: "mid", resumeUrl: "", notes: "",
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hiring/candidates", form),
    onSuccess: () => {
      toast({ title: "Candidate added" });
      setOpen(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", location: "", position: "", source: "manual", experienceLevel: "mid", resumeUrl: "", notes: "" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-candidate" className="gap-2">
          <UserPlus className="h-4 w-4" /> Add Candidate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div><Label>First Name *</Label><Input data-testid="input-first-name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} /></div>
          <div><Label>Last Name *</Label><Input data-testid="input-last-name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} /></div>
          <div><Label>Email</Label><Input data-testid="input-email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input data-testid="input-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          <div className="col-span-2"><Label>Position *</Label><Input data-testid="input-position" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="e.g. Head Coach, Trainer, Intern" /></div>
          <div>
            <Label>Source</Label>
            <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
              <SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="coach">Coach Network</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="job_board">Job Board</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Experience Level</Label>
            <Select value={form.experienceLevel} onValueChange={v => setForm(f => ({ ...f, experienceLevel: v }))}>
              <SelectTrigger data-testid="select-experience"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="entry">Entry</SelectItem>
                <SelectItem value="junior">Junior</SelectItem>
                <SelectItem value="mid">Mid</SelectItem>
                <SelectItem value="senior">Senior</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Location</Label><Input data-testid="input-location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
          <div className="col-span-2"><Label>Notes</Label><Textarea data-testid="input-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Qualifications, certifications, impressions..." /></div>
        </div>
        <Button data-testid="button-submit-candidate" className="w-full mt-2" onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.firstName || !form.lastName || !form.position}>
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Add Candidate
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─── Candidates Tab ────────────────────────────────────────────────────────────

function CandidatesTab() {
  const { toast } = useToast();
  const { data: candidates = [], isLoading, refetch } = useQuery<Candidate[]>({ queryKey: ["/api/hiring/candidates"] });

  const assessMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/hiring/candidates/${id}/assess`, {}),
    onSuccess: () => { toast({ title: "Assessment complete" }); refetch(); queryClient.invalidateQueries({ queryKey: ["/api/hiring/assessments"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/hiring/candidates/${id}`),
    onSuccess: () => { toast({ title: "Candidate removed" }); refetch(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/hiring/candidates/${id}/status`, { status }),
    onSuccess: () => refetch(),
  });

  const total       = candidates.length;
  const qualified   = candidates.filter(c => c.status === "qualified").length;
  const interviewing= candidates.filter(c => c.status === "interview").length;
  const hired       = candidates.filter(c => c.status === "hired").length;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Candidates", value: total, icon: Users, color: "text-blue-500" },
          { label: "Qualified", value: qualified, icon: CheckCircle, color: "text-purple-500" },
          { label: "Interviewing", value: interviewing, icon: Briefcase, color: "text-indigo-500" },
          { label: "Hired", value: hired, icon: Star, color: "text-green-500" },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1" data-testid={`stat-${stat.label.toLowerCase().replace(/ /g,"-")}`}>{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-70`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">All Candidates</h3>
        <AddCandidateDialog onSuccess={refetch} />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No candidates yet</p>
          <p className="text-sm mt-1">Add your first candidate to get started.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Fit</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {candidates.map(c => (
                <tr key={c.id} data-testid={`row-candidate-${c.id}`} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{c.first_name} {c.last_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.position}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{(c.source ?? "manual").replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    <Select value={c.status} onValueChange={status => statusMutation.mutate({ id: c.id, status })}>
                      <SelectTrigger data-testid={`select-status-${c.id}`} className="h-7 text-xs w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["new","qualified","outreach_ready","contacted","interested","interview","offer","hired","rejected"].map(s => (
                          <SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3"><FitBadge score={c.fit_score} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button data-testid={`button-assess-${c.id}`} size="sm" variant="outline" className="h-7 text-xs" onClick={() => assessMutation.mutate(c.id)} disabled={assessMutation.isPending}>
                        <Brain className="h-3 w-3 mr-1" /> Assess
                      </Button>
                      <Button data-testid={`button-delete-${c.id}`} size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => deleteMutation.mutate(c.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Assessments Tab ───────────────────────────────────────────────────────────

function AssessmentsTab() {
  const { data: assessments = [], isLoading } = useQuery<Assessment[]>({ queryKey: ["/api/hiring/assessments"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Candidate Assessments</h3>
        <span className="text-sm text-muted-foreground">{assessments.length} assessments</span>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : assessments.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Brain className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No assessments yet</p>
          <p className="text-sm mt-1">Click "Assess" on a candidate to generate a score.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {assessments.map(a => (
            <Card key={a.id} data-testid={`card-assessment-${a.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{a.first_name} {a.last_name} — {a.position}</CardTitle>
                  <FitBadge score={a.fit_score} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{a.reasoning}</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="text-center"><div className="text-xs text-muted-foreground">Experience</div><div className="font-semibold">{a.experience_score}/100</div></div>
                  <div className="text-center"><div className="text-xs text-muted-foreground">Culture</div><div className="font-semibold">{a.culture_score}/100</div></div>
                  <div className="text-center"><div className="text-xs text-muted-foreground">Confidence</div><div className="font-semibold">{a.confidence_score}%</div></div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  {[{ label: "Strengths", items: a.strengths, color: "text-green-700" },
                    { label: "Concerns", items: a.concerns, color: "text-red-700" },
                    { label: "Next Steps", items: a.next_steps, color: "text-blue-700" }].map(section => (
                    <div key={section.label}>
                      <p className={`text-xs font-semibold mb-1 ${section.color}`}>{section.label}</p>
                      <ul className="text-xs space-y-1 text-muted-foreground">
                        {(section.items ?? []).map((item, i) => <li key={i} className="flex gap-1"><span>•</span><span>{item}</span></li>)}
                      </ul>
                    </div>
                  ))}
                </div>
                <Badge variant="outline" className="text-xs capitalize">{(a.recommended_action ?? "").replace(/_/g," ")}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Outreach Tab ──────────────────────────────────────────────────────────────

function OutreachTab() {
  const { toast } = useToast();
  const { data: drafts = [], isLoading, refetch } = useQuery<OutreachDraft[]>({ queryKey: ["/api/hiring/outreach"] });
  const { data: candidates = [] } = useQuery<Candidate[]>({ queryKey: ["/api/hiring/candidates"] });
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [outreachType, setOutreachType] = useState<string>("interview_invitation");
  const [expanded, setExpanded] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/hiring/candidates/${selectedCandidate}/outreach`, { outreachType }),
    onSuccess: () => { toast({ title: "Draft generated" }); refetch(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Generate Outreach Draft</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Candidate</Label>
              <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
                <SelectTrigger data-testid="select-candidate-outreach"><SelectValue placeholder="Select candidate" /></SelectTrigger>
                <SelectContent>
                  {(candidates as Candidate[]).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name} — {c.position}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={outreachType} onValueChange={setOutreachType}>
                <SelectTrigger data-testid="select-outreach-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interview_invitation">Interview Invitation</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="application_request">Application Request</SelectItem>
                  <SelectItem value="offer_letter_intro">Offer Letter Intro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button data-testid="button-generate-draft" className="mt-3 gap-2" onClick={() => generateMutation.mutate()} disabled={!selectedCandidate || generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Generate Draft
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="font-semibold">Outreach Drafts ({drafts.length})</h3>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : drafts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Mail className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No drafts yet. Generate one above.</p>
          </div>
        ) : (
          drafts.map(d => (
            <Card key={d.id} data-testid={`card-draft-${d.id}`}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{d.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.first_name} {d.last_name} · {d.position}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{d.confidence_score}% confidence</span>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === d.id ? "rotate-90" : ""}`} />
                  </div>
                </div>
              </CardHeader>
              {expanded === d.id && (
                <CardContent className="pt-0">
                  <pre className="whitespace-pre-wrap text-sm bg-muted/30 rounded p-3 font-sans">{d.body}</pre>
                  <p className="text-xs text-muted-foreground mt-2 italic">Angle: {d.positioning_angle}</p>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Pipeline Tab ──────────────────────────────────────────────────────────────

function PipelineTab() {
  const { data: pipeline, isLoading } = useQuery<PipelineData>({ queryKey: ["/api/hiring/pipeline"] });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Hiring Pipeline</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {PIPELINE_STAGES.map(stage => {
          const cards = (pipeline as any)?.[stage.key] ?? [];
          return (
            <div key={stage.key} className="flex-shrink-0 w-48 bg-muted/20 rounded-lg p-3 min-h-[200px]" data-testid={`pipeline-col-${stage.key}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stage.label}</span>
                <span className="text-xs bg-muted rounded-full px-1.5 py-0.5 font-medium">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((c: Candidate) => (
                  <div key={c.id} className="bg-white dark:bg-card rounded-md p-2.5 border shadow-sm" data-testid={`pipeline-card-${c.id}`}>
                    <p className="text-xs font-medium truncate">{c.first_name} {c.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.position}</p>
                    <FitBadge score={c.fit_score} />
                  </div>
                ))}
                {cards.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Empty</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Learning Tab ──────────────────────────────────────────────────────────────

function LearningTab() {
  const { data, isLoading } = useQuery<LearningData>({ queryKey: ["/api/hiring/learning"] });
  const m = data?.metrics;
  const insights = data?.insights ?? [];

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {m && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "Total Candidates", value: m.totalCandidates },
            { label: "Avg Fit Score", value: `${m.averageFitScore}/100` },
            { label: "Interview Rate", value: `${m.interviewRate}%` },
            { label: "Hire Rate", value: `${m.hireRate}%` },
            { label: "Rejection Rate", value: `${m.rejectionRate}%` },
            { label: "Top Source", value: m.topSource ?? "—" },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold mt-1" data-testid={`learning-stat-${stat.label.toLowerCase().replace(/ /g,"-")}`}>{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-yellow-500" />Learning Insights</h3>
        {insights.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Add more candidates to generate insights.</div>
        ) : (
          <div className="space-y-3">
            {insights.map((ins, i) => (
              <Card key={i} data-testid={`card-insight-${i}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm">{ins.insight}</p>
                    <div className="flex gap-1 flex-shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">{ins.category}</Badge>
                      <Badge variant="outline" className={`text-xs ${ins.impact === "high" ? "border-orange-300 text-orange-600" : ins.impact === "medium" ? "border-yellow-300 text-yellow-600" : "border-slate-300"}`}>{ins.impact}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Confidence: {ins.confidence}%</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {m && Object.keys(m.sourceBreakdown).length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Source Performance</h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-left">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Candidates</th>
                <th className="px-4 py-2 font-medium">Avg Fit</th>
                <th className="px-4 py-2 font-medium">Hire Rate</th>
              </tr></thead>
              <tbody className="divide-y">
                {Object.entries(m.sourceBreakdown).map(([src, bd]) => (
                  <tr key={src} data-testid={`row-source-${src}`}>
                    <td className="px-4 py-2 capitalize font-medium">{src.replace("_"," ")}</td>
                    <td className="px-4 py-2">{bd.count}</td>
                    <td className="px-4 py-2"><FitBadge score={bd.avgFit} /></td>
                    <td className="px-4 py-2">{bd.hireRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Executive Intelligence Tab ────────────────────────────────────────────────

function ExecutiveTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<ExecutiveData>({ queryKey: ["/api/hiring/executive"] });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hiring/executive/run", {}),
    onSuccess: () => { toast({ title: "Analysis complete" }); refetch(); queryClient.invalidateQueries({ queryKey: ["/api/hiring/recommendations"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const recMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/hiring/recommendations/${id}`, { status }),
    onSuccess: () => refetch(),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const { brief, recommendations = [], bestAction } = data ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2"><Brain className="h-5 w-5 text-purple-500" />Executive Intelligence</h3>
        <Button data-testid="button-run-analysis" variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="gap-2">
          {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Run Analysis
        </Button>
      </div>

      {/* Best Action */}
      {bestAction && (
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-blue-600 mb-1">BEST ACTION TODAY</p>
                <p className="font-semibold">{bestAction.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{bestAction.description}</p>
                {bestAction.estimatedImpact && <p className="text-xs text-muted-foreground mt-1 italic">Impact: {bestAction.estimatedImpact}</p>}
              </div>
              <PriorityBadge priority={bestAction.priority} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Executive Brief */}
      {brief && (
        <Card>
          <CardHeader><CardTitle className="text-base">Executive Brief</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{brief.summary}</p>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { label: "Key Wins",          items: brief.key_wins,          color: "text-green-600", bg: "bg-green-50" },
                { label: "Key Risks",         items: brief.key_risks,         color: "text-red-600",   bg: "bg-red-50" },
                { label: "Opportunities",     items: brief.key_opportunities, color: "text-blue-600",  bg: "bg-blue-50" },
              ].map(section => (
                <div key={section.label} className={`rounded-lg p-3 ${section.bg}`}>
                  <p className={`text-xs font-semibold mb-2 ${section.color}`}>{section.label}</p>
                  {(section.items ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">None recorded</p>
                  ) : (
                    <ul className="space-y-1">
                      {(section.items ?? []).map((item, i) => (
                        <li key={i} className="text-xs flex gap-1"><span>•</span><span>{item}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4 text-orange-500" />Recommendations</h3>
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>Run analysis above to generate recommendations.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map(rec => (
              <Card key={rec.id} data-testid={`card-recommendation-${rec.id}`} className={rec.status !== "pending" ? "opacity-60" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs capitalize">{rec.category}</Badge>
                        <span className="text-xs text-muted-foreground">Confidence: {rec.confidence_score}%</span>
                      </div>
                      <p className="text-sm font-medium">{rec.recommendation}</p>
                      <p className="text-xs text-muted-foreground mt-1">{rec.reasoning}</p>
                    </div>
                    {rec.status === "pending" && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button data-testid={`button-accept-${rec.id}`} size="sm" variant="outline" className="h-7 text-xs text-green-600 border-green-200 hover:bg-green-50" onClick={() => recMutation.mutate({ id: rec.id, status: "accepted" })}>Accept</Button>
                        <Button data-testid={`button-dismiss-${rec.id}`} size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => recMutation.mutate({ id: rec.id, status: "dismissed" })}>Dismiss</Button>
                      </div>
                    )}
                    {rec.status !== "pending" && <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{rec.status}</Badge>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminHiringPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Briefcase className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Hiring Department</h1>
            <p className="text-sm text-muted-foreground">Department OS v1 · Candidate pipeline, AI assessment, executive intelligence</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1 text-xs">
          <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Department OS Active
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="candidates">
        <TabsList className="mb-6 flex-wrap h-auto gap-1">
          <TabsTrigger value="candidates" data-testid="tab-candidates" className="gap-1.5"><Users className="h-3.5 w-3.5" />Candidates</TabsTrigger>
          <TabsTrigger value="assessments" data-testid="tab-assessments" className="gap-1.5"><Brain className="h-3.5 w-3.5" />Assessments</TabsTrigger>
          <TabsTrigger value="outreach" data-testid="tab-outreach" className="gap-1.5"><Mail className="h-3.5 w-3.5" />Outreach</TabsTrigger>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" />Pipeline</TabsTrigger>
          <TabsTrigger value="learning" data-testid="tab-learning" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Learning</TabsTrigger>
          <TabsTrigger value="executive" data-testid="tab-executive" className="gap-1.5"><Star className="h-3.5 w-3.5" />Executive Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates"><CandidatesTab /></TabsContent>
        <TabsContent value="assessments"><AssessmentsTab /></TabsContent>
        <TabsContent value="outreach"><OutreachTab /></TabsContent>
        <TabsContent value="pipeline"><PipelineTab /></TabsContent>
        <TabsContent value="learning"><LearningTab /></TabsContent>
        <TabsContent value="executive"><ExecutiveTab /></TabsContent>
      </Tabs>
    </div>
  );
}
