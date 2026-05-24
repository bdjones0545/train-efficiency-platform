import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Users, Plug, Activity, ShieldCheck, TrendingUp, CheckCircle,
  XCircle, AlertTriangle, Clock, RefreshCw, Link2, Link2Off,
  Cpu, Globe, Mail, Calendar, Hash, Search, Zap, BarChart3,
  CircleDot, Brain, Play, Pause, GitBranch, ArrowRight, Eye,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentEntry = {
  agentType: string;
  name: string;
  role: string;
  department: string;
  description: string;
  avatarInitials: string;
  avatarColor: string;
  toolCategories: string[];
  status: string;
  autonomyMode: string;
  requiresApproval: boolean;
  enabled: boolean;
  recentActions: number;
  successRate: number | null;
  blockedActions: number;
};

type IntegrationEntry = {
  id: string;
  integrationType: string;
  status: string;
  displayName: string | null;
  authType: string;
  lastSuccessfulActionAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  rateLimitState: Record<string, any> | null;
  usageStats: Record<string, any> | null;
  governanceRestrictions: Record<string, any> | null;
  enabledAgents: string[] | null;
};

type IntegrationStats = {
  total: number;
  connected: number;
  degraded: number;
  error: number;
  paused: number;
  recentActions: number;
  successRate: number;
  failCount: number;
  blockedCount: number;
};

type RelationshipEntry = {
  agent: string;
  agentName: string;
  department: string;
  connectedIntegrations: Array<{
    type: string;
    status: string;
    displayName: string;
  }>;
};

