import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Zap, Play, Pause, Plus, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, Loader2, RefreshCw, Users, BarChart3, Calendar,
  Brain, BellRing, BookOpen, Activity, ArrowRight, ListChecks,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WorkflowStep {
  id?: string;
  stepOrder: number;
  actionType: string;
  config: Record<string, any>;
}

interface Workflow {
  id: string;
  title: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, any>;
  status: string;
  isTemplate: boolean;
  templateKey: string | null;
  runCount: number;
  steps: WorkflowStep[];
  createdAt: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  athleteUserId: string;
  triggerEvent: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, any>;
}

interface Followup {
  id: string;
  athleteUserId: string;
  followupDate: string;
  status: string;
  notes: string | null;
}

interface Intervention {
  id: string;
  athleteUserId: string;
  recommendationType: string;
  title: string;
  summary: string;
  suggestedAction: string;
  severity: string;
  status: string;
  generatedBy: string;
  coachNotes: string | null;
  createdAt: string;
  latestSnapshot: any;
  followups: Followup[];
}

interface Stats {
  activeWorkflows: number;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  resolutionRate: number;
  pendingFollowups: number;
  pendingInterventions: number;
}

interface OrgMember {
  userId: string;
  name: string;
  email: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  low_readiness: "Low Readiness",
  missed_workouts: "Missed Workouts",
  fatigue: "High Fatigue",
  education_noncompliance: "Education Noncompliance",
  pr_stagnation: "PR Plateau",
  low_engagement: "Low Engagement",
  manual: "Manual Trigger",
};

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  notify: { label: "Send Notification", icon: <BellRing className="h-3.5 w-3.5" />, color: "text-blue-400" },
  create_intervention: { label: "Create Intervention", icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-yellow-400" },
  assign_education: { label: "Assign Education", icon: <BookOpen className="h-3.5 w-3.5" />, color: "text-purple-400" },
  schedule_followup: { label: "Schedule Follow-Up", icon: <Calendar className="h-3.5 w-3.5" />, color: "text-green-400" },
  coach_review: { label: "Request Coach Review", icon: <Users className="h-3.5 w-3.5" />, color: "text-orange-400" },
  ai_recommendation: { label: "AI Recommendation", icon: <Brain className="h-3.5 w-3.5" />, color: "text-emerald-400" },
  modify_status: { label: "Modify Status", icon: <Activity className="h-3.5 w-3.5" />, color: "text-red-400" },
};

