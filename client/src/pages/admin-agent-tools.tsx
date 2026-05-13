import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Mail, MessageSquare, Calendar, DollarSign, CreditCard, Activity,
  UserCheck, Database, Zap, CheckCircle, XCircle, Clock, AlertTriangle,
  Building2, Wrench, Shield, Eye, RotateCcw, ExternalLink, ChevronDown,
  ChevronRight, Plug, Circle, FlaskConical,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolPermissions = {
  safe_auto_execute: boolean;
  requires_confirmation: boolean;
  admin_only: boolean;
  external_side_effect: boolean;
  financial_side_effect: boolean;
  client_visible: boolean;
};

type ToolDef = {
  name: string;
  description: string;
  category: string;
  permissions: ToolPermissions;
  riskLevel: "low" | "medium" | "high" | "critical";
  connector: string;
  connectorStatus: "live" | "stub" | "planned";
};

type ConnectorRoadmapItem = {
  name: string;
  status: "live" | "stub" | "planned";
  description: string;
  tools: string[];
};

type ToolRegistryResponse = {
  tools: ToolDef[];
  connectorRoadmap: ConnectorRoadmapItem[];
};

type AgentToolCall = {
  id: string;
  orgId: string;
  agentName: string;
  toolName: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  inputSummary: string | null;
  proposedInput: Record<string, any>;
  reason: string | null;
  confidence: number | null;
  estimatedImpact: number | null;
  requiresConfirmation: boolean;
  confirmationStatus: string;
  status: string;
  result: Record<string, any>;
  error: string | null;
  executionTimeMs: number | null;
  createdAt: string;
  executedAt: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, any> = {
  communication: Mail,
  scheduling: Calendar,
  crm: UserCheck,
  financial: DollarSign,
  internal: Database,
};

const CONNECTOR_ICONS: Record<string, any> = {
  sendgrid: Mail,
  twilio: MessageSquare,
  stripe: CreditCard,
  google_calendar: Calendar,
  internal: Database,
  stub: FlaskConical,
  planned: Circle,
};

const RISK_CONFIG = {
  low: { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/15", label: "Low Risk" },
  medium: { color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/15", label: "Medium Risk" },
  high: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/15", label: "High Risk" },
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/15", label: "Critical" },
};

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  success: { color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle, label: "Success" },
  failed: { color: "text-red-600 dark:text-red-400", icon: XCircle, label: "Failed" },
  pending: { color: "text-yellow-600 dark:text-yellow-400", icon: Clock, label: "Pending" },
  pending_confirmation: { color: "text-blue-600 dark:text-blue-400", icon: Shield, label: "Awaiting Confirmation" },
  executing: { color: "text-purple-600 dark:text-purple-400", icon: Activity, label: "Executing" },
  rejected: { color: "text-muted-foreground", icon: XCircle, label: "Rejected" },
  rolled_back: { color: "text-orange-600", icon: RotateCcw, label: "Rolled Back" },
};

function ConnectorStatusBadge({ status }: { status: string }) {
  if (status === "live") return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] px-1.5 py-0">Live</Badge>;
  if (status === "stub") return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[10px] px-1.5 py-0">Stub</Badge>;
  return <Badge className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0">Planned</Badge>;
}

function PermissionPills({ perms }: { perms: ToolPermissions }) {
  const pills = [
    perms.safe_auto_execute && { label: "Auto Execute", color: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
    perms.requires_confirmation && { label: "Needs Confirm", color: "bg-blue-500/20 text-blue-700 dark:text-blue-400" },
    perms.admin_only && { label: "Admin Only", color: "bg-purple-500/20 text-purple-700 dark:text-purple-400" },
    perms.external_side_effect && { label: "External", color: "bg-orange-500/20 text-orange-700 dark:text-orange-400" },
    perms.financial_side_effect && { label: "Financial", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" },
    perms.client_visible && { label: "Client Visible", color: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400" },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div className="flex flex-wrap gap-1">
      {pills.map(p => (
        <span key={p.label} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.color}`}>{p.label}</span>
      ))}
    </div>
  );
}

// ─── Tool Registry Tab ────────────────────────────────────────────────────────

function ToolRegistryTab({ tools, roadmap }: { tools: ToolDef[]; roadmap: ConnectorRoadmapItem[] }) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [expandedRoadmap, setExpandedRoadmap] = useState(false);

  const categories = ["all", "communication", "scheduling", "crm", "financial", "internal"];
  const filtered = activeCategory === "all" ? tools : tools.filter(t => t.category === activeCategory);

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="flex gap-1.5 flex-wrap">
        {categories.map(cat => {
          const Icon = CATEGORY_ICONS[cat] ?? Wrench;
          return (
            <Button
              key={cat}
              size="sm"
              variant={activeCategory === cat ? "default" : "outline"}
              className="h-7 text-xs capitalize"
              onClick={() => setActiveCategory(cat)}
              data-testid={`filter-category-${cat}`}
            >
              {cat !== "all" && <Icon className="h-3 w-3 mr-1" />}
              {cat === "all" ? "All Tools" : cat}
            </Button>
          );
        })}
      </div>

      {/* Tool cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map(tool => {
          const CatIcon = CATEGORY_ICONS[tool.category] ?? Wrench;
          const ConnIcon = CONNECTOR_ICONS[tool.connector] ?? Plug;
          const risk = RISK_CONFIG[tool.riskLevel];

          return (
            <Card key={tool.name} className="p-4 space-y-3" data-testid={`card-tool-${tool.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="rounded-lg bg-muted p-2 shrink-0">
                    <CatIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-semibold truncate" data-testid={`text-tool-name-${tool.name}`}>
                      {tool.name}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">{tool.category}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge className={`text-[10px] px-1.5 py-0 ${risk.bg} ${risk.color}`}>
                    {risk.label}
                  </Badge>
                  <ConnectorStatusBadge status={tool.connectorStatus} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ConnIcon className="h-3 w-3 shrink-0" />
                <span className="font-medium capitalize">{tool.connector.replace("_", " ")}</span>
              </div>

              <PermissionPills perms={tool.permissions} />
            </Card>
          );
        })}
      </div>

      {/* Connector Roadmap */}
      <div>
        <button
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full text-left"
          onClick={() => setExpandedRoadmap(v => !v)}
          data-testid="button-toggle-roadmap"
        >
          {expandedRoadmap ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Connector Roadmap ({roadmap.length} integrations)
        </button>

        {expandedRoadmap && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {roadmap.map(c => (
              <Card key={c.name} className="p-3 space-y-1.5" data-testid={`card-connector-${c.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <ConnectorStatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
                {c.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.tools.map(t => (
                      <span key={t} className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pending Confirmations Tab ────────────────────────────────────────────────

function PendingConfirmationsTab() {
  const { toast } = useToast();
  const [selectedCall, setSelectedCall] = useState<AgentToolCall | null>(null);

  const { data, isLoading } = useQuery<{ calls: AgentToolCall[]; count: number }>({
    queryKey: ["/api/admin/agent-tool-calls/pending"],
    refetchInterval: 15_000,
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/agent-tool-calls/${id}/confirm`).then(r => r.json()),
    onSuccess: (result) => {
      toast({
        title: result.success ? "Tool executed" : "Execution failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls"] });
      setSelectedCall(null);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/agent-tool-calls/${id}/reject`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Tool call rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-tool-calls"] });
      setSelectedCall(null);
    },
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;

  const calls = data?.calls ?? [];

  if (calls.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed" data-testid="card-no-pending">
        <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
        <p className="text-sm font-semibold">No pending confirmations</p>
        <p className="text-xs text-muted-foreground mt-1">All agent actions are up to date.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3" data-testid="list-pending-confirmations">
        {calls.map(call => {
          const riskTool = call.toolName;
          const risk = ["cancel_session", "record_payment", "create_invoice"].includes(riskTool)
            ? RISK_CONFIG.critical
            : ["send_email", "send_sms", "book_session"].includes(riskTool)
            ? RISK_CONFIG.high
            : RISK_CONFIG.medium;

          return (
            <Card
              key={call.id}
              className={`p-4 border ${
                risk === RISK_CONFIG.critical ? "border-red-500/30 bg-red-500/3" :
                risk === RISK_CONFIG.high ? "border-orange-500/30 bg-orange-500/3" :
                "border-border"
              }`}
              data-testid={`card-pending-call-${call.id.slice(-6)}`}
            >
              <div className="flex items-start gap-3">
                <Shield className={`h-5 w-5 shrink-0 mt-0.5 ${risk.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`text-[10px] px-1.5 py-0 ${risk.bg} ${risk.color}`}>{risk.label}</Badge>
                    <span className="text-xs font-mono font-semibold">{call.toolName}</span>
                    <span className="text-xs text-muted-foreground">by {call.agentName}</span>
                  </div>
                  <p className="text-sm font-medium leading-snug" data-testid={`text-pending-summary-${call.id.slice(-6)}`}>
                    {call.inputSummary ?? call.toolName}
                  </p>
                  {call.targetName && (
                    <p className="text-xs text-muted-foreground mt-0.5">→ {call.targetName}</p>
                  )}
                  {call.reason && (
                    <p className="text-xs text-muted-foreground mt-1 italic">"{call.reason}"</p>
                  )}
                  <div className="flex gap-3 mt-1.5">
                    {call.confidence != null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.round(call.confidence * 100)}% confidence
                      </span>
                    )}
                    {call.estimatedImpact != null && call.estimatedImpact > 0 && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        ~${call.estimatedImpact.toLocaleString()} impact
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(call.createdAt))} ago
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                <Button
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  onClick={() => confirmMutation.mutate(call.id)}
                  disabled={confirmMutation.isPending || rejectMutation.isPending}
                  data-testid={`button-confirm-call-${call.id.slice(-6)}`}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Confirm & Execute
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={() => setSelectedCall(call)}
                  data-testid={`button-preview-call-${call.id.slice(-6)}`}
                >
                  <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => rejectMutation.mutate(call.id)}
                  disabled={rejectMutation.isPending || confirmMutation.isPending}
                  data-testid={`button-reject-call-${call.id.slice(-6)}`}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Preview dialog */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-tool-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              Tool Call Preview
            </DialogTitle>
            <DialogDescription>
              Review the proposed action before confirming execution.
            </DialogDescription>
          </DialogHeader>
          {selectedCall && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Tool</p>
                  <p className="text-sm font-mono font-semibold">{selectedCall.toolName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Agent</p>
                  <p className="text-sm font-semibold">{selectedCall.agentName}</p>
                </div>
                {selectedCall.targetName && (
                  <div>
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="text-sm">{selectedCall.targetName}</p>
                  </div>
                )}
                {selectedCall.confidence != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Confidence</p>
                    <p className="text-sm">{Math.round(selectedCall.confidence * 100)}%</p>
                  </div>
                )}
                {selectedCall.estimatedImpact != null && selectedCall.estimatedImpact > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Expected Impact</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      ${selectedCall.estimatedImpact.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>

              {selectedCall.reason && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reason</p>
                  <p className="text-sm text-muted-foreground italic">"{selectedCall.reason}"</p>
                </div>
              )}

              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Proposed Input</p>
                <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words" data-testid="pre-proposed-input">
                  {JSON.stringify(selectedCall.proposedInput, null, 2)}
                </pre>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => confirmMutation.mutate(selectedCall.id)}
                  disabled={confirmMutation.isPending}
                  data-testid="button-dialog-confirm"
                >
                  <CheckCircle className="h-4 w-4 mr-2" /> Confirm & Execute
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-red-500/30 text-red-600 hover:bg-red-500/10"
                  onClick={() => rejectMutation.mutate(selectedCall.id)}
                  disabled={rejectMutation.isPending}
                  data-testid="button-dialog-reject"
                >
                  <XCircle className="h-4 w-4 mr-2" /> Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

function AuditLogTab() {
  const { data, isLoading } = useQuery<{ calls: AgentToolCall[] }>({
    queryKey: ["/api/admin/agent-tool-calls"],
    staleTime: 15_000,
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;

  const calls = data?.calls ?? [];

  if (calls.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed" data-testid="card-audit-empty">
        <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-semibold">No tool calls yet</p>
        <p className="text-xs text-muted-foreground mt-1">Agent tool calls will appear here once agents start proposing actions.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2" data-testid="list-audit-log">
      {calls.map((call, i) => {
        const statusCfg = STATUS_CONFIG[call.status] ?? STATUS_CONFIG.pending;
        const StatusIcon = statusCfg.icon;

        return (
          <Card key={call.id} className="p-3" data-testid={`row-audit-${i}`}>
            <div className="flex items-center gap-3">
              <StatusIcon className={`h-4 w-4 shrink-0 ${statusCfg.color}`} />
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-semibold">{call.toolName}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{call.agentName}</span>
                {call.targetName && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">→ {call.targetName}</span>
                  </>
                )}
                {call.inputSummary && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">{call.inputSummary}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {call.executionTimeMs != null && (
                  <span className="text-[10px] text-muted-foreground">{call.executionTimeMs}ms</span>
                )}
                <Badge className={`text-[10px] px-1.5 py-0 ${statusCfg.color} bg-transparent border-current border`}>
                  {statusCfg.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(call.createdAt))} ago
                </span>
              </div>
            </div>
            {call.error && (
              <p className="text-xs text-red-500 mt-1.5 pl-7">{call.error}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentToolsPage() {
  const { data: registry, isLoading: registryLoading } = useQuery<ToolRegistryResponse>({
    queryKey: ["/api/admin/agent-tools"],
    staleTime: 60_000,
  });

  const { data: pendingData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/agent-tool-calls/pending"],
    refetchInterval: 30_000,
  });

  const pendingCount = pendingData?.count ?? 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24" data-testid="page-agent-tools">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Agent Tool Layer</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Unified tool registry — every agent action routes through here with permissions, validation, and a full audit trail.
        </p>
      </div>

      {/* Summary bar */}
      {!registryLoading && registry && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Tools", value: registry.tools.length, icon: Wrench, color: "text-foreground" },
            { label: "Live Connectors", value: registry.tools.filter(t => t.connectorStatus === "live").length, icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Auto Execute", value: registry.tools.filter(t => t.permissions.safe_auto_execute).length, icon: Zap, color: "text-blue-600 dark:text-blue-400" },
            { label: "Pending Approval", value: pendingCount, icon: Shield, color: pendingCount > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground" },
          ].map((s, i) => (
            <Card key={i} className="p-3 text-center" data-testid={`card-summary-${i}`}>
              <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue={pendingCount > 0 ? "pending" : "registry"} data-testid="tabs-agent-tools">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="registry" data-testid="tab-registry">Tool Registry</TabsTrigger>
          <TabsTrigger value="pending" className="relative" data-testid="tab-pending">
            Pending
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-orange-500 text-white text-[9px] font-bold rounded-full h-4 w-4 inline-flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="mt-4">
          {registryLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          ) : (
            <ToolRegistryTab
              tools={registry?.tools ?? []}
              roadmap={registry?.connectorRoadmap ?? []}
            />
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <PendingConfirmationsTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
