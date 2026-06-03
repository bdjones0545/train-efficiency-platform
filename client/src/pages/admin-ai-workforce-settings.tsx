import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Settings, ArrowLeft, Shield, Users, Plug, GitBranch,
  CheckCircle, Clock, Zap, Brain, ChevronRight, Edit2,
  AlertCircle, History, RefreshCw, RotateCcw, Calendar,
  Target, MessageSquare, Search, BarChart2, TrendingUp,
  Cpu, Building2, Mail, Hash, Globe, Star, Save, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow, format } from "date-fns";

// ─── Static reference data (mirrors onboarding wizard) ────────────────────────

const DEPARTMENTS = [
  { id: "communications", label: "Communications", icon: MessageSquare, desc: "Email outreach, reply classification, follow-up sequences", agents: ["Relay"] },
  { id: "scheduling", label: "Scheduling", icon: Calendar, desc: "Session booking, reminders, calendar automation", agents: ["Tempo"] },
  { id: "retention", label: "Retention", icon: TrendingUp, desc: "Client engagement, churn recovery, win-back campaigns", agents: ["Pulse"] },
  { id: "growth", label: "Growth / Outreach", icon: Target, desc: "Lead research, qualification, prospecting campaigns", agents: ["Apex"] },
  { id: "research", label: "Research", icon: Search, desc: "Decision-maker discovery, web intelligence", agents: ["Vector"] },
  { id: "executive", label: "Executive Intelligence", icon: BarChart2, desc: "Business summaries, KPI tracking, strategic insights", agents: ["Atlas"] },
];

const AGENTS_META: Record<string, { name: string; role: string; dept: string; color: string; initials: string }> = {
  relay_agent:   { name: "Relay",  role: "Communication Specialist",    dept: "communications", color: "bg-blue-500",    initials: "RL" },
  pulse_agent:   { name: "Pulse",  role: "Retention Specialist",         dept: "retention",      color: "bg-emerald-500", initials: "PS" },
  tempo_agent:   { name: "Tempo",  role: "Scheduling Coordinator",       dept: "scheduling",     color: "bg-violet-500",  initials: "TM" },
  apex_agent:    { name: "Apex",   role: "Growth & Outreach Agent",      dept: "growth",         color: "bg-amber-500",   initials: "AX" },
  vector_agent:  { name: "Vector", role: "Research Intelligence Agent",  dept: "research",       color: "bg-pink-500",    initials: "VC" },
  atlas_agent:   { name: "Atlas",  role: "Business Intelligence Agent",  dept: "executive",      color: "bg-slate-600",   initials: "AT" },
};

