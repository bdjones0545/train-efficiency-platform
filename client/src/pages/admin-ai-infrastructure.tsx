import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  ArrowRight,
  RefreshCw,
  Server,
  Bot,
  Mail,
  Calendar,
  Activity,
  Shield,
  Workflow,
  Inbox,
  Users,
  TrendingUp,
  Target,
  Globe,
  Handshake,
  Star,
} from "lucide-react";
import { Link } from "wouter";

type MatrixStatus = "active" | "provisioned" | "blocked" | "idle";

interface MatrixComponent {
  id: string;
  name: string;
  category: string;
  provisioned: boolean;
  activated: boolean;
  producingOutput: boolean;
  visible: boolean;
  status: MatrixStatus;
  outputCount: number;
  notes: string;
  actionUrl: string;
  actionLabel: string;
  blockers: string[];
}

interface ActivationMatrix {
  infrastructure: MatrixComponent[];
  departments: MatrixComponent[];
  summary: {
    integrations: Record<string, string>;
    totalComponents: number;
    active: number;
    provisioned: number;
    blocked: number;
    idle: number;
    activationScore: number;
    journeySteps: Array<{
      step: number;
      label: string;
      completed: boolean;
      actionUrl: string | null;
    }>;
  };
}

const STATUS_CONFIG: Record<MatrixStatus, { label: string; color: string; icon: any; bg: string; border: string }> = {
  active:      { label: "Active",      color: "text-green-600 dark:text-green-400",  icon: CheckCircle2,    bg: "bg-green-50 dark:bg-green-900/20",  border: "border-green-200 dark:border-green-800" },
  provisioned: { label: "Provisioned", color: "text-yellow-600 dark:text-yellow-400", icon: Clock,           bg: "bg-yellow-50 dark:bg-yellow-900/20", border: "border-yellow-200 dark:border-yellow-800" },
  idle:        { label: "Idle",        color: "text-blue-600 dark:text-blue-400",    icon: Activity,        bg: "bg-blue-50 dark:bg-blue-900/20",    border: "border-blue-200 dark:border-blue-800" },
  blocked:     { label: "Blocked",     color: "text-red-600 dark:text-red-400",      icon: XCircle,         bg: "bg-red-50 dark:bg-red-900/20",      border: "border-red-200 dark:border-red-800" },
};

const DEPT_ICONS: Record<string, any> = {
  executive_agent:       Bot,
  hermes:                Zap,
  opportunity_acquisition: Target,
  revenue:               TrendingUp,
  scheduling:            Calendar,
  customer_success:      Users,
  outreach:              Mail,
  partnerships:          Handshake,
  sponsorships:          Star,
};

const INFRA_ICONS: Record<string, any> = {
  ceo_heartbeat:   Activity,
  agentmail:       Mail,
  approval_center: Shield,
  attention_inbox: Inbox,
  workflow_engine: Workflow,
  execution_engine: Zap,
  agent_registry:  Bot,
};

