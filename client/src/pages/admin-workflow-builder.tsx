import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Panel,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Save, Play, Upload, Zap, GitBranch, User, CheckCircle, AlertTriangle,
  RefreshCw, Layers, PanelRight, X, Plus, Info, ShieldAlert, Clock,
  ChevronRight, BookTemplate, Eye, Cpu, Search, Sparkles,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { NLWorkflowGenerator } from "@/components/nl-workflow-generator";

// ─── Node palette definition ──────────────────────────────────────────────────

type NodeCategoryDef = {
  label: string;
  icon: typeof Zap;
  color: string;
  nodes: Array<{
    type: string;
    label: string;
    icon: typeof Zap;
    riskLevel: "low" | "medium" | "high" | "critical";
    agentType?: string;
  }>;
};

const NODE_PALETTE: NodeCategoryDef[] = [
  {
    label: "Triggers",
    icon: Zap,
    color: "text-green-600",
    nodes: [
      { type: "schedule_trigger", label: "Schedule", icon: Clock, riskLevel: "low" },
      { type: "webhook_trigger", label: "Webhook", icon: Zap, riskLevel: "low" },
      { type: "gmail_reply_trigger", label: "Gmail Reply", icon: Cpu, riskLevel: "low" },
      { type: "meta_lead_trigger", label: "Meta Lead", icon: Zap, riskLevel: "low" },
      { type: "payment_failed_trigger", label: "Payment Failed", icon: AlertTriangle, riskLevel: "low" },
      { type: "booking_cancelled_trigger", label: "Booking Cancelled", icon: AlertTriangle, riskLevel: "low" },
      { type: "manual_trigger", label: "Manual", icon: Play, riskLevel: "low" },
    ],
  },
  {
    label: "Agent Actions",
    icon: Cpu,
    color: "text-blue-600",
    nodes: [
      { type: "send_email", label: "Send Email", icon: Cpu, riskLevel: "high", agentType: "communication_agent" },
      { type: "post_slack_alert", label: "Slack Alert", icon: Cpu, riskLevel: "medium", agentType: "workflow_agent" },
      { type: "research_lead", label: "Research Lead", icon: Search, riskLevel: "high", agentType: "research_agent" },
      { type: "generate_report", label: "Generate Report", icon: Cpu, riskLevel: "low", agentType: "executive_agent" },
      { type: "classify_reply", label: "Classify Reply", icon: Cpu, riskLevel: "low", agentType: "communication_agent" },
      { type: "summarize_thread", label: "Summarize Thread", icon: Cpu, riskLevel: "low", agentType: "communication_agent" },
      { type: "create_booking", label: "Create Booking", icon: Cpu, riskLevel: "high", agentType: "scheduling_agent" },
      { type: "generate_recommendation", label: "AI Recommendation", icon: Cpu, riskLevel: "low", agentType: "system_agent" },
    ],
  },
  {
    label: "Logic",
    icon: GitBranch,
    color: "text-violet-600",
    nodes: [
      { type: "if_else", label: "IF / ELSE", icon: GitBranch, riskLevel: "low" },
      { type: "confidence_threshold", label: "Confidence Gate", icon: GitBranch, riskLevel: "low" },
      { type: "wait_delay", label: "Wait / Delay", icon: Clock, riskLevel: "low" },
      { type: "retry_policy", label: "Retry Policy", icon: RefreshCw, riskLevel: "low" },
      { type: "rate_limit_gate", label: "Rate Limit Gate", icon: ShieldAlert, riskLevel: "low" },
      { type: "branch_routing", label: "Branch Router", icon: GitBranch, riskLevel: "low" },
    ],
  },
  {
    label: "Human",
    icon: User,
    color: "text-amber-600",
    nodes: [
      { type: "approval_gate", label: "Approval Gate", icon: User, riskLevel: "medium" },
      { type: "manual_review", label: "Manual Review", icon: User, riskLevel: "medium" },
      { type: "escalate_admin", label: "Escalate to Admin", icon: User, riskLevel: "high" },
    ],
  },
  {
    label: "Outcomes",
    icon: CheckCircle,
    color: "text-emerald-600",
    nodes: [
      { type: "workflow_completed", label: "Completed ✓", icon: CheckCircle, riskLevel: "low" },
      { type: "workflow_failed", label: "Failed ✗", icon: AlertTriangle, riskLevel: "low" },
      { type: "workflow_escalated", label: "Escalated", icon: ShieldAlert, riskLevel: "low" },
      { type: "client_retained", label: "Client Retained", icon: CheckCircle, riskLevel: "low" },
      { type: "client_converted", label: "Client Converted", icon: CheckCircle, riskLevel: "low" },
      { type: "session_booked", label: "Session Booked", icon: CheckCircle, riskLevel: "low" },
    ],
  },
];

