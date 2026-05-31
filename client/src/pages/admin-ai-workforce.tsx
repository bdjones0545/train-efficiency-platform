import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, type Node, type Edge,
  type NodeTypes, BackgroundVariant, MarkerType, useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
  Cpu, Globe, Mail, Calendar, Hash, Search, Zap, BarChart3, Store,
  CircleDot, Brain, Play, Pause, GitBranch, ArrowRight, Eye,
  Settings, Target, ListChecks, HeartPulse, Trophy, DollarSign,
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
  meta_capi: Globe,
  hubspot: BarChart3,
  stripe: Zap,
  sendgrid: Mail,
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
  meta_capi: "Meta CAPI (Conversion API)",
  hubspot: "HubSpot",
  stripe: "Stripe",
  sendgrid: "SendGrid (Email)",
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
  "meta_ads", "meta_capi", "hubspot", "stripe", "sendgrid", "twilio",
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

          {/* Profile link */}
          {agent.agentType && (
            <div className="mt-2 pt-2 border-t border-border/40">
              <Link href={`/admin/ai-employee/${agent.agentType.replace("_agent", "")}`}>
                <button className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors" data-testid={`link-agent-profile-${agent.agentType}`}>
                  View full profile →
                </button>
              </Link>
            </div>
          )}
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

          {/* Rate limit quota display */}
          {integration?.rateLimitState && (() => {
            const rl = integration.rateLimitState as any;
            const current = rl?.current ?? rl?.currentCount;
            const max = rl?.max ?? rl?.maxExecutions ?? rl?.limit;
            if (current !== undefined && max !== undefined) {
              const pct = Math.min(100, Math.round((current / max) * 100));
              const colorCls = pct >= 90 ? "text-red-500" : pct >= 70 ? "text-amber-500" : "text-green-600 dark:text-green-400";
              return (
                <div className="mt-1" data-testid={`rate-limit-${type}`}>
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-muted-foreground">Rate limit</span>
                    <span className={`font-medium ${colorCls}`}>{current}/{max} {rl?.window ? `per ${rl.window}` : ""}</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-1 rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Credential expiry warning */}
          {integration && (() => {
            const creds = integration as any;
            const expiry = creds?.authExpiration ?? creds?.tokenExpiresAt ?? creds?.credentialExpiresAt;
            if (!expiry) return null;
            const expiryDate = new Date(expiry);
            const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (daysLeft > 14) return null;
            return (
              <p className={`text-[10px] mt-1 font-medium flex items-center gap-1 ${daysLeft <= 3 ? "text-red-500" : "text-amber-500"}`} data-testid={`credential-expiry-${type}`}>
                <AlertTriangle className="h-3 w-3" />
                {daysLeft <= 0 ? "Credentials expired" : `Credentials expire in ${daysLeft}d`}
              </p>
            );
          })()}

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

// ─── Interactive Relationship Graph Node ──────────────────────────────────────

function OrgGraphNode({ data, selected }: { data: any; selected: boolean }) {
  const typeColors: Record<string, { bg: string; border: string; text: string }> = {
    department: { bg: "#1e40af", border: "#1d4ed8", text: "#fff" },
    agent:      { bg: "#0f766e", border: "#0d9488", text: "#fff" },
    integration:{ bg: "#7c3aed", border: "#8b5cf6", text: "#fff" },
    workflow:   { bg: "#b45309", border: "#d97706", text: "#fff" },
  };
  const colors = typeColors[data.nodeType] ?? typeColors.agent;

  return (
    <div
      className={`rounded-xl border-2 px-3 py-2 min-w-[120px] max-w-[160px] shadow-sm text-center cursor-pointer transition-transform ${selected ? "scale-110 shadow-lg" : "hover:scale-105"}`}
      style={{ backgroundColor: colors.bg, borderColor: selected ? "#fff" : colors.border }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">{data.nodeType}</p>
      <p className="text-xs font-semibold text-white truncate mt-0.5">{data.label}</p>
      {data.status && (
        <span className={`inline-block mt-1 h-1.5 w-1.5 rounded-full ${
          data.status === "connected" ? "bg-green-400" :
          data.status === "error" ? "bg-red-400" : "bg-amber-400"
        }`} />
      )}
      {data.sub && <p className="text-[9px] text-white/60 mt-0.5 truncate">{data.sub}</p>}
    </div>
  );
}

const orgNodeTypes: NodeTypes = { orgNode: OrgGraphNode as any };

// ─── Build graph from relationship data ───────────────────────────────────────

function buildOrgGraph(data: RelationshipEntry[], integrations: IntegrationEntry[], workflows: any[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const deptSet = new Set<string>();
  const intSet = new Set<string>();

  // Department nodes (top row)
  data.forEach(entry => {
    if (!deptSet.has(entry.department)) {
      deptSet.add(entry.department);
      nodes.push({
        id: `dept-${entry.department}`,
        type: "orgNode",
        position: { x: ([...deptSet].indexOf(entry.department)) * 220, y: 0 },
        data: { label: entry.department, nodeType: "department" },
      });
    }
  });

  // Agent nodes (middle row)
  data.forEach((entry, i) => {
    const agentId = `agent-${entry.agent}`;
    nodes.push({
      id: agentId,
      type: "orgNode",
      position: { x: i * 195, y: 140 },
      data: { label: entry.agentName, nodeType: "agent", sub: entry.department },
    });
    // Link to dept
    edges.push({
      id: `e-dept-${entry.agent}`,
      source: `dept-${entry.department}`,
      target: agentId,
      style: { stroke: "#4b5563", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed },
    });

    // Integration nodes
    entry.connectedIntegrations.forEach((int, j) => {
      const intNodeId = `int-${int.type}`;
      if (!intSet.has(int.type)) {
        intSet.add(int.type);
        nodes.push({
          id: intNodeId,
          type: "orgNode",
          position: { x: ([...intSet].indexOf(int.type)) * 185, y: 300 },
          data: { label: INTEGRATION_LABELS[int.type] ?? int.type, nodeType: "integration", status: int.status },
        });
      }
      edges.push({
        id: `e-${entry.agent}-${int.type}-${j}`,
        source: agentId,
        target: intNodeId,
        style: { stroke: "#7c3aed", strokeWidth: 1, strokeDasharray: "4 2" },
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: int.status === "connected",
      });
    });
  });

  // Workflow nodes (bottom row)
  workflows.slice(0, 6).forEach((wf, i) => {
    const wfId = `wf-${wf.id}`;
    nodes.push({
      id: wfId,
      type: "orgNode",
      position: { x: i * 190, y: 460 },
      data: {
        label: wf.name,
        nodeType: "workflow",
        status: wf.published ? "connected" : undefined,
        sub: `${wf.riskLevel} risk`,
      },
    });
    // Connect to first agent in org
    if (nodes.find(n => n.data.nodeType === "agent")) {
      edges.push({
        id: `e-wf-${wf.id}`,
        source: `agent-${data[i % data.length]?.agent}`,
        target: wfId,
        style: { stroke: "#b45309", strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  });

  return { nodes, edges };
}

// ─── Visual Relationship Graph ────────────────────────────────────────────────

function VisualRelationshipGraph({ data, integrations, workflows }: {
  data: RelationshipEntry[];
  integrations: IntegrationEntry[];
  workflows: any[];
}) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildOrgGraph(data, integrations, workflows),
    [data, integrations, workflows],
  );
  const [nodes, , onNodesChange] = useNodesState<Node>(initNodes);
  const [edges, , onEdgesChange] = useEdgesState<Edge>(initEdges);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node);
  }, []);

  return (
    <div className="flex gap-4" style={{ height: 520 }} data-testid="section-relationship-map">
      <div className="flex-1 rounded-xl border bg-slate-950 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={orgNodeTypes}
          fitView
          nodesDraggable
          nodesConnectable={false}
          className="bg-slate-950"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#334155" />
          <Controls className="rounded-lg" />
          <MiniMap
            nodeColor={n => {
              const t = (n.data as any)?.nodeType;
              return t === "department" ? "#1e40af" : t === "agent" ? "#0f766e" : t === "integration" ? "#7c3aed" : "#b45309";
            }}
            className="rounded-lg bg-slate-900"
          />
        </ReactFlow>
      </div>

      {/* Detail panel */}
      <div className="w-52 shrink-0 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Graph Legend</div>
        {[
          { color: "#1e40af", label: "Department" },
          { color: "#0f766e", label: "Agent" },
          { color: "#7c3aed", label: "Integration" },
          { color: "#b45309", label: "Workflow" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-2 text-xs">
            <span className="h-3 w-3 rounded shrink-0" style={{ backgroundColor: l.color }} />
            {l.label}
          </div>
        ))}

        {selectedNode && (
          <div className="mt-4 p-3 rounded-lg border bg-muted/30 space-y-1.5">
            <p className="text-xs font-bold">{(selectedNode.data as any).label}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{(selectedNode.data as any).nodeType}</p>
            {(selectedNode.data as any).sub && (
              <p className="text-[10px] text-muted-foreground">{(selectedNode.data as any).sub}</p>
            )}
            {(selectedNode.data as any).status && (
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                (selectedNode.data as any).status === "connected" ? "bg-green-100 text-green-700" :
                (selectedNode.data as any).status === "error" ? "bg-red-100 text-red-700" :
                "bg-amber-100 text-amber-700"
              }`}>
                {(selectedNode.data as any).status}
              </span>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground pt-2">
          {nodes.length} nodes · {edges.length} connections
        </div>
        <p className="text-[10px] text-muted-foreground">Click nodes to inspect · Drag to rearrange</p>
      </div>
    </div>
  );
}

function RelationshipMap({ data }: { data: RelationshipEntry[] }) {
  return (
    <div className="space-y-3" data-testid="section-relationship-map-list">
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
                  <div key={int.type} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs bg-muted/40">
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

  const { data: graphs } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });

  const { data: health, refetch: refetchHealth } = useQuery<any>({
    queryKey: ["/api/workforce/health"],
    queryFn: async () => { const r = await fetch("/api/workforce/health"); return r.json(); },
    refetchInterval: 60000,
  });

  const { data: readiness } = useQuery<any>({
    queryKey: ["/api/workforce/readiness"],
    queryFn: async () => { const r = await fetch("/api/workforce/readiness"); return r.json(); },
    refetchInterval: 120000,
  });

  const { data: scorecard } = useQuery<any>({
    queryKey: ["/api/workforce/scorecard", "7d"],
    queryFn: async () => { const r = await fetch("/api/workforce/scorecard?period=7d"); return r.json(); },
    refetchInterval: 120000,
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

  const HEALTH_CONFIG: Record<string, { cls: string; dot: string }> = {
    Healthy: { cls: "text-green-700 bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400", dot: "bg-green-500" },
    "Attention Needed": { cls: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400", dot: "bg-amber-400" },
    Critical: { cls: "text-red-700 bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400", dot: "bg-red-500" },
  };
  const healthStatus = health?.systemHealth ?? "Healthy";
  const healthCfg = HEALTH_CONFIG[healthStatus] ?? HEALTH_CONFIG.Healthy;

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
            Operational command center for your AI agent workforce.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link href="/admin/agent-marketplace">
            <Button variant="outline" size="sm" className="border-indigo-700 text-indigo-400 hover:bg-indigo-900/30" data-testid="button-marketplace-link">
              <Store className="h-4 w-4 mr-1.5" />Marketplace
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/executions">
            <Button variant="outline" size="sm" className="border-cyan-700 text-cyan-400 hover:bg-cyan-900/30" data-testid="button-executions-link">
              <Zap className="h-4 w-4 mr-1.5" />Execute
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/optimization">
            <Button variant="outline" size="sm" className="border-purple-700 text-purple-400 hover:bg-purple-900/30" data-testid="button-optimization-link">
              <Brain className="h-4 w-4 mr-1.5" />Optimize
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/outcomes">
            <Button variant="outline" size="sm" className="border-green-700 text-green-400 hover:bg-green-900/30" data-testid="button-outcomes-link">
              <DollarSign className="h-4 w-4 mr-1.5" />ROI
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/leaderboard">
            <Button variant="outline" size="sm" className="border-yellow-700 text-yellow-400 hover:bg-yellow-900/30" data-testid="button-leaderboard-link">
              <Trophy className="h-4 w-4 mr-1.5" />Leaderboard
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/activity">
            <Button variant="outline" size="sm" data-testid="button-activity-link">
              <Activity className="h-4 w-4 mr-1.5" />Activity
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/capabilities">
            <Button variant="outline" size="sm" data-testid="button-capabilities-link">
              <ShieldCheck className="h-4 w-4 mr-1.5" />Capabilities
            </Button>
          </Link>
          <Link href="/admin/ai-workforce/settings">
            <Button variant="outline" size="sm" data-testid="button-settings-link">
              <Settings className="h-4 w-4 mr-1.5" />Settings
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => { refetchAgents(); refetchIntegrations(); refetchHealth(); }} data-testid="button-refresh-workforce">
            <RefreshCw className="h-4 w-4 mr-1.5" />Refresh
          </Button>
        </div>
      </div>

      {/* System health banner */}
      {health && (
        <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg border ${healthCfg.cls}`} data-testid="banner-workforce-health">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${healthCfg.dot} ${healthStatus !== "Healthy" ? "animate-pulse" : ""}`} />
            <span className="text-sm font-semibold">System {healthStatus}</span>
            {health.failedActionsToday > 0 && (
              <span className="text-xs">· {health.failedActionsToday} failed action{health.failedActionsToday > 1 ? "s" : ""} today</span>
            )}
            {health.approvalsPending > 0 && (
              <span className="text-xs">· {health.approvalsPending} pending approval{health.approvalsPending > 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span>{health.actionsToday} actions today</span>
            <span>{health.workflowsPublished} workflows active</span>
            <Link href="/admin/ai-workforce/activity">
              <button className="underline underline-offset-2 font-medium">View feed →</button>
            </Link>
          </div>
        </div>
      )}

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center" data-testid="stat-total-agents">
          <p className="text-2xl font-bold text-primary">{health?.activeAgents ?? agents?.length ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-1">Active Agents</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-connected-integrations">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{health?.integrationsConnected ?? integrationStats?.connected ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Connected Integrations</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-actions-today">
          <p className="text-2xl font-bold text-blue-600">{health?.actionsToday ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Actions Today</p>
        </Card>
        <Card className="p-4 text-center" data-testid="stat-success-rate">
          <p className={`text-2xl font-bold ${(scorecard?.successRate ?? 100) >= 80 ? "text-green-600" : "text-amber-600"}`}>
            {scorecard?.successRate ?? 100}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">7d Success Rate</p>
        </Card>
      </div>

      {/* Readiness checklist (show if not fully complete) */}
      {readiness && readiness.completionPercent < 100 && (
        <Card className="p-4" data-testid="card-readiness-checklist">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Workforce Readiness</h3>
              <span className="text-xs text-muted-foreground">{readiness.completionPercent}% complete</span>
            </div>
            <Link href="/admin/ai-workforce/settings">
              <Button variant="ghost" size="sm" className="text-xs h-6 gap-1">
                Configure <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 mb-3">
            <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${readiness.completionPercent}%` }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {readiness.checklist?.map((item: any) => (
              <div key={item.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${
                item.status === "complete" ? "text-green-700 dark:text-green-400" :
                item.status === "in_progress" ? "text-amber-600 dark:text-amber-400" :
                "text-muted-foreground"
              }`} data-testid={`readiness-item-${item.id}`}>
                {item.status === "complete" ? (
                  <CheckCircle className="h-3 w-3 shrink-0 text-green-600" />
                ) : item.status === "in_progress" ? (
                  <Clock className="h-3 w-3 shrink-0 text-amber-500" />
                ) : (
                  <div className="h-3 w-3 rounded-full border border-muted-foreground shrink-0" />
                )}
                <span className={item.status === "complete" ? "line-through opacity-60" : ""}>{item.title}</span>
                {item.status !== "complete" && item.priority === "high" && (
                  <span className="ml-auto text-[9px] px-1 rounded bg-amber-100 text-amber-700 shrink-0">High</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="agents" data-testid="tab-agents">Agents</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">Integrations</TabsTrigger>
          <TabsTrigger value="relationship-map" data-testid="tab-relationship-map">Org Map</TabsTrigger>
          <TabsTrigger value="scorecard" data-testid="tab-scorecard">Scorecard</TabsTrigger>
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

          {/* Integration setup CTAs — show agents affected by missing integrations */}
          {health && health.integrationsMissing > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 space-y-2" data-testid="integration-setup-ctas">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{health.integrationsMissing} integrations not connected</p>
              </div>
              {[
                { type: "gmail", label: "Gmail", agents: ["Relay (Communications)"], desc: "Email outreach, follow-ups, notifications" },
                { type: "google_calendar", label: "Google Calendar", agents: ["Tempo (Scheduling)"], desc: "Session booking, reschedules, availability" },
                { type: "stripe", label: "Stripe", agents: ["Ledger (Finance)"], desc: "Payment tracking, revenue reporting" },
                { type: "slack", label: "Slack", agents: ["Relay (Communications)", "Atlas (Executive)"], desc: "Team alerts, daily briefings" },
                { type: "twilio", label: "Twilio", agents: ["Relay (Communications)"], desc: "SMS outreach, appointment reminders" },
                { type: "hubspot", label: "HubSpot", agents: ["Apex (Revenue)"], desc: "CRM sync, lead tracking" },
              ]
                .filter(({ type }) => {
                  const int = integrationMap.get(type);
                  return !int || int.status !== "connected";
                })
                .map(({ type, label, agents, desc }) => (
                  <div key={type} className="flex items-start justify-between gap-3 bg-white dark:bg-slate-900 rounded p-2.5 border border-amber-100 dark:border-amber-800/50">
                    <div>
                      <p className="text-xs font-semibold">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Required by: {agents.join(", ")}</p>
                    </div>
                    <Link href="/admin/ai-workforce/settings">
                      <Button size="sm" variant="outline" className="text-xs h-7 shrink-0 border-amber-300 hover:bg-amber-50" data-testid={`button-setup-${type}`}>
                        Set up →
                      </Button>
                    </Link>
                  </div>
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
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" />
                AI Organizational Graph
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Interactive map of agents, integrations, workflows, and governance relationships.
              </p>
            </div>
          </div>
          {mapLoading ? (
            <Skeleton className="h-[520px] rounded-xl" />
          ) : (
            <VisualRelationshipGraph
              data={relationshipMap ?? []}
              integrations={integrations ?? []}
              workflows={graphs ?? []}
            />
          )}
        </TabsContent>

        {/* ── Scorecard tab ── */}
        <TabsContent value="scorecard" className="mt-4 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Workforce Scorecard — Last 7 Days
            </h3>
            <div className="flex gap-2">
              <Link href="/admin/ai-workforce/activity">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  <Activity className="h-3.5 w-3.5" />Full Activity Feed
                </Button>
              </Link>
              <Link href="/admin/ai-workforce/capabilities">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" />Capability Matrix
                </Button>
              </Link>
            </div>
          </div>

          {!scorecard ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total Actions", value: scorecard.totalActions, cls: "text-primary" },
                  { label: "Success Rate", value: `${scorecard.successRate ?? 0}%`, cls: scorecard.successRate >= 80 ? "text-green-600" : "text-amber-600" },
                  { label: "Workflow Runs", value: scorecard.workflowExecutions, cls: "text-blue-600" },
                  { label: "Approvals Requested", value: scorecard.approvalsRequested, cls: "text-amber-600" },
                  { label: "Successful Actions", value: scorecard.successfulActions, cls: "text-green-600" },
                  { label: "Failed Actions", value: scorecard.failedActions, cls: "text-red-600" },
                  { label: "Agent Utilization", value: `${scorecard.agentUtilization ?? 0}%`, cls: "text-purple-600" },
                  { label: "Approvals Approved", value: scorecard.approvalsApproved, cls: "text-green-600" },
                ].map(s => (
                  <Card key={s.label} className="p-4 text-center" data-testid={`scorecard-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                    <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Most Active Agent</p>
                  <p className="text-sm font-semibold">{scorecard.mostActiveAgent ?? "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Top Error Source</p>
                  <p className="text-sm font-semibold text-red-600">{scorecard.topErrorSource ?? "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Revenue Influenced</p>
                  <p className="text-sm font-semibold text-green-600">
                    {scorecard.revenueInfluenced > 0 ? `$${scorecard.revenueInfluenced.toLocaleString()}` : "Not tracked"}
                  </p>
                </Card>
              </div>

              {scorecard.agentBreakdown?.length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Per-Agent Breakdown (7d)</p>
                  <div className="space-y-2">
                    {scorecard.agentBreakdown.map((a: any) => (
                      <div key={a.agentType} className="flex items-center gap-3" data-testid={`scorecard-agent-${a.agentType}`}>
                        <span className="text-xs font-medium w-44 shrink-0">{a.agentName}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5 relative">
                          <div
                            className="bg-primary rounded-full h-1.5"
                            style={{ width: `${scorecard.totalActions > 0 ? Math.round((a.actions / scorecard.totalActions) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right">{a.actions} runs</span>
                        {a.errors > 0 && (
                          <span className="text-[10px] text-red-600 w-16 text-right">{a.errors} err</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