type ExecLog = {
  id: string;
  integrationType: string;
  actionType: string;
  agentType: string | null;
  status: string;
  inputSummary: string | null;
  errorMessage: string | null;
  errorClass: string | null;
  latencyMs: number | null;
  governanceDecision: string | null;
  createdAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const AVATAR_COLORS: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const INTEGRATION_ICONS: Record<string, typeof Mail> = {
  gmail: Mail,
  google_calendar: Calendar,
  slack: Hash,
  openrouter: Cpu,
  research_agent: Search,
  meta_ads: Globe,
  hubspot: BarChart3,
  stripe: Zap,
  twilio: Activity,
  discord: Hash,
  custom_webhook: Link2,
};

const INTEGRATION_LABELS: Record<string, string> = {
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  slack: "Slack",
  openrouter: "OpenRouter / Multi-Model",
  research_agent: "Research Agent (OpenClaw)",
  meta_ads: "Meta Ads",
  hubspot: "HubSpot",
  stripe: "Stripe",
  twilio: "Twilio SMS",
  discord: "Discord",
  custom_webhook: "Custom Webhook",
};

const AUTONOMY_COLORS: Record<string, string> = {
  autonomous: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  collaborative: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  supervised: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  manual: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "text-green-600 dark:text-green-400",
  disconnected: "text-gray-400",
  degraded: "text-amber-600 dark:text-amber-400",
  paused: "text-blue-500",
  error: "text-red-600 dark:text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  connected: "bg-green-500",
  disconnected: "bg-gray-300",
  degraded: "bg-amber-400",
  paused: "bg-blue-400",
  error: "bg-red-500",
};

// ─── Known integrations to always show (even if not yet configured) ───────────
const ALL_INTEGRATION_TYPES = [
  "gmail", "google_calendar", "slack", "openrouter", "research_agent",
  "meta_ads", "hubspot", "stripe", "twilio",
];

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentEntry }) {
  const avatarCls = AVATAR_COLORS[agent.avatarColor] ?? AVATAR_COLORS.slate;
  const autonomyCls = AUTONOMY_COLORS[agent.autonomyMode] ?? AUTONOMY_COLORS.supervised;

  return (
    <Card
      className={`p-4 transition-all hover:shadow-md ${!agent.enabled ? "opacity-60" : ""}`}
      data-testid={`card-agent-${agent.agentType}`}
    >
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarCls}`}>
          {agent.avatarInitials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{agent.name}</span>
            <span className="text-xs text-muted-foreground">— {agent.role}</span>
            {!agent.enabled && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800">
                disabled
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{agent.department}</p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.description}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${autonomyCls}`}>
              {agent.autonomyMode}
            </span>
            {agent.requiresApproval && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                approval required
              </span>
            )}
          </div>

          {agent.recentActions > 0 && (
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                {agent.recentActions} actions
              </span>
              {agent.successRate !== null && (
                <span className={`flex items-center gap-1 ${agent.successRate >= 80 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                  <CheckCircle className="h-3 w-3" />
                  {agent.successRate}% success
                </span>
              )}
              {agent.blockedActions > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <ShieldCheck className="h-3 w-3" />
                  {agent.blockedActions} blocked
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1 mt-2">
            {agent.toolCategories.map(cat => (
              <span key={cat} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                {cat}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────

function IntegrationCard({
  type,
  integration,
  onPause,
  onResume,
  onHealthCheck,
  isActing,
}: {
  type: string;
  integration: IntegrationEntry | undefined;
  onPause: (type: string) => void;
  onResume: (type: string) => void;
  onHealthCheck: (type: string) => void;
  isActing: boolean;
}) {
  const status = integration?.status ?? "disconnected";
  const Icon = INTEGRATION_ICONS[type] ?? Plug;
  const label = INTEGRATION_LABELS[type] ?? type;
  const dotCls = STATUS_DOT[status] ?? STATUS_DOT.disconnected;
  const textCls = STATUS_COLORS[status] ?? STATUS_COLORS.disconnected;

  return (
    <Card className="p-4" data-testid={`card-integration-${type}`}>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <span className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
            <span className={`text-xs font-medium ${textCls}`}>{status}</span>
          </div>
          {integration?.displayName && (
            <p className="text-xs text-muted-foreground mt-0.5">{integration.displayName}</p>
          )}
          {integration?.lastSuccessfulActionAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last action: {formatDistanceToNow(new Date(integration.lastSuccessfulActionAt), { addSuffix: true })}
            </p>
          )}
          {integration?.lastFailureReason && status !== "connected" && (
            <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{integration.lastFailureReason}</p>
          )}
          {integration?.enabledAgents && (integration.enabledAgents as string[]).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {(integration.enabledAgents as string[]).slice(0, 3).map(a => (
                <span key={a} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                  {a.replace("_agent", "")}
                </span>
              ))}
            </div>
          )}

          {integration && (
            <div className="flex items-center gap-1.5 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => onHealthCheck(type)}
                disabled={isActing}
                data-testid={`button-health-check-${type}`}
              >
                <Activity className="h-3 w-3 mr-1" />
                Check
              </Button>
              {status === "paused" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-2 text-green-600"
                  onClick={() => onResume(type)}
                  disabled={isActing}
                  data-testid={`button-resume-${type}`}
                >
                  <Play className="h-3 w-3 mr-1" />
                  Resume
                </Button>
              ) : status === "connected" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-2 text-amber-600"
                  onClick={() => onPause(type)}
                  disabled={isActing}
                  data-testid={`button-pause-${type}`}
                >
                  <Pause className="h-3 w-3 mr-1" />
                  Pause
                </Button>
              ) : null}
            </div>
          )}

          {!integration && (
            <p className="text-xs text-muted-foreground mt-1.5 italic">Not configured</p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Execution Log Row ────────────────────────────────────────────────────────

function LogRow({ log }: { log: ExecLog }) {
  const statusColor = {
    success: "text-green-500",
    failed: "text-red-500",
    blocked: "text-orange-500",
    rate_limited: "text-amber-500",
    pending: "text-blue-500",
  }[log.status] ?? "text-muted-foreground";

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0" data-testid={`row-exec-log-${log.id}`}>
      <div className="mt-0.5 shrink-0">
        {log.status === "success" ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          : log.status === "blocked" ? <ShieldCheck className="h-3.5 w-3.5 text-orange-500" />
          : log.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-500" />
          : <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-medium">{INTEGRATION_LABELS[log.integrationType] ?? log.integrationType}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{log.actionType.replace(/_/g, " ")}</span>
          {log.agentType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{log.agentType.replace("_agent", "")}</span>
          )}
        </div>
        {log.inputSummary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{log.inputSummary}</p>}
        {log.errorMessage && <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{log.errorMessage}</p>}
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <span className={`text-xs font-medium ${statusColor}`}>{log.status}</span>
        {log.latencyMs && <p className="text-[10px] text-muted-foreground">{log.latencyMs}ms</p>}
        <p className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

// ─── Relationship Map ─────────────────────────────────────────────────────────

function RelationshipMap({ data }: { data: RelationshipEntry[] }) {
  return (
    <div className="space-y-3" data-testid="section-relationship-map">
      {data.map(entry => (
        <div key={entry.agent} className="border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold">{entry.agentName}</span>
            <span className="text-xs text-muted-foreground">— {entry.department}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {entry.connectedIntegrations.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">No integrations assigned</span>
            ) : (
              entry.connectedIntegrations.map(int => {
                const Icon = INTEGRATION_ICONS[int.type] ?? Plug;
                const dotCls = STATUS_DOT[int.status] ?? STATUS_DOT.disconnected;
                return (
                  <div
                    key={int.type}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs bg-muted/40"
                  >
                    <Icon className="h-3 w-3 text-muted-foreground" />
                    <span>{INTEGRATION_LABELS[int.type] ?? int.type}</span>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAiWorkforcePage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("agents");
  const [actingOn, setActingOn] = useState<string | null>(null);

  const { data: agents, isLoading: agentsLoading, refetch: refetchAgents } = useQuery<AgentEntry[]>({
    queryKey: ["/api/workforce/agents"],
    refetchInterval: 60000,
  });

  const { data: integrations, isLoading: integrationsLoading, refetch: refetchIntegrations } = useQuery<IntegrationEntry[]>({
    queryKey: ["/api/integrations"],
    refetchInterval: 30000,
  });

  const { data: integrationStats } = useQuery<IntegrationStats>({
    queryKey: ["/api/integrations/stats"],
    refetchInterval: 30000,
  });

  const { data: relationshipMap, isLoading: mapLoading } = useQuery<RelationshipEntry[]>({
    queryKey: ["/api/workforce/relationship-map"],
  });

  const { data: execLogs, isLoading: logsLoading } = useQuery<ExecLog[]>({
    queryKey: ["/api/integrations/logs/all"],
    refetchInterval: 30000,
  });

  const pauseMutation = useMutation({
    mutationFn: async (type: string) => {
      const res = await apiRequest("POST", `/api/integrations/${type}/pause`, { reason: "Manually paused by admin" });
      return res.json();
    },
    onSuccess: (_, type) => {
      toast({ title: `${INTEGRATION_LABELS[type] ?? type} paused` });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/stats"] });
      setActingOn(null);
    },
    onError: () => { toast({ title: "Failed to pause", variant: "destructive" }); setActingOn(null); },
  });

  const resumeMutation = useMutation({
    mutationFn: async (type: string) => {
      const res = await apiRequest("POST", `/api/integrations/${type}/resume`);
      return res.json();
    },
    onSuccess: (_, type) => {
      toast({ title: `${INTEGRATION_LABELS[type] ?? type} resumed` });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setActingOn(null);
    },
    onError: () => { toast({ title: "Failed to resume", variant: "destructive" }); setActingOn(null); },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async (type: string) => {
      const res = await apiRequest("POST", `/api/integrations/${type}/health-check`);
      return res.json();
    },
    onSuccess: (data: any, type) => {
      toast({
        title: `${INTEGRATION_LABELS[type] ?? type} health check`,
        description: `Status: ${data.status}${data.warnings?.length ? ` · ${data.warnings[0]}` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setActingOn(null);
    },
    onError: () => { toast({ title: "Health check failed", variant: "destructive" }); setActingOn(null); },
  });

  // Group agents by department
  const byDepartment = (agents ?? []).reduce<Record<string, AgentEntry[]>>((acc, a) => {
    if (!acc[a.department]) acc[a.department] = [];
    acc[a.department].push(a);
    return acc;
  }, {});

  // Build integration map for lookup
  const integrationMap = new Map((integrations ?? []).map(i => [i.integrationType, i]));

  const handlePause = (type: string) => { setActingOn(type); pauseMutation.mutate(type); };
  const handleResume = (type: string) => { setActingOn(type); resumeMutation.mutate(type); };
  const handleHealthCheck = (type: string) => { setActingOn(type); healthCheckMutation.mutate(type); };

  const isActing = pauseMutation.isPending || resumeMutation.isPending || healthCheckMutation.isPending;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-ai-workforce">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            AI Workforce
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organizational AI departments, external integrations, and relationship map.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchAgents(); refetchIntegrations(); }} data-testid="button-refresh-workforce">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Link href="/admin/ai-governance">
            <Button variant="outline" size="sm" data-testid="button-governance-link">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Governance
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center" data-testid="stat-total-agents">
          <p className="text-2xl font-bold text-primary">{agents?.length ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-1">AI Agents</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-connected-integrations">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{integrationStats?.connected ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Connected Integrations</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-recent-actions">
          <p className="text-2xl font-bold text-blue-600">{integrationStats?.recentActions ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Recent Actions</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-success-rate">
          <p className={`text-2xl font-bold ${(integrationStats?.successRate ?? 100) >= 80 ? "text-green-600" : "text-amber-600"}`}>
            {integrationStats?.successRate ?? 100}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">Success Rate</p>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="agents" data-testid="tab-agents">Agents</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">Integrations</TabsTrigger>
          <TabsTrigger value="relationship-map" data-testid="tab-relationship-map">Org Map</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
        </TabsList>

        {/* ── Agents tab ── */}
        <TabsContent value="agents" className="mt-4 space-y-6">
          {agentsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-lg" />)}
            </div>
          ) : (
            Object.entries(byDepartment).map(([dept, deptAgents]) => (
              <div key={dept}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5" />
                  {dept}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deptAgents.map(agent => <AgentCard key={agent.agentType} agent={agent} />)}
                </div>
              </div>
            ))
          )}
          <div className="flex justify-end">
            <Link href="/admin/ai-governance">
              <Button variant="outline" size="sm" data-testid="button-manage-governance">
                Manage Governance <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </TabsContent>

        {/* ── Integrations tab ── */}
        <TabsContent value="integrations" className="mt-4 space-y-4">
          {integrationStats && (
            <div className="flex items-center gap-4 bg-muted/40 rounded-lg px-4 py-2.5 text-sm flex-wrap" data-testid="integration-status-bar">
              <span className="text-muted-foreground font-medium">System Status:</span>
              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                {integrationStats.connected} connected
              </span>
              {integrationStats.degraded > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  {integrationStats.degraded} degraded
                </span>
              )}
              {integrationStats.error > 0 && (
                <span className="flex items-center gap-1.5 text-red-600">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                  {integrationStats.error} error
                </span>
              )}
              {integrationStats.paused > 0 && (
                <span className="flex items-center gap-1.5 text-blue-500">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                  {integrationStats.paused} paused
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" />
                {integrationStats.successRate}% success (last 100 actions)
              </span>
            </div>
          )}

          {integrationsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ALL_INTEGRATION_TYPES.map(type => (
                <IntegrationCard
                  key={type}
                  type={type}
                  integration={integrationMap.get(type)}
                  onPause={handlePause}
                  onResume={handleResume}
                  onHealthCheck={handleHealthCheck}
                  isActing={isActing && actingOn === type}
                />
              ))}
            </div>
          )}

          <div className="bg-muted/40 rounded-lg p-4 text-sm text-muted-foreground" data-testid="integration-setup-hint">
            <p className="font-medium mb-1">Setting up integrations</p>
            <p>Configure credentials via <code className="text-xs bg-muted px-1 rounded">PUT /api/integrations/:type/credentials</code>. All credentials are org-scoped and never exposed via the API. All actions route through the governance runtime.</p>
          </div>
        </TabsContent>

        {/* ── Org Map tab ── */}
        <TabsContent value="relationship-map" className="mt-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Agent → Integration Relationship Map
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows which agents are authorized to use which integrations.
            </p>
          </div>
          {mapLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : (
            <RelationshipMap data={relationshipMap ?? []} />
          )}
        </TabsContent>

        {/* ── Activity tab ── */}
        <TabsContent value="activity" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Integration Execution Log
            </h3>
            <Link href="/admin/agent-ops">
              <Button variant="ghost" size="sm" className="text-xs gap-1">
                <Eye className="h-3.5 w-3.5" />
                Full Agent Ops
              </Button>
            </Link>
          </div>
          {logsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
            </div>
          ) : !execLogs?.length ? (
            <div className="text-center py-10 text-sm text-muted-foreground border-2 border-dashed rounded-lg" data-testid="text-no-exec-logs">
              No integration actions logged yet. Actions will appear here once integrations are configured and running.
            </div>
          ) : (
            <div className="border rounded-lg px-3 py-1" data-testid="list-exec-logs">
              {execLogs.map(log => <LogRow key={log.id} log={log} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