// ─── Risk colors / governance visual helpers ──────────────────────────────────

const RISK_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  low:      { border: "#22c55e", bg: "#f0fdf4", badge: "bg-green-100 text-green-700" },
  medium:   { border: "#f59e0b", bg: "#fffbeb", badge: "bg-amber-100 text-amber-700" },
  high:     { border: "#ef4444", bg: "#fef2f2", badge: "bg-red-100 text-red-700" },
  critical: { border: "#7c3aed", bg: "#f5f3ff", badge: "bg-violet-100 text-violet-700" },
};

const CATEGORY_HEADER_COLORS: Record<string, string> = {
  trigger:      "#16a34a",
  agent_action: "#2563eb",
  logic:        "#7c3aed",
  human:        "#d97706",
  outcome:      "#0d9488",
};

function getCategoryForType(t: string): string {
  const cats: Record<string, string> = {
    schedule_trigger: "trigger", webhook_trigger: "trigger", gmail_reply_trigger: "trigger",
    meta_lead_trigger: "trigger", payment_failed_trigger: "trigger", booking_cancelled_trigger: "trigger",
    manual_trigger: "trigger", workflow_completed_trigger: "trigger",
    send_email: "agent_action", post_slack_alert: "agent_action", research_lead: "agent_action",
    generate_report: "agent_action", classify_reply: "agent_action", summarize_thread: "agent_action",
    create_booking: "agent_action", generate_recommendation: "agent_action",
    if_else: "logic", confidence_threshold: "logic", wait_delay: "logic",
    retry_policy: "logic", rate_limit_gate: "logic", branch_routing: "logic",
    approval_gate: "human", manual_review: "human", assign_operator: "human", escalate_admin: "human",
    workflow_completed: "outcome", workflow_failed: "outcome", workflow_escalated: "outcome",
    client_retained: "outcome", client_converted: "outcome", session_booked: "outcome",
  };
  return cats[t] ?? "agent_action";
}

// ─── Custom WorkflowNode component ───────────────────────────────────────────