function StatusBadge({ status }: { status: MatrixStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function ComponentCard({ comp }: { comp: MatrixComponent }) {
  const cfg = STATUS_CONFIG[comp.status];
  const icons = { ...DEPT_ICONS, ...INFRA_ICONS };
  const Icon = icons[comp.id] ?? Server;

  return (
    <div className={`rounded-lg border p-4 ${cfg.border} ${cfg.bg} transition-all`} data-testid={`card-component-${comp.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 flex-shrink-0 ${cfg.color}`} />
          <span className="font-medium text-sm text-foreground truncate">{comp.name}</span>
        </div>
        <StatusBadge status={comp.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${comp.provisioned ? "bg-green-500" : "bg-muted-foreground"}`} />
          <span className="text-muted-foreground">Provisioned</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${comp.activated ? "bg-green-500" : "bg-muted-foreground"}`} />
          <span className="text-muted-foreground">Activated</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${comp.producingOutput ? "bg-green-500" : "bg-muted-foreground"}`} />
          <span className="text-muted-foreground">Producing</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{comp.notes}</p>

      {comp.blockers.length > 0 && (
        <div className="mb-3 space-y-1">
          {comp.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              {b}
            </div>
          ))}
        </div>
      )}

      <Link href={comp.actionUrl}>
        <Button variant="outline" size="sm" className="w-full text-xs h-7" data-testid={`button-action-${comp.id}`}>
          {comp.actionLabel}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </Link>
    </div>
  );
}

function JourneyStep({ step, label, completed, actionUrl }: { step: number; label: string; completed: boolean; actionUrl: string | null }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${completed ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" : "border-border bg-muted/30"}`} data-testid={`step-journey-${step}`}>
      <div className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${completed ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
        {completed ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>
      <span className={`flex-1 text-sm ${completed ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
      {!completed && actionUrl && (
        <Link href={actionUrl}>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid={`button-step-${step}`}>
            Fix <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}

export default function AdminAiInfrastructurePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ success: boolean; matrix: ActivationMatrix; generatedAt: string }>({
    queryKey: ["/api/admin/ai-infrastructure/activation-matrix"],
    refetchInterval: 60000,
  });

  const provision = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/ai-infrastructure/provision"),
    onSuccess: () => {
      toast({ title: "Provisioning complete", description: "AI infrastructure has been re-provisioned for your org." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-infrastructure/activation-matrix"] });
    },
    onError: () => toast({ title: "Provisioning failed", description: "Check server logs for details.", variant: "destructive" }),
  });

  const matrix = data?.matrix;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="page-loading">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error || !matrix) {
    return (
      <div className="p-6" data-testid="page-error">
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-6 text-center">
          <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Failed to load activation matrix</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-infrastructure/activation-matrix"] })}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { summary } = matrix;
  const scoreColor = summary.activationScore >= 70 ? "text-green-600 dark:text-green-400" : summary.activationScore >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
  const completedSteps = summary.journeySteps.filter(s => s.completed).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-ai-infrastructure">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            AI Workforce Activation Audit
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Per-component provisioning, activation, and output status for your organization.
            {data?.generatedAt && <span className="ml-2 opacity-60">Updated {new Date(data.generatedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-infrastructure/activation-matrix"] })} data-testid="button-refresh-matrix">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => provision.mutate()} disabled={provision.isPending} data-testid="button-provision">
            {provision.isPending ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
            Re-Provision
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="summary-kpis">
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="pt-4 pb-3">
            <div className="text-center">
              <div className={`text-3xl font-bold ${scoreColor}`} data-testid="text-activation-score">{summary.activationScore}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Activation Score</div>
              <Progress value={summary.activationScore} className="h-1.5 mt-2" />
            </div>
          </CardContent>
        </Card>
        {[
          { label: "Active", count: summary.active, color: "text-green-600 dark:text-green-400", testId: "text-count-active" },
          { label: "Provisioned", count: summary.provisioned, color: "text-yellow-600 dark:text-yellow-400", testId: "text-count-provisioned" },
          { label: "Idle", count: summary.idle, color: "text-blue-600 dark:text-blue-400", testId: "text-count-idle" },
          { label: "Blocked", count: summary.blocked, color: "text-red-600 dark:text-red-400", testId: "text-count-blocked" },
        ].map(({ label, count, color, testId }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 text-center">
              <div className={`text-2xl font-bold ${color}`} data-testid={testId}>{count}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Integration Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="integration-status-panel">
            {[
              { key: "gmail", label: "Gmail", icon: Mail, actionUrl: "/admin/integrations" },
              { key: "google_calendar", label: "Google Calendar", icon: Calendar, actionUrl: "/admin/integrations" },
              { key: "agentmail", label: "AgentMail", icon: Inbox, actionUrl: "/admin/agentmail" },
            ].map(({ key, label, icon: Icon, actionUrl }) => {
              const status = summary.integrations[key] ?? "connect_required";
              const connected = status === "connected";
              return (
                <div key={key} className={`flex items-center justify-between p-3 rounded-lg border ${connected ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" : "border-border bg-muted/30"}`} data-testid={`status-integration-${key}`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${connected ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`} />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  {connected ? (
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                    </span>
                  ) : (
                    <Link href={actionUrl}>
                      <Button variant="outline" size="sm" className="h-6 text-xs px-2" data-testid={`button-connect-${key}`}>
                        Connect
                      </Button>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Infrastructure Matrix */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2" data-testid="section-infrastructure">
          <Server className="h-5 w-5 text-muted-foreground" />
          Infrastructure ({matrix.infrastructure.length} components)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {matrix.infrastructure.map(comp => (
            <ComponentCard key={comp.id} comp={comp} />
          ))}
        </div>
      </div>

      <Separator />

      {/* Department Matrix */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2" data-testid="section-departments">
          <Bot className="h-5 w-5 text-muted-foreground" />
          Departments ({matrix.departments.length} agents)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {matrix.departments.map(comp => (
            <ComponentCard key={comp.id} comp={comp} />
          ))}
        </div>
      </div>

      <Separator />

      {/* End-to-End Journey */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            End-to-End Activation Journey
            <Badge variant="outline" className="ml-auto text-xs font-normal" data-testid="badge-journey-progress">
              {completedSteps} / {summary.journeySteps.length} complete
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" data-testid="journey-steps">
            {summary.journeySteps.map(step => (
              <JourneyStep key={step.step} {...step} />
            ))}
          </div>
          {completedSteps === summary.journeySteps.length && (
            <div className="mt-4 p-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-center">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 mx-auto mb-1" />
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">All steps complete — your AI workforce is fully operational</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gap Analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Gap Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" data-testid="gap-analysis">
            {[...matrix.infrastructure, ...matrix.departments]
              .filter(c => c.blockers.length > 0 || c.status !== "active")
              .sort((a, b) => {
                const priority: Record<MatrixStatus, number> = { blocked: 0, provisioned: 1, idle: 2, active: 3 };
                return priority[a.status] - priority[b.status];
              })
              .map(comp => (
                <div key={comp.id} className={`flex items-start gap-3 p-3 rounded-lg border ${STATUS_CONFIG[comp.status].border} ${STATUS_CONFIG[comp.status].bg}`} data-testid={`gap-item-${comp.id}`}>
                  <StatusBadge status={comp.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{comp.name}</p>
                    {comp.blockers.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {comp.blockers.map((b, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                            <span className="text-red-500 mt-0.5">•</span> {b}
                          </li>
                        ))}
                      </ul>
                    )}
                    {comp.blockers.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{comp.notes}</p>
                    )}
                  </div>
                  <Link href={comp.actionUrl}>
                    <Button variant="outline" size="sm" className="text-xs h-7 flex-shrink-0" data-testid={`button-fix-${comp.id}`}>
                      {comp.actionLabel} <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              ))}
            {[...matrix.infrastructure, ...matrix.departments].every(c => c.status === "active") && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto mb-2" />
                No gaps found — all components are active.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