const GOVERNANCE_LABELS: Record<string, { label: string; badge: string; desc: string }> = {
  supervised:    { label: "Conservative", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",  desc: "All external actions require approval" },
  collaborative: { label: "Balanced",     badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",      desc: "Low-risk runs automatically; high-risk needs approval" },
  autonomous:    { label: "Advanced",     badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", desc: "Agents operate autonomously within configured limits" },
};

const AUTONOMY_LABELS: Record<string, string> = {
  supervised: "Supervised",
  collaborative: "Collaborative",
  autonomous: "Autonomous",
  review: "Review Required",
  blocked: "Blocked",
};

const INTEGRATION_META: Record<string, { label: string; icon: typeof Mail }> = {
  gmail:           { label: "Gmail",                    icon: Mail },
  google_calendar: { label: "Google Calendar",          icon: Calendar },
  slack:           { label: "Slack",                    icon: Hash },
  openrouter:      { label: "AI Models (OpenRouter)",   icon: Brain },
};

const WORKFLOW_TEMPLATE_LABELS: Record<string, string> = {
  "tpl-onboarding":         "Client Onboarding",
  "tpl-retention":          "Retention Campaign",
  "tpl-lead-qualification": "Lead Qualification",
  "tpl-churn-recovery":     "Churn Recovery",
  "tpl-executive-summary":  "Daily Executive Summary",
};

const GOAL_LABELS: Record<string, string> = {
  leads: "Get more leads",
  retention: "Improve retention",
  scheduling: "Automate scheduling",
  admin: "Reduce admin work",
  communication: "Improve communication",
  onboarding: "Streamline athlete onboarding",
  research: "Research opportunities",
  reporting: "Executive reporting",
};

// ─── Helper components ────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Shield;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function AgentCard({ agent }: { agent: any }) {
  const meta = AGENTS_META[agent.agentType] ?? {
    name: agent.name ?? agent.agentType,
    role: agent.role ?? "AI Agent",
    dept: agent.department ?? "—",
    color: "bg-slate-500",
    initials: (agent.name ?? "?").slice(0, 2).toUpperCase(),
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        agent.enabled
          ? "border-border bg-card"
          : "border-border/50 bg-muted/30 opacity-60"
      }`}
      data-testid={`agent-card-${agent.agentType}`}
    >
      <div className={`h-9 w-9 rounded-lg ${meta.color} flex items-center justify-center shrink-0 text-white text-xs font-bold`}>
        {meta.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{meta.name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{meta.role}</Badge>
          {agent.enabled ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Active</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{DEPARTMENTS.find(d => d.id === meta.dept)?.label ?? meta.dept}</p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Shield className="h-3 w-3" />
            {AUTONOMY_LABELS[agent.autonomyMode] ?? agent.autonomyMode ?? "Default"}
          </span>
          {agent.requiresApproval && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Approval required
            </span>
          )}
          {agent.recentActions > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {agent.recentActions} recent actions
            </span>
          )}
          {agent.disabledReason && (
            <span className="text-[10px] text-muted-foreground italic">{agent.disabledReason}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline edit: Departments ─────────────────────────────────────────────────

function DepartmentsEdit({
  current,
  onSave,
  onCancel,
  isSaving,
}: {
  current: string[];
  onSave: (depts: string[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(current);
  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {DEPARTMENTS.map(dept => {
          const active = selected.includes(dept.id);
          return (
            <button
              key={dept.id}
              onClick={() => toggle(dept.id)}
              data-testid={`dept-edit-${dept.id}`}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <dept.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{dept.label}</span>
                  <span className="text-[10px] text-muted-foreground">{dept.agents.join(", ")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-1" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(selected)} disabled={isSaving} data-testid="button-save-departments">
          {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Departments</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
          <X className="h-3.5 w-3.5 mr-1 " />Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Inline edit: Integrations ────────────────────────────────────────────────

function IntegrationsEdit({
  current,
  onSave,
  onCancel,
  isSaving,
}: {
  current: string[];
  onSave: (integrations: string[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(current);
  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(INTEGRATION_META).map(([id, meta]) => {
          const active = selected.includes(id);
          const Icon = meta.icon;
          return (
            <button
              key={id}
              onClick={() => toggle(id)}
              data-testid={`integration-edit-${id}`}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium flex-1">{meta.label}</span>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(selected)} disabled={isSaving} data-testid="button-save-integrations">
          {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Integrations</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
          <X className="h-3.5 w-3.5 mr-1" />Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminAiWorkforceSettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editingDepts, setEditingDepts] = useState(false);
  const [editingIntegrations, setEditingIntegrations] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<any | null>({
    queryKey: ["/api/workforce/settings"],
    staleTime: 30_000,
  });

  const { data: agents, isLoading: agentsLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/agents"],
    staleTime: 60_000,
  });

  const { data: workflows, isLoading: workflowsLoading } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    staleTime: 60_000,
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/audit-log"],
    staleTime: 60_000,
  });

  const { data: govSettings } = useQuery<any>({
    queryKey: ["/api/governance/settings"],
    staleTime: 60_000,
  });

  // Redirect to onboarding if no config exists
  useEffect(() => {
    if (!settingsLoading && settings === null) {
      navigate("/onboarding/ai-workforce", { replace: true });
    }
  }, [settings, settingsLoading, navigate]);

  const saveMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await apiRequest("PUT", "/api/workforce/settings", updates);
      return res.json();
    },
    onSuccess: (data: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      const changed = data.changes?.length ?? 0;
      toast({
        title: changed > 0 ? "Workforce updated." : "No changes detected.",
        description: changed > 0 ? `${data.changes?.join(", ")} updated successfully.` : undefined,
      });
      setEditingDepts(false);
      setEditingIntegrations(false);
    },
    onError: () => toast({ title: "Failed to save changes", variant: "destructive" }),
  });

  if (settingsLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    );
  }

  if (!settings) return null; // redirect in progress

  const enabledDepartments: string[] = Array.isArray(settings.enabledDepartments) ? settings.enabledDepartments : [];
  const selectedIntegrations: string[] = Array.isArray(settings.selectedIntegrations) ? settings.selectedIntegrations : [];
  const selectedTemplates: string[] = Array.isArray(settings.selectedWorkflowTemplates) ? settings.selectedWorkflowTemplates : [];
  const goals: string[] = Array.isArray(settings.goals) ? settings.goals : [];
  const govInfo = GOVERNANCE_LABELS[settings.governanceMode] ?? GOVERNANCE_LABELS.collaborative;
  const activeAgents = agents?.filter(a => a.enabled) ?? [];
  const wizardWorkflows = workflows?.filter(w => w.tags?.includes("source:ai_workforce_wizard")) ?? [];
  const lastUpdated = settings.updatedAt ? new Date(settings.updatedAt) : null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto" data-testid="page-workforce-settings">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/ai-workforce">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />AI Workforce
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            AI Workforce Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and update your AI workforce configuration, agents, and automation rules.
            {lastUpdated && (
              <span className="ml-1.5 text-xs">
                Last updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}.
              </span>
            )}
          </p>
        </div>
        <Link href="/onboarding/ai-workforce">
          <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" data-testid="button-rerun-wizard">
            <RotateCcw className="h-3.5 w-3.5" />
            Rerun Setup Wizard
          </Button>
        </Link>
      </div>

      {/* ── Workforce Overview ────────────────────────────────────────────── */}
      <Card data-testid="section-overview">
        <CardHeader className="pb-3">
          <SectionHeader icon={Star} title="Workforce Overview" subtitle="Current configuration snapshot" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Governance */}
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Governance</span>
              <Badge className={`w-fit text-xs font-semibold px-2 py-0.5 ${govInfo.badge}`}>
                {govInfo.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground leading-tight">{govInfo.desc}</span>
            </div>
            {/* Departments */}
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Departments</span>
              <span className="text-2xl font-bold">{enabledDepartments.length}</span>
              <span className="text-[10px] text-muted-foreground">of {DEPARTMENTS.length} active</span>
            </div>
            {/* Agents */}
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Agents</span>
              {agentsLoading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <>
                  <span className="text-2xl font-bold">{activeAgents.length}</span>
                  <span className="text-[10px] text-muted-foreground">of {agents?.length ?? 0} enabled</span>
                </>
              )}
            </div>
            {/* Workflows */}
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/40 border">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Workflows</span>
              {workflowsLoading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <>
                  <span className="text-2xl font-bold">{wizardWorkflows.length}</span>
                  <span className="text-[10px] text-muted-foreground">from setup</span>
                </>
              )}
            </div>
          </div>

          {/* Goals */}
          {goals.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Business Goals</p>
              <div className="flex flex-wrap gap-1.5">
                {goals.map(g => (
                  <Badge key={g} variant="secondary" className="text-xs">
                    {GOAL_LABELS[g] ?? g}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {settings.orgPreset && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              <span>Org type: <span className="font-medium text-foreground capitalize">{settings.orgPreset.replace(/_/g, " ")}</span></span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Agents ───────────────────────────────────────────────────────── */}
      <Card data-testid="section-agents">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Brain}
            title="Active Agents"
            subtitle="Agents enabled for your organization"
            action={
              <Link href="/admin/ai-workforce/capabilities">
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-agents">
                  <Edit2 className="h-3.5 w-3.5" />Edit Agents
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {agentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : !agents?.length ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              <Brain className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No agents configured yet.
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map(agent => <AgentCard key={agent.agentType} agent={agent} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Departments ──────────────────────────────────────────────────── */}
      <Card data-testid="section-departments">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Users}
            title="Departments"
            subtitle="AI departments included in your workforce"
            action={
              !editingDepts ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => setEditingDepts(true)}
                  data-testid="button-edit-departments"
                >
                  <Edit2 className="h-3.5 w-3.5" />Edit Departments
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardContent>
          {editingDepts ? (
            <DepartmentsEdit
              current={enabledDepartments}
              onSave={depts => saveMutation.mutate({ enabledDepartments: depts })}
              onCancel={() => setEditingDepts(false)}
              isSaving={saveMutation.isPending}
            />
          ) : (
            <div className="space-y-2">
              {DEPARTMENTS.map(dept => {
                const active = enabledDepartments.includes(dept.id);
                return (
                  <div
                    key={dept.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      active ? "border-border bg-card" : "border-border/40 bg-muted/20 opacity-50"
                    }`}
                    data-testid={`dept-row-${dept.id}`}
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary/10" : "bg-muted"}`}>
                      <dept.icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{dept.label}</span>
                        {active ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">Agents: {dept.agents.join(", ")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Governance ───────────────────────────────────────────────────── */}
      <Card data-testid="section-governance">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Shield}
            title="Governance"
            subtitle="Approval rules and autonomy settings"
            action={
              <Link href="/admin/ai-governance">
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-governance">
                  <Edit2 className="h-3.5 w-3.5" />Edit Governance
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            }
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`flex items-start gap-3 p-3 rounded-lg border-2 ${
            settings.governanceMode === "supervised" ? "border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800" :
            settings.governanceMode === "autonomous" ? "border-violet-300 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800" :
            "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800"
          }`}>
            <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{govInfo.label} Mode</span>
                <Badge className={`text-xs ${govInfo.badge}`}>{settings.governanceMode}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{govInfo.desc}</p>
            </div>
          </div>

          {govSettings && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { label: "Autonomous comms", value: govSettings.allowAutonomousCommunication },
                { label: "Autonomous scheduling", value: govSettings.allowAutonomousScheduling },
                { label: "Financial actions", value: govSettings.allowAutonomousFinancialActions },
                { label: "Web research", value: govSettings.allowExternalWebAccess },
                { label: "Cross-workflow memory", value: govSettings.allowCrossWorkflowMemory },
                { label: "Operator review", value: govSettings.operatorReviewRequired },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border text-xs">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${item.value ? "bg-emerald-500" : "bg-rose-400"}`} />
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {govSettings?.emergencyPauseEnabled && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
              <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Emergency Pause Active</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Integrations ─────────────────────────────────────────────────── */}
      <Card data-testid="section-integrations">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={Plug}
            title="Integrations"
            subtitle="Tools connected to your AI workforce"
            action={
              !editingIntegrations ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => setEditingIntegrations(true)}
                  data-testid="button-edit-integrations"
                >
                  <Edit2 className="h-3.5 w-3.5" />Edit Integrations
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardContent>
          {editingIntegrations ? (
            <IntegrationsEdit
              current={selectedIntegrations}
              onSave={integrations => saveMutation.mutate({ selectedIntegrations: integrations })}
              onCancel={() => setEditingIntegrations(false)}
              isSaving={saveMutation.isPending}
            />
          ) : selectedIntegrations.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              <Plug className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No integrations selected.
              <button onClick={() => setEditingIntegrations(true)} className="text-primary hover:underline ml-1">Add one →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedIntegrations.map(id => {
                const meta = INTEGRATION_META[id];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <div key={id} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`integration-row-${id}`}>
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{meta.label}</span>
                    </div>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] px-1.5 py-0 h-4">
                      Pending setup
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
          {selectedIntegrations.length > 0 && !editingIntegrations && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Connect integrations in{" "}
              <Link href="/admin/integrations" className="text-primary hover:underline">Integration settings</Link>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Workflows & Automations ───────────────────────────────────────── */}
      <Card data-testid="section-workflows">
        <CardHeader className="pb-3">
          <SectionHeader
            icon={GitBranch}
            title="Workflows & Automations"
            subtitle="Starter workflows created from your setup"
            action={
              <Link href="/admin/workflow-builder">
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" data-testid="button-edit-automations">
                  <Edit2 className="h-3.5 w-3.5" />Edit Automations
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Selected templates */}
          {selectedTemplates.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Selected Templates</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedTemplates.map(id => (
                  <Badge key={id} variant="secondary" className="text-xs">
                    <GitBranch className="h-3 w-3 mr-1" />
                    {WORKFLOW_TEMPLATE_LABELS[id] ?? id}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Created workflow graphs */}
          {workflowsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : wizardWorkflows.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              <GitBranch className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No starter workflows created yet.
            </div>
          ) : (
            <div className="space-y-2">
              {wizardWorkflows.map(wf => (
                <div key={wf.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid={`workflow-row-${wf.id}`}>
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <GitBranch className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{wf.name}</p>
                    {wf.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{wf.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {wf.published ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] px-1.5 py-0 h-4">Live</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Draft</Badge>
                    )}
                    <Link href={`/admin/workflows/${wf.id}/live`}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Change History ────────────────────────────────────────────────── */}
      <div data-testid="section-audit-trail">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Change History</h2>
          <Badge variant="secondary" className="text-[10px]">{auditLog?.length ?? 0}</Badge>
        </div>

        {auditLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : !auditLog?.length ? (
          <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-lg" data-testid="text-no-audit">
            <History className="h-6 w-6 mx-auto mb-2 opacity-40" />
            No configuration changes recorded yet.
          </div>
        ) : (
          <Card>
            <CardContent className="pt-4 divide-y space-y-0">
              {auditLog.slice(0, 10).map(entry => (
                <div key={entry.id} className="flex gap-3 py-2.5" data-testid={`audit-entry-${entry.id}`}>
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <History className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium capitalize">{(entry.eventType ?? "").replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) : ""}
                      </span>
                      {entry.changedBy && (
                        <span className="text-[10px] text-muted-foreground">by {entry.changedBy}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <Separator />
      <div className="flex items-center justify-between gap-4 py-2">
        <div>
          <p className="text-sm font-semibold">Rerun Setup Wizard</p>
          <p className="text-xs text-muted-foreground">Go through the full setup flow again. Your existing configuration will be updated, not replaced.</p>
        </div>
        <Link href="/onboarding/ai-workforce">
          <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20" data-testid="button-rerun-wizard-danger">
            <RotateCcw className="h-3.5 w-3.5" />
            Rerun Wizard
          </Button>
        </Link>
      </div>
    </div>
  );
}