function WorkflowNode({ data, selected }: { data: any; selected: boolean }) {
  const category = getCategoryForType(data.nodeType);
  const risk = RISK_COLORS[data.riskLevel ?? "low"];
  const headerColor = CATEGORY_HEADER_COLORS[category] ?? "#6b7280";

  const execState = data.executionState ?? "idle";
  const stateStyles: Record<string, string> = {
    idle: "",
    running: "ring-2 ring-blue-400 ring-offset-1",
    completed: "ring-2 ring-green-400 ring-offset-1",
    failed: "ring-2 ring-red-400 ring-offset-1",
    waiting_approval: "ring-2 ring-amber-400 ring-offset-1",
    blocked: "ring-2 ring-red-600 ring-offset-1",
    retrying: "ring-2 ring-violet-400 ring-offset-1",
  };

  return (
    <div
      className={`rounded-lg border-2 shadow-sm min-w-[160px] max-w-[200px] bg-white dark:bg-slate-900 text-left ${stateStyles[execState]} ${selected ? "shadow-md" : ""}`}
      style={{ borderColor: risk.border }}
    >
      {/* Header bar */}
      <div
        className="px-2.5 py-1.5 rounded-t-md flex items-center gap-1.5"
        style={{ backgroundColor: headerColor }}
      >
        <span className="text-white text-[10px] font-semibold uppercase tracking-wider truncate">
          {category.replace("_", " ")}
        </span>
        {data.requiresApproval && (
          <ShieldAlert className="h-3 w-3 text-white/80 shrink-0" title="Requires approval" />
        )}
      </div>
      {/* Body */}
      <div className="px-2.5 py-2">
        <p className="text-xs font-semibold text-foreground leading-tight">{data.label}</p>
        {data.agentType && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{data.agentType.replace("_agent", "")}</p>
        )}
        {data.governanceNote && (
          <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" />
            {data.governanceNote.slice(0, 40)}
          </p>
        )}
        {/* Execution state indicator */}
        {execState !== "idle" && (
          <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            execState === "running" ? "bg-blue-100 text-blue-700" :
            execState === "completed" ? "bg-green-100 text-green-700" :
            execState === "failed" ? "bg-red-100 text-red-700" :
            execState === "waiting_approval" ? "bg-amber-100 text-amber-700" :
            execState === "blocked" ? "bg-red-100 text-red-700" :
            "bg-violet-100 text-violet-700"
          }`}>
            {execState === "running" && <span className="animate-pulse">●</span>}
            {execState.replace("_", " ")}
          </div>
        )}
      </div>
      {/* Risk badge */}
      <div className="px-2.5 pb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${risk.badge}`}>
          {data.riskLevel ?? "low"} risk
        </span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { workflowNode: WorkflowNode as any };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createNewNode(nodeType: string, label: string, riskLevel: string, position: { x: number; y: number }, agentType?: string): Node {
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "workflowNode",
    position,
    data: {
      label,
      nodeType,
      category: getCategoryForType(nodeType),
      config: {},
      riskLevel,
      requiresApproval: riskLevel === "high" || riskLevel === "critical",
      agentType,
    },
  };
}

// ─── Node Config Panel ────────────────────────────────────────────────────────