const SEVERITY_CONFIG: Record<string, { label: string; class: string }> = {
  info: { label: "Info", class: "bg-blue-900/40 text-blue-300 border-blue-700" },
  moderate: { label: "Moderate", class: "bg-yellow-900/40 text-yellow-300 border-yellow-700" },
  important: { label: "Important", class: "bg-orange-900/40 text-orange-300 border-orange-700" },
  critical: { label: "Critical", class: "bg-red-900/40 text-red-300 border-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const conf: Record<string, string> = {
    active: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    paused: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    archived: "bg-neutral-800 text-neutral-400 border-neutral-600",
    completed: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    failed: "bg-red-900/40 text-red-300 border-red-700",
    running: "bg-blue-900/40 text-blue-300 border-blue-700",
    pending: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    dismissed: "bg-neutral-800 text-neutral-400 border-neutral-600",
    accepted: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${conf[status] ?? "bg-neutral-800 text-neutral-300 border-neutral-600"}`}>
      {status}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: number | string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <Card className="bg-neutral-900 border-neutral-700">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-neutral-400">{label}</p>
            {sub && <p className="text-xs text-neutral-500">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────
function WorkflowCard({
  wf, orgId, onToggle, onTrigger, athletes,
}: {
  wf: Workflow;
  orgId: string;
  onToggle: (id: string, status: string) => void;
  onTrigger: (id: string, athleteUserId: string) => void;
  athletes: OrgMember[];
}) {
  const [showTrigger, setShowTrigger] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState("");

  return (
    <Card className="bg-neutral-900 border-neutral-700 hover:border-neutral-500 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white text-sm truncate">{wf.title}</h3>
              <StatusBadge status={wf.status} />
              {wf.isTemplate && (
                <span className="text-xs text-neutral-500 border border-neutral-700 px-1.5 py-0.5 rounded">Template</span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{wf.description}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {wf.status === "active" ? (
              <Button size="sm" variant="outline" className="h-7 px-2 border-neutral-700 bg-neutral-800 hover:bg-yellow-900/30 text-neutral-300 text-xs"
                onClick={() => onToggle(wf.id, "paused")} data-testid={`btn-pause-workflow-${wf.id}`}>
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
            ) : wf.status === "paused" ? (
              <Button size="sm" variant="outline" className="h-7 px-2 border-neutral-700 bg-neutral-800 hover:bg-emerald-900/30 text-neutral-300 text-xs"
                onClick={() => onToggle(wf.id, "active")} data-testid={`btn-activate-workflow-${wf.id}`}>
                <Play className="h-3 w-3 mr-1" /> Activate
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-yellow-500" />
            Trigger: <span className="text-neutral-300 ml-0.5">{TRIGGER_LABELS[wf.triggerType] ?? wf.triggerType}</span>
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="h-3 w-3" />
            {wf.steps.length} step{wf.steps.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <Play className="h-3 w-3" />
            {wf.runCount} run{wf.runCount !== 1 ? "s" : ""}
          </span>
        </div>

        {wf.steps.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {wf.steps.map((step, i) => {
              const meta = ACTION_LABELS[step.actionType];
              return (
                <span key={i} className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 ${meta?.color ?? "text-neutral-400"}`}>
                  {meta?.icon}
                  {meta?.label ?? step.actionType}
                </span>
              );
            })}
          </div>
        )}

        {wf.status === "active" && (
          <div>
            {!showTrigger ? (
              <Button size="sm" variant="outline"
                className="h-7 w-full border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-emerald-900/30 text-xs"
                onClick={() => setShowTrigger(true)} data-testid={`btn-trigger-open-${wf.id}`}>
                <Play className="h-3 w-3 mr-1" /> Trigger for Athlete
              </Button>
            ) : (
              <div className="flex gap-2 items-center">
                <Select value={selectedAthlete} onValueChange={setSelectedAthlete}>
                  <SelectTrigger className="h-7 bg-neutral-800 border-neutral-700 text-xs flex-1">
                    <SelectValue placeholder="Select athlete…" />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-900 border-neutral-700">
                    {athletes.map((a) => (
                      <SelectItem key={a.userId} value={a.userId} className="text-neutral-300 text-xs">
                        {a.name || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!selectedAthlete}
                  className="h-7 bg-emerald-700 hover:bg-emerald-600 text-xs"
                  onClick={() => { onTrigger(wf.id, selectedAthlete); setShowTrigger(false); setSelectedAthlete(""); }}
                  data-testid={`btn-trigger-confirm-${wf.id}`}>
                  Run
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-neutral-400"
                  onClick={() => { setShowTrigger(false); setSelectedAthlete(""); }}>Cancel</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Create Workflow Modal ─────────────────────────────────────────────────────
function CreateWorkflowModal({ onCreated, buildHeaders }: { onCreated: () => void; buildHeaders: () => Record<string, string> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [steps, setSteps] = useState<{ actionType: string; configJson: string }[]>([
    { actionType: "notify", configJson: JSON.stringify({ target: "coach", message: "Workflow triggered." }, null, 2) },
  ]);

  const createMut = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/org/adaptive-workflows", {
        title, description, triggerType,
        steps: steps.map((s, i) => ({ stepOrder: i + 1, actionType: s.actionType, config: JSON.parse(s.configJson || "{}") })),
      }, buildHeaders());
    },
    onSuccess: () => {
      toast({ title: "Workflow created", description: `"${title}" is now active.` });
      setOpen(false);
      setTitle(""); setDescription(""); setTriggerType("");
      setSteps([{ actionType: "notify", configJson: JSON.stringify({ target: "coach", message: "" }, null, 2) }]);
      onCreated();
    },
    onError: () => toast({ title: "Error", description: "Failed to create workflow.", variant: "destructive" }),
  });

  const addStep = () => setSteps((prev) => [...prev, { actionType: "notify", configJson: JSON.stringify({ target: "coach", message: "" }, null, 2) }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-700 hover:bg-emerald-600 text-white" data-testid="btn-create-workflow">
          <Plus className="h-4 w-4 mr-2" /> Create Workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Coaching Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label className="text-neutral-300 text-sm">Workflow Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Low Readiness Response"
                className="bg-neutral-800 border-neutral-600 text-white mt-1" data-testid="input-workflow-title" />
            </div>
            <div>
              <Label className="text-neutral-300 text-sm">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this workflow do?"
                className="bg-neutral-800 border-neutral-600 text-white mt-1 h-20" />
            </div>
            <div>
              <Label className="text-neutral-300 text-sm">Trigger Type *</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger className="bg-neutral-800 border-neutral-600 text-neutral-300 mt-1" data-testid="select-trigger-type">
                  <SelectValue placeholder="Select trigger…" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-900 border-neutral-700">
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-neutral-300">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-neutral-300 text-sm">Workflow Steps</Label>
              <Button size="sm" variant="outline" onClick={addStep}
                className="h-7 border-neutral-700 bg-neutral-800 text-neutral-300 text-xs" data-testid="btn-add-step">
                <Plus className="h-3 w-3 mr-1" /> Add Step
              </Button>
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="bg-neutral-800 border border-neutral-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-400">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => removeStep(i)}
                        className="h-6 px-2 text-xs text-red-400 hover:text-red-300">Remove</Button>
                    )}
                  </div>
                  <Select value={step.actionType} onValueChange={(v) => setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, actionType: v } : s))}>
                    <SelectTrigger className="bg-neutral-700 border-neutral-600 text-neutral-300 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-900 border-neutral-700">
                      {Object.entries(ACTION_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-neutral-300 text-xs">{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div>
                    <Label className="text-neutral-500 text-xs mb-1">Config (JSON)</Label>
                    <Textarea value={step.configJson}
                      onChange={(e) => setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, configJson: e.target.value } : s))}
                      className="bg-neutral-700 border-neutral-600 text-neutral-300 text-xs font-mono h-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-neutral-700" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1 bg-emerald-700 hover:bg-emerald-600"
              disabled={!title || !triggerType || createMut.isPending}
              onClick={() => createMut.mutate()} data-testid="btn-save-workflow">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Workflow"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CoachWorkflowsPage() {
  const { slug } = useParams();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("workflows");

  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? null;
  const { hasAccess, isHydrating } = usePermissions(slug ?? "");

  const buildHeaders = (): Record<string, string> => ({
    ...getAuthHeaders(),
    ...(orgToken ? { "X-Org-Auth-Token": orgToken } : {}),
  });

  if (!isHydrating && !orgToken && !hasAccess) {
    console.warn("[AUTH DRIFT DETECTED]", {
      page: "coach-workflows",
      slug,
      hasAccess,
      isHydrating,
      orgTokenPresent: !!orgToken,
    });
  }

  // Get orgId for query keys
  const { data: pubCtx } = useQuery<{ orgId: string }>({
    queryKey: [`/api/org/by-slug/${slug}/nav-context`],
    queryFn: () => fetchJson(`/api/org/by-slug/${slug}/nav-context`, { headers: buildHeaders() }),
    staleTime: 60_000,
    enabled: !!slug,
  });
  const orgId = pubCtx?.orgId ?? "";
  const canLoad = !!orgId && !isHydrating && (!!orgToken || hasAccess);

  const { data: wfData, isLoading: wfLoading, refetch: refetchWf } = useQuery<{ workflows: Workflow[] }>({
    queryKey: ["/api/org/adaptive-workflows", orgId],
    queryFn: () =>
      fetchJson("/api/org/adaptive-workflows", { headers: buildHeaders() }),
    enabled: canLoad,
    staleTime: 15_000,
  });

  const { data: statsData } = useQuery<Stats>({
    queryKey: ["/api/org/adaptive-workflows/stats", orgId],
    queryFn: () =>
      fetchJson("/api/org/adaptive-workflows/stats", { headers: buildHeaders() }),
    enabled: canLoad,
    staleTime: 30_000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ["/api/org/adaptive-workflows/runs/recent", orgId],
    queryFn: () =>
      fetchJson("/api/org/adaptive-workflows/runs/recent", { headers: buildHeaders() }),
    enabled: canLoad && activeTab === "history",
    staleTime: 15_000,
  });

  const { data: followupsData, isLoading: followupsLoading } = useQuery<{ followups: Followup[] }>({
    queryKey: ["/api/org/adaptive-followups", orgId],
    queryFn: () =>
      fetchJson("/api/org/adaptive-followups", { headers: buildHeaders() }),
    enabled: canLoad && activeTab === "followups",
    staleTime: 15_000,
  });

  const { data: interventionsData, isLoading: interventionsLoading } = useQuery<{ interventions: Intervention[] }>({
    queryKey: ["/api/org/interventions/full", orgId],
    queryFn: () =>
      fetchJson("/api/org/interventions/full", { headers: buildHeaders() }),
    enabled: canLoad && activeTab === "interventions",
    staleTime: 15_000,
  });

  const { data: athletesData } = useQuery<{ members: OrgMember[] }>({
    queryKey: ["/api/org/members/athletes", orgId],
    queryFn: () =>
      fetchJson("/api/org/members/athletes", { headers: buildHeaders() }),
    enabled: canLoad,
    staleTime: 60_000,
  });
  const athletes = athletesData?.members ?? [];

  const toggleMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/adaptive-workflows/${id}`, { status }, buildHeaders()),
    onSuccess: () => {
      toast({ title: "Workflow updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows", orgId] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows/stats", orgId] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const triggerMut = useMutation({
    mutationFn: ({ id, athleteUserId }: { id: string; athleteUserId: string }) =>
      apiRequest("POST", `/api/org/adaptive-workflows/${id}/trigger`, { athleteUserId }, buildHeaders()),
    onSuccess: (data: any) => {
      toast({ title: "Workflow triggered", description: `${data?.stepsExecuted ?? 0} steps executed.` });
      queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows/runs/recent", orgId] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/interventions/full", orgId] });
    },
    onError: () => toast({ title: "Workflow failed", variant: "destructive" }),
  });

  const followupMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      apiRequest("PATCH", `/api/org/adaptive-followups/${id}`, { status, notes }, buildHeaders()),
    onSuccess: () => {
      toast({ title: "Follow-up updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-followups", orgId] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const interventionMut = useMutation({
    mutationFn: ({ id, status, coachNotes }: { id: string; status: string; coachNotes?: string }) =>
      apiRequest("PATCH", `/api/org/interventions/full/${id}`, { status, coachNotes }, buildHeaders()),
    onSuccess: () => {
      toast({ title: "Intervention updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/interventions/full", orgId] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const stats = statsData;
  const workflows = wfData?.workflows ?? [];

  // ── Auth Guards ──────────────────────────────────────────────────────────
  if (isHydrating) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-950">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
      </div>
    );
  }

  if (!orgToken && !hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 gap-4 px-4">
        <Zap className="h-10 w-10 text-neutral-500 opacity-40" />
        <div className="text-center">
          <p className="font-semibold text-sm text-neutral-300">Coach Access Required</p>
          <p className="text-xs text-neutral-500 mt-1">Sign in to manage workflows.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-neutral-950 text-white w-full overflow-hidden">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Zap className="h-6 w-6 text-emerald-400" />
                  Adaptive Workflows
                </h1>
                <p className="text-neutral-400 text-sm mt-1">
                  Automate coaching responses, interventions, and follow-ups.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm"
                  className="border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows", orgId] });
                    queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows/stats", orgId] });
                  }} data-testid="btn-refresh-workflows">
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
                <CreateWorkflowModal buildHeaders={buildHeaders} onCreated={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/org/adaptive-workflows", orgId] });
                }} />
              </div>
            </div>

            {/* Stats Row */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <StatCard label="Active Workflows" value={stats.activeWorkflows} icon={Zap} color="bg-emerald-900/40 text-emerald-400" />
                <StatCard label="Total Runs" value={stats.totalRuns} icon={Play} color="bg-blue-900/40 text-blue-400" />
                <StatCard label="Completed" value={stats.completedRuns} icon={CheckCircle2} color="bg-emerald-900/40 text-emerald-400" />
                <StatCard label="Failed" value={stats.failedRuns} icon={XCircle} color="bg-red-900/40 text-red-400" />
                <StatCard label="Success Rate" value={`${stats.resolutionRate}%`} icon={BarChart3} color="bg-purple-900/40 text-purple-400" />
                <StatCard label="Pending Follow-ups" value={stats.pendingFollowups} icon={Clock} color="bg-yellow-900/40 text-yellow-400" />
                <StatCard label="Open Interventions" value={stats.pendingInterventions} icon={AlertTriangle} color="bg-orange-900/40 text-orange-400" />
              </div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-neutral-900 border border-neutral-700">
                <TabsTrigger value="workflows" className="data-[state=active]:bg-neutral-800 text-neutral-300 data-[state=active]:text-white" data-testid="tab-workflows">
                  Workflows {workflows.length > 0 && <span className="ml-1.5 bg-neutral-700 text-neutral-300 text-xs px-1.5 rounded-full">{workflows.length}</span>}
                </TabsTrigger>
                <TabsTrigger value="interventions" className="data-[state=active]:bg-neutral-800 text-neutral-300 data-[state=active]:text-white" data-testid="tab-interventions">
                  Interventions {stats?.pendingInterventions ? <span className="ml-1.5 bg-orange-700/50 text-orange-300 text-xs px-1.5 rounded-full">{stats.pendingInterventions}</span> : null}
                </TabsTrigger>
                <TabsTrigger value="followups" className="data-[state=active]:bg-neutral-800 text-neutral-300 data-[state=active]:text-white" data-testid="tab-followups">
                  Follow-Ups {stats?.pendingFollowups ? <span className="ml-1.5 bg-yellow-700/50 text-yellow-300 text-xs px-1.5 rounded-full">{stats.pendingFollowups}</span> : null}
                </TabsTrigger>
                <TabsTrigger value="history" className="data-[state=active]:bg-neutral-800 text-neutral-300 data-[state=active]:text-white" data-testid="tab-history">
                  Run History
                </TabsTrigger>
              </TabsList>

              {/* ── Workflows Tab ── */}
              <TabsContent value="workflows" className="mt-4">
                {wfLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="text-center py-16 text-neutral-500">
                    <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium text-neutral-400">No workflows yet</p>
                    <p className="text-sm mt-1">Create a workflow or refresh to load templates.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Templates */}
                    {workflows.some((w) => w.isTemplate) && (
                      <div>
                        <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Built-In Templates</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {workflows.filter((w) => w.isTemplate).map((wf) => (
                            <WorkflowCard key={wf.id} wf={wf} orgId={orgId} athletes={athletes}
                              onToggle={(id, status) => toggleMut.mutate({ id, status })}
                              onTrigger={(id, athleteUserId) => triggerMut.mutate({ id, athleteUserId })} />
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Custom */}
                    {workflows.some((w) => !w.isTemplate) && (
                      <div>
                        <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Custom Workflows</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {workflows.filter((w) => !w.isTemplate).map((wf) => (
                            <WorkflowCard key={wf.id} wf={wf} orgId={orgId} athletes={athletes}
                              onToggle={(id, status) => toggleMut.mutate({ id, status })}
                              onTrigger={(id, athleteUserId) => triggerMut.mutate({ id, athleteUserId })} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Interventions Tab ── */}
              <TabsContent value="interventions" className="mt-4">
                {interventionsLoading ? (
                  <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-neutral-500" /></div>
                ) : !interventionsData?.interventions?.length ? (
                  <div className="text-center py-16 text-neutral-500">
                    <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium text-neutral-400">No interventions</p>
                    <p className="text-sm mt-1">Interventions appear when workflows trigger or coaches create them.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(interventionsData?.interventions ?? []).map((inv) => (
                      <Card key={inv.id} className="bg-neutral-900 border-neutral-700">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`text-xs border rounded px-1.5 py-0.5 ${SEVERITY_CONFIG[inv.severity]?.class ?? ""}`}>
                                  {SEVERITY_CONFIG[inv.severity]?.label ?? inv.severity}
                                </span>
                                <StatusBadge status={inv.status} />
                                <span className="text-xs text-neutral-500">{inv.generatedBy === "ai" ? "🤖 AI" : inv.generatedBy === "workflow" ? "⚡ Workflow" : "👤 Manual"}</span>
                              </div>
                              <h3 className="font-semibold text-white text-sm">{inv.title}</h3>
                              <p className="text-xs text-neutral-400 mt-0.5">{inv.summary}</p>
                              {inv.suggestedAction && (
                                <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                                  <ArrowRight className="h-3 w-3" /> {inv.suggestedAction}
                                </p>
                              )}
                              {inv.latestSnapshot && (
                                <div className="flex gap-3 mt-2 text-xs text-neutral-500">
                                  <span>Status Score: <span className="text-neutral-300">{inv.latestSnapshot.statusScore}</span></span>
                                  <span>Risk: <span className={inv.latestSnapshot.riskLevel === "red" ? "text-red-400" : inv.latestSnapshot.riskLevel === "yellow" ? "text-yellow-400" : "text-emerald-400"}>{inv.latestSnapshot.riskLevel}</span></span>
                                </div>
                              )}
                            </div>
                            {inv.status === "pending" && (
                              <div className="flex gap-2 shrink-0 flex-wrap">
                                <Button size="sm" className="h-7 bg-emerald-700 hover:bg-emerald-600 text-xs"
                                  onClick={() => interventionMut.mutate({ id: inv.id, status: "accepted" })}
                                  data-testid={`btn-accept-intervention-${inv.id}`}>Accept</Button>
                                <Button size="sm" variant="outline" className="h-7 border-neutral-700 bg-neutral-800 text-neutral-300 text-xs"
                                  onClick={() => interventionMut.mutate({ id: inv.id, status: "dismissed" })}
                                  data-testid={`btn-dismiss-intervention-${inv.id}`}>Dismiss</Button>
                                <Button size="sm" variant="outline" className="h-7 border-orange-700/50 bg-orange-900/20 text-orange-300 text-xs"
                                  onClick={() => interventionMut.mutate({ id: inv.id, status: "escalated" })}
                                  data-testid={`btn-escalate-intervention-${inv.id}`}>Escalate</Button>
                              </div>
                            )}
                            {inv.status === "accepted" && (
                              <Button size="sm" className="h-7 bg-neutral-700 hover:bg-neutral-600 text-xs shrink-0"
                                onClick={() => interventionMut.mutate({ id: inv.id, status: "completed" })}
                                data-testid={`btn-complete-intervention-${inv.id}`}>
                                Mark Complete
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── Follow-Ups Tab ── */}
              <TabsContent value="followups" className="mt-4">
                {followupsLoading ? (
                  <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-neutral-500" /></div>
                ) : !followupsData?.followups?.length ? (
                  <div className="text-center py-16 text-neutral-500">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium text-neutral-400">No pending follow-ups</p>
                    <p className="text-sm mt-1">Follow-ups are scheduled automatically when workflows run.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(followupsData?.followups ?? []).map((fu) => {
                      const dueDate = new Date(fu.followupDate);
                      const isOverdue = dueDate < new Date();
                      return (
                        <Card key={fu.id} className={`bg-neutral-900 border-neutral-700 ${isOverdue ? "border-l-4 border-l-red-600" : "border-l-4 border-l-yellow-600"}`}>
                          <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {isOverdue ? (
                                  <span className="text-xs text-red-400 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Overdue</span>
                                ) : (
                                  <span className="text-xs text-yellow-400 font-medium flex items-center gap-1"><Clock className="h-3 w-3" /> Due</span>
                                )}
                                <span className="text-xs text-neutral-500">{dueDate.toLocaleDateString()}</span>
                              </div>
                              {fu.notes && <p className="text-sm text-neutral-300">{fu.notes}</p>}
                              <p className="text-xs text-neutral-500 mt-0.5">Athlete: {fu.athleteUserId.slice(0, 8)}…</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button size="sm" className="h-7 bg-emerald-700 hover:bg-emerald-600 text-xs"
                                onClick={() => followupMut.mutate({ id: fu.id, status: "completed" })}
                                data-testid={`btn-complete-followup-${fu.id}`}>Complete</Button>
                              <Button size="sm" variant="outline" className="h-7 border-neutral-700 bg-neutral-800 text-neutral-300 text-xs"
                                onClick={() => followupMut.mutate({ id: fu.id, status: "skipped" })}
                                data-testid={`btn-skip-followup-${fu.id}`}>Skip</Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* ── Run History Tab ── */}
              <TabsContent value="history" className="mt-4">
                {runsLoading ? (
                  <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-neutral-500" /></div>
                ) : !runsData?.runs?.length ? (
                  <div className="text-center py-16 text-neutral-500">
                    <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium text-neutral-400">No runs yet</p>
                    <p className="text-sm mt-1">Trigger a workflow to see run history here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-neutral-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-800 bg-neutral-900">
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Workflow</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Athlete</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Trigger</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Status</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Started</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-neutral-400">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(runsData?.runs ?? []).map((run) => {
                          const wf = workflows.find((w) => w.id === run.workflowId);
                          const duration = run.completedAt && run.startedAt
                            ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                            : null;
                          return (
                            <tr key={run.id} className="border-b border-neutral-800 hover:bg-neutral-900/50 transition-colors" data-testid={`row-run-${run.id}`}>
                              <td className="px-4 py-2.5 text-neutral-300 text-xs">{wf?.title ?? run.workflowId.slice(0, 8)}</td>
                              <td className="px-4 py-2.5 text-neutral-500 text-xs font-mono">{run.athleteUserId.slice(0, 8)}…</td>
                              <td className="px-4 py-2.5 text-neutral-400 text-xs">{TRIGGER_LABELS[run.triggerEvent ?? ""] ?? run.triggerEvent ?? "—"}</td>
                              <td className="px-4 py-2.5"><StatusBadge status={run.status} /></td>
                              <td className="px-4 py-2.5 text-neutral-500 text-xs">{new Date(run.startedAt).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-neutral-500 text-xs">{duration !== null ? `${duration}s` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
        </div>
      </main>
    </div>
  );
}