function NodeConfigPanel({ node, onClose, onUpdate }: {
  node: Node;
  onClose: () => void;
  onUpdate: (id: string, data: any) => void;
}) {
  const [label, setLabel] = useState(node.data.label as string);
  const [riskLevel, setRiskLevel] = useState((node.data.riskLevel as string) ?? "low");
  const [requiresApproval, setRequiresApproval] = useState(!!(node.data.requiresApproval));
  const [governanceNote, setGovernanceNote] = useState((node.data.governanceNote as string) ?? "");

  const handleSave = () => {
    onUpdate(node.id, { ...node.data, label, riskLevel, requiresApproval, governanceNote });
    onClose();
  };

  const riskColors = RISK_COLORS[riskLevel];
  const govWarnings = {
    send_email: "This node sends email — ensure governance allows outbound communication.",
    research_lead: "Research Agent requires web access. Confirm governance allows external browsing.",
    create_booking: "This node creates calendar events — execution lock required.",
    approval_gate: "Execution pauses until a human approves. Configure timeout to avoid deadlocks.",
  }[node.data.nodeType as string];

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle className="text-sm">Configure Node</SheetTitle>
          <SheetDescription className="text-xs">{node.data.nodeType as string}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Label</label>
            <Input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 h-8 text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Risk Level</label>
            <Select value={riskLevel} onValueChange={v => {
              setRiskLevel(v);
              if (v === "high" || v === "critical") setRequiresApproval(true);
            }}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low"><span className="text-green-600">Low</span></SelectItem>
                <SelectItem value="medium"><span className="text-amber-600">Medium</span></SelectItem>
                <SelectItem value="high"><span className="text-red-600">High</span></SelectItem>
                <SelectItem value="critical"><span className="text-violet-600">Critical</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requires-approval"
              checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="requires-approval" className="text-sm">Requires operator approval</label>
          </div>

          {govWarnings && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">{govWarnings}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Governance Note (optional)</label>
            <Textarea
              value={governanceNote}
              onChange={e => setGovernanceNote(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
              placeholder="Explain why this node is needed..."
            />
          </div>

          {/* Current risk indicator */}
          <div
            className="p-3 rounded-lg border-2"
            style={{ borderColor: riskColors.border, backgroundColor: riskColors.bg }}
          >
            <p className="text-xs font-medium" style={{ color: riskColors.border }}>
              {riskLevel === "low" && "✓ Autonomous execution allowed"}
              {riskLevel === "medium" && "⚠ Supervised execution — confidence checks apply"}
              {riskLevel === "high" && "⚠ Requires approval before execution"}
              {riskLevel === "critical" && "🛑 Blocked — escalation required"}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="flex-1" onClick={handleSave}>Save Node</Button>
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Templates Panel ──────────────────────────────────────────────────────────

function TemplatesPanel({ onLoad }: { onLoad: (graph: any) => void }) {
  const { data: templates } = useQuery<any>({
    queryKey: ["/api/workflow-graphs/templates"],
  });

  const builtIn = templates?.builtIn ?? [];
  const orgTemplates = templates?.orgTemplates ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Built-in Templates</p>
      <div className="space-y-2">
        {builtIn.map((tpl: any) => (
          <div key={tpl.id} className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => onLoad(tpl.graphDefinition)} data-testid={`template-${tpl.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
              </div>
              <Badge variant="secondary" className="text-[9px] shrink-0">{tpl.category}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${
                tpl.riskLevel === "low" ? "bg-green-100 text-green-700" :
                tpl.riskLevel === "medium" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-700"
              }`}>{tpl.riskLevel} risk</span>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2 ml-auto" onClick={e => { e.stopPropagation(); onLoad(tpl.graphDefinition); }}>
                <ChevronRight className="h-3 w-3" />
                Use
              </Button>
            </div>
          </div>
        ))}
      </div>
      {orgTemplates.length > 0 && (
        <>
          <Separator />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Templates</p>
          <div className="space-y-2">
            {orgTemplates.map((tpl: any) => (
              <div key={tpl.id} className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => onLoad(tpl.graphDefinition)}>
                <p className="text-xs font-semibold">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Simulation Result Panel ──────────────────────────────────────────────────

function SimulationPanel({ result, onClose }: { result: any; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-[440px] sm:w-[480px]" side="right">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <Play className="h-4 w-4 text-blue-500" />
            Simulation Results
          </SheetTitle>
          <SheetDescription className="text-xs">No real actions executed — simulation only</SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100vh-180px)]">
          <div className="space-y-4 pr-2">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-3 text-center">
                <p className="text-xl font-bold">{result.totalSteps}</p>
                <p className="text-[10px] text-muted-foreground">Steps</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{result.approvalCount}</p>
                <p className="text-[10px] text-muted-foreground">Approvals</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{Math.round(result.estimatedDurationMs / 60000)}m</p>
                <p className="text-[10px] text-muted-foreground">Est. Duration</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold">${(result.estimatedCostCents / 100).toFixed(3)}</p>
                <p className="text-[10px] text-muted-foreground">Est. Cost</p>
              </Card>
            </div>

            {/* Risk level */}
            <div className={`p-3 rounded-lg border-l-4 ${
              result.riskLevel === "low" ? "border-green-500 bg-green-50 dark:bg-green-900/20" :
              result.riskLevel === "medium" ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20" :
              "border-red-500 bg-red-50 dark:bg-red-900/20"
            }`}>
              <p className="text-xs font-semibold">Risk Level: {result.riskLevel}</p>
            </div>

            {/* Governance warnings */}
            {result.governanceWarnings?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-amber-600">Governance Warnings</p>
                {result.governanceWarnings.map((w: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Potential deadlocks */}
            {result.potentialDeadlocks?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-red-600">Potential Deadlocks</p>
                {result.potentialDeadlocks.map((d: string, i: number) => (
                  <div key={i} className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded p-2">{d}</div>
                ))}
              </div>
            )}

            {/* API usage */}
            {Object.keys(result.apiCallEstimates ?? {}).length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1.5">Expected API Usage</p>
                <div className="space-y-1">
                  {Object.entries(result.apiCallEstimates).map(([api, count]: [string, any]) => (
                    <div key={api} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{api}</span>
                      <span className="font-medium">{count} calls</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step path */}
            <div>
              <p className="text-xs font-semibold mb-2">Expected Execution Path</p>
              <div className="space-y-2">
                {result.expectedPath?.map((step: any, i: number) => (
                  <div key={step.stepId} className="flex items-start gap-2.5">
                    <div className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      step.governanceDecision === "blocked" ? "bg-red-500" :
                      step.governanceDecision === "approval_required" ? "bg-amber-500" :
                      "bg-green-500"
                    }`}>{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{step.action}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] px-1 rounded font-medium ${
                          step.governanceDecision === "blocked" ? "bg-red-100 text-red-700" :
                          step.governanceDecision === "approval_required" ? "bg-amber-100 text-amber-700" :
                          "bg-green-100 text-green-700"
                        }`}>{step.governanceDecision}</span>
                        {step.agentType && <span className="text-[9px] text-muted-foreground">{step.agentType?.replace("_agent","")}</span>}
                        <span className="text-[9px] text-muted-foreground">{Math.round(step.estimatedDurationMs / 1000)}s</span>
                      </div>
                      {step.governanceReason && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{step.governanceReason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Workflow Builder Page ───────────────────────────────────────────────

export default function AdminWorkflowBuilderPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // UI state
  const [graphName, setGraphName] = useState("New Workflow");
  const [graphDesc, setGraphDesc] = useState("");
  const [graphCategory, setGraphCategory] = useState("custom");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [currentGraphId, setCurrentGraphId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showNLGenerator, setShowNLGenerator] = useState(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Connect edges
  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
      animated: false,
    }, eds));
    setIsDirty(true);
  }, [setEdges]);

  // Drop new node from palette
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData("application/node-type");
    const nodeLabel = event.dataTransfer.getData("application/node-label");
    const nodeRisk = event.dataTransfer.getData("application/node-risk");
    const nodeAgent = event.dataTransfer.getData("application/node-agent");

    if (!nodeType || !reactFlowWrapper.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left - 80,
      y: event.clientY - bounds.top - 40,
    };

    const newNode = createNewNode(nodeType, nodeLabel, nodeRisk, position, nodeAgent || undefined);
    setNodes(nds => nds.concat(newNode));
    setIsDirty(true);
  }, [setNodes]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // Node click → open config
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Node change → mark dirty
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes);
    const nonSelect = changes.filter((c: any) => c.type !== "select");
    if (nonSelect.length > 0) setIsDirty(true);
  }, [onNodesChange]);

  // Update node data from config panel
  const handleNodeUpdate = useCallback((id: string, newData: any) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: newData } : n));
    setSelectedNode(null);
    setIsDirty(true);
  }, [setNodes]);

  // Build graph definition
  const buildGraphDefinition = () => ({
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  // Load template
  const handleLoadTemplate = (graph: any) => {
    setNodes(graph.nodes ?? []);
    setEdges(graph.edges ?? []);
    setShowTemplates(false);
    setIsDirty(true);
    toast({ title: "Template loaded", description: "Edit the workflow to match your needs." });
  };

  // Validate
  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workflow-graphs/validate", { graphDefinition: buildGraphDefinition() });
      return res.json();
    },
    onSuccess: (data) => {
      setValidationResult(data);
      if (data.valid) {
        toast({ title: "Validation passed", description: `${data.warnings?.length ?? 0} warnings` });
      } else {
        toast({ title: `${data.errors?.length} validation error(s)`, variant: "destructive" });
      }
    },
  });

  // Simulate
  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workflow-graphs/simulate", { graphDefinition: buildGraphDefinition() });
      return res.json();
    },
    onSuccess: (data) => {
      setSimulationResult(data);
    },
    onError: () => toast({ title: "Simulation failed", variant: "destructive" }),
  });

  // Save
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: graphName,
        description: graphDesc,
        category: graphCategory,
        graphDefinition: buildGraphDefinition(),
      };
      const url = currentGraphId ? `/api/workflow-graphs/${currentGraphId}` : "/api/workflow-graphs";
      const method = currentGraphId ? "PUT" : "POST";
      const res = await apiRequest(method, url, body);
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentGraphId(data.id);
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  // Publish
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!currentGraphId) throw new Error("Save workflow before publishing");
      const res = await apiRequest("POST", `/api/workflow-graphs/${currentGraphId}/publish`, { changeNotes: "" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow published", description: "A new version has been created." });
    },
    onError: (err: any) => toast({ title: err.message ?? "Failed to publish", variant: "destructive" }),
  });

  const hasErrors = validationResult && !validationResult.valid;
  const hasWarnings = validationResult?.warnings?.length > 0;

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="page-workflow-builder">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 text-primary shrink-0" />
          <Input
            value={graphName}
            onChange={e => { setGraphName(e.target.value); setIsDirty(true); }}
            className="h-7 text-sm font-semibold border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:border-b focus-visible:border-primary rounded-none w-48"
            data-testid="input-graph-name"
          />
          {isDirty && <span className="text-[10px] text-muted-foreground italic">unsaved</span>}
        </div>

        <Select value={graphCategory} onValueChange={v => { setGraphCategory(v); setIsDirty(true); }}>
          <SelectTrigger className="h-7 text-xs w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["custom","onboarding","retention","outreach","scheduling","research","executive"].map(c => (
              <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 ml-auto">
          {/* Validation status */}
          {validationResult && (
            <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${hasErrors ? "bg-red-100 text-red-700" : hasWarnings ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              {hasErrors ? <AlertTriangle className="h-3 w-3" /> : hasWarnings ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
              {hasErrors ? `${validationResult.errors.length} errors` : hasWarnings ? `${validationResult.warnings.length} warnings` : "Valid"}
            </div>
          )}

          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20" onClick={() => setShowNLGenerator(true)} data-testid="button-describe-workflow">
            <Sparkles className="h-3.5 w-3.5" />
            Describe
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowTemplates(true)} data-testid="button-templates">
            <BookTemplate className="h-3.5 w-3.5" />
            Templates
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending} data-testid="button-validate">
            <CheckCircle className="h-3.5 w-3.5" />
            Validate
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => simulateMutation.mutate()} disabled={simulateMutation.isPending} data-testid="button-simulate">
            <Play className="h-3.5 w-3.5" />
            {simulateMutation.isPending ? "Simulating…" : "Simulate"}
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-graph">
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="default" size="sm" className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending || !currentGraphId} data-testid="button-publish-graph">
            <Upload className="h-3.5 w-3.5" />
            Publish
          </Button>
        </div>
      </div>

      {/* ── Main canvas area ── */}
      <div className="flex flex-1 min-h-0">
        {/* Palette sidebar */}
        {showPalette && (
          <div className="w-56 border-r bg-card flex flex-col shrink-0" data-testid="palette-panel">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Node Palette</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowPalette(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-3">
                {NODE_PALETTE.map(category => (
                  <div key={category.label}>
                    <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${category.color}`}>{category.label}</p>
                    <div className="space-y-1">
                      {category.nodes.map(n => (
                        <div
                          key={n.type}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("application/node-type", n.type);
                            e.dataTransfer.setData("application/node-label", n.label);
                            e.dataTransfer.setData("application/node-risk", n.riskLevel);
                            e.dataTransfer.setData("application/node-agent", n.agentType ?? "");
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="flex items-center gap-2 p-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-muted/60 transition-colors text-xs"
                          data-testid={`palette-node-${n.type}`}
                        >
                          <n.icon className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{n.label}</span>
                          <span className={`ml-auto inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                            n.riskLevel === "low" ? "bg-green-500" :
                            n.riskLevel === "medium" ? "bg-amber-500" : "bg-red-500"
                          }`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Governance legend */}
            <div className="border-t p-2 space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Governance Legend</p>
              {[["green","✓ Autonomous"],["amber","⚠ Supervised"],["red","⚠ Approval req."],["violet","🛑 Blocked"]].map(([c, l]) => (
                <div key={c} className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span className={`inline-block h-2 w-2 rounded-full bg-${c}-500`} style={{ backgroundColor: c === "violet" ? "#7c3aed" : undefined }} />
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ReactFlow Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          {!showPalette && (
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 left-2 z-10 h-7 text-xs gap-1"
              onClick={() => setShowPalette(true)}
              data-testid="button-show-palette"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          )}

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center space-y-2">
                <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm font-medium text-muted-foreground/60">Drag nodes from the palette to start building</p>
                <p className="text-xs text-muted-foreground/40">or load a template to get started quickly</p>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={changes => { onEdgesChange(changes); setIsDirty(true); }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            className="bg-dots"
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { strokeWidth: 1.5, stroke: "#94a3b8" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
            <Controls />
            <MiniMap nodeColor={n => {
              const risk = (n.data as any)?.riskLevel ?? "low";
              return RISK_COLORS[risk]?.border ?? "#94a3b8";
            }} className="rounded-lg" />

            {/* Stats panel */}
            <Panel position="bottom-center">
              <div className="flex items-center gap-3 bg-card/90 backdrop-blur border rounded-lg px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <span>{nodes.length} nodes</span>
                <span>·</span>
                <span>{edges.length} edges</span>
                {nodes.some(n => (n.data as any)?.requiresApproval) && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">{nodes.filter(n => (n.data as any)?.requiresApproval).length} approval gate(s)</span>
                  </>
                )}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Validation sidebar — errors/warnings */}
        {validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
          <div className="w-64 border-l bg-card shrink-0" data-testid="validation-panel">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-semibold">Validation</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setValidationResult(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {validationResult.errors.map((e: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    <p className="font-medium">{e.code}</p>
                    <p className="mt-0.5">{e.message}</p>
                  </div>
                ))}
                {validationResult.warnings.map((w: any, i: number) => (
                  <div key={i} className={`p-2 rounded border text-xs ${w.governanceNote ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"}`}>
                    {w.governanceNote && <span className="font-bold text-amber-600">⚠ GOVERNANCE </span>}
                    <p>{w.message}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* ── Panels ── */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onUpdate={handleNodeUpdate}
        />
      )}

      {showTemplates && (
        <Sheet open onOpenChange={open => !open && setShowTemplates(false)}>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle className="text-sm">Workflow Templates</SheetTitle>
              <SheetDescription className="text-xs">Start from a proven template</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <TemplatesPanel onLoad={handleLoadTemplate} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {simulationResult && (
        <SimulationPanel result={simulationResult} onClose={() => setSimulationResult(null)} />
      )}

      <NLWorkflowGenerator
        open={showNLGenerator}
        onClose={() => setShowNLGenerator(false)}
        onLoadDraft={(graph, name) => {
          setNodes(graph.nodes ?? []);
          setEdges(graph.edges ?? []);
          setGraphName(name);
          setIsDirty(true);
          toast({ title: "AI draft loaded", description: "Review the workflow before publishing. Nothing runs until you publish." });
        }}
      />
    </div>
  );
}
