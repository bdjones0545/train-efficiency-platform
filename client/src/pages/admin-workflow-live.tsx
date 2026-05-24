import { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Panel,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle, XCircle, Clock, AlertTriangle, ShieldAlert,
  RefreshCw, ArrowLeft, Activity, Cpu, User, GitBranch, Zap,
  CircleDot, Play,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Execution state colors ───────────────────────────────────────────────────

const EXEC_STATE_CONFIG: Record<string, { border: string; badge: string; label: string; animate: boolean }> = {
  idle:              { border: "#94a3b8", badge: "bg-gray-100 text-gray-600",    label: "Idle",           animate: false },
  running:           { border: "#3b82f6", badge: "bg-blue-100 text-blue-700",    label: "Running",        animate: true  },
  completed:         { border: "#22c55e", badge: "bg-green-100 text-green-700",  label: "Completed",      animate: false },
  failed:            { border: "#ef4444", badge: "bg-red-100 text-red-700",      label: "Failed",         animate: false },
  waiting_approval:  { border: "#f59e0b", badge: "bg-amber-100 text-amber-700",  label: "Waiting Approval",animate: true  },
  blocked:           { border: "#7c3aed", badge: "bg-violet-100 text-violet-700",label: "Blocked",        animate: false },
  retrying:          { border: "#8b5cf6", badge: "bg-violet-100 text-violet-700",label: "Retrying",       animate: true  },
};

const CATEGORY_COLORS: Record<string, string> = {
  trigger: "#16a34a", agent_action: "#2563eb",
  logic: "#7c3aed", human: "#d97706", outcome: "#0d9488",
};

// ─── Live WorkflowNode ────────────────────────────────────────────────────────

function LiveWorkflowNode({ data, selected }: { data: any; selected: boolean }) {
  const execState = data.executionState ?? "idle";
  const stateConf = EXEC_STATE_CONFIG[execState] ?? EXEC_STATE_CONFIG.idle;
  const categoryColor = CATEGORY_COLORS[data.category] ?? "#6b7280";

  return (
    <div
      className={`rounded-lg border-2 shadow-sm min-w-[160px] max-w-[210px] bg-white dark:bg-slate-900 transition-all ${selected ? "shadow-lg scale-105" : ""} ${stateConf.animate ? "shadow-md" : ""}`}
      style={{
        borderColor: stateConf.border,
        boxShadow: stateConf.animate ? `0 0 12px 2px ${stateConf.border}44` : undefined,
      }}
    >
      <div className="px-2.5 py-1.5 rounded-t-md flex items-center gap-1.5" style={{ backgroundColor: categoryColor }}>
        <span className="text-white text-[10px] font-semibold uppercase tracking-wider truncate">
          {(data.category ?? "node").replace("_", " ")}
        </span>
        {stateConf.animate && (
          <span className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse shrink-0" />
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="text-xs font-semibold leading-tight">{data.label}</p>
        {data.lastAgentType && (
          <div className="flex items-center gap-1 mt-1">
            <Cpu className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{data.lastAgentType.replace("_agent","")}</span>
          </div>
        )}
        {data.executionStartedAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Started {formatDistanceToNow(new Date(data.executionStartedAt), { addSuffix: true })}
          </p>
        )}
        {data.lastError && (
          <p className="text-[10px] text-red-500 mt-0.5 line-clamp-2">{data.lastError}</p>
        )}
      </div>
      <div className="px-2.5 pb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${stateConf.badge}`}>
          {stateConf.animate && <span className="mr-0.5 animate-pulse">●</span>}
          {stateConf.label}
        </span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { workflowNode: LiveWorkflowNode as any };

// ─── Execution Event Log ──────────────────────────────────────────────────────

function EventLogEntry({ event }: { event: any }) {
  const icons: Record<string, typeof CircleDot> = {
    completed: CheckCircle, failed: XCircle, blocked: ShieldAlert,
    waiting_approval: Clock, running: Play, retrying: RefreshCw,
  };
  const Icon = icons[event.status] ?? CircleDot;
  const colors: Record<string, string> = {
    completed: "text-green-500", failed: "text-red-500", blocked: "text-violet-500",
    waiting_approval: "text-amber-500", running: "text-blue-500", retrying: "text-violet-400",
  };
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${colors[event.status] ?? "text-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{event.nodeLabel ?? event.nodeId}</p>
        <p className="text-[10px] text-muted-foreground">{event.summary ?? event.status}</p>
        {event.agentType && (
          <p className="text-[10px] text-muted-foreground">{event.agentType.replace("_agent","")}</p>
        )}
        {event.governanceDecision && event.governanceDecision !== "allowed" && (
          <span className="inline-flex mt-0.5 items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700">
            {event.governanceDecision}
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
        {event.createdAt ? formatDistanceToNow(new Date(event.createdAt), { addSuffix: true }) : "—"}
      </p>
    </div>
  );
}

// ─── Explainability Panel ─────────────────────────────────────────────────────

function ExplainabilityPanel({ node, events }: { node: Node | null; events: any[] }) {
  if (!node) return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
      Click a node to inspect its execution state
    </div>
  );

  const data = node.data as any;
  const nodeEvents = events.filter(e => e.nodeId === node.id);

  return (
    <div className="p-3 space-y-3">
      <div>
        <p className="text-xs font-bold">{data.label}</p>
        <p className="text-[10px] text-muted-foreground">{data.nodeType}</p>
      </div>

      <div className="space-y-1.5 text-xs">
        {data.lastAgentType && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Agent</span>
            <span className="font-medium">{data.lastAgentType.replace("_agent","")}</span>
          </div>
        )}
        {data.executionState && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">State</span>
            <span className={`font-medium ${
              data.executionState === "completed" ? "text-green-600" :
              data.executionState === "failed" ? "text-red-600" :
              data.executionState === "running" ? "text-blue-600" :
              data.executionState === "waiting_approval" ? "text-amber-600" : ""
            }`}>{data.executionState}</span>
          </div>
        )}
        {data.executionStartedAt && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Started</span>
            <span>{format(new Date(data.executionStartedAt), "HH:mm:ss")}</span>
          </div>
        )}
        {data.executionCompletedAt && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Completed</span>
            <span>{format(new Date(data.executionCompletedAt), "HH:mm:ss")}</span>
          </div>
        )}
        {data.riskLevel && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Risk</span>
            <span className={`font-medium ${data.riskLevel === "low" ? "text-green-600" : data.riskLevel === "medium" ? "text-amber-600" : "text-red-600"}`}>
              {data.riskLevel}
            </span>
          </div>
        )}
        {data.requiresApproval && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Approval</span>
            <span className="text-amber-600 font-medium">Required</span>
          </div>
        )}
      </div>

      {data.lastError && (
        <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-[10px] text-red-600 font-medium">Error</p>
          <p className="text-[10px] text-red-500 mt-0.5">{data.lastError}</p>
        </div>
      )}

      {data.governanceNote && (
        <div className="p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-[10px] text-amber-600 font-medium">Governance</p>
          <p className="text-[10px] text-amber-500 mt-0.5">{data.governanceNote}</p>
        </div>
      )}

      {nodeEvents.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Node History</p>
          {nodeEvents.slice(0, 5).map((e, i) => (
            <div key={i} className="text-[10px] py-1 border-b border-border/40 last:border-0">
              <span className={`font-medium ${e.status === "success" ? "text-green-600" : e.status === "failed" ? "text-red-600" : "text-muted-foreground"}`}>{e.status}</span>
              {e.createdAt && <span className="text-muted-foreground ml-2">{format(new Date(e.createdAt), "HH:mm:ss")}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Live Execution Page ─────────────────────────────────────────────────

export default function AdminWorkflowLivePage() {
  const params = useParams<{ id: string }>();
  const graphId = params.id;
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [executionEvents, setExecutionEvents] = useState<any[]>([]);

  const { data: graph, isLoading } = useQuery<any>({
    queryKey: ["/api/workflow-graphs", graphId],
    enabled: !!graphId,
    refetchInterval: 5000,
  });

  const { data: liveData, refetch: refetchLive } = useQuery<any>({
    queryKey: ["/api/workflow-graphs", graphId, "live"],
    enabled: !!graphId,
    refetchInterval: 3000,
  });

  // Load and overlay execution states onto nodes
  useEffect(() => {
    if (!graph?.graphDefinition) return;
    const baseNodes: Node[] = graph.graphDefinition.nodes ?? [];
    const baseEdges: Edge[] = graph.graphDefinition.edges ?? [];

    // Overlay live execution state
    const executionStates: Record<string, any> = liveData?.nodeStates ?? {};
    const overlaid = baseNodes.map((n: Node) => ({
      ...n,
      data: {
        ...n.data,
        ...(executionStates[n.id] ?? {}),
      },
    }));

    setNodes(overlaid);
    setEdges(baseEdges.map((e: Edge) => ({
      ...e,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        strokeWidth: 1.5,
        stroke: executionStates[e.source]?.executionState === "completed" ? "#22c55e" : "#94a3b8",
      },
      animated: executionStates[e.source]?.executionState === "running",
    })));

    if (liveData?.events) setExecutionEvents(liveData.events);
  }, [graph, liveData, setNodes, setEdges]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Summary stats from live data
  const completedCount = nodes.filter(n => (n.data as any)?.executionState === "completed").length;
  const runningCount = nodes.filter(n => (n.data as any)?.executionState === "running").length;
  const failedCount = nodes.filter(n => (n.data as any)?.executionState === "failed").length;
  const waitingCount = nodes.filter(n => (n.data as any)?.executionState === "waiting_approval").length;
  const overallStatus = liveData?.status ?? "idle";

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[600px] rounded-xl" />
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Workflow not found</p>
        <Link href="/admin/workflows"><Button variant="outline" size="sm" className="mt-3">Back to Workflows</Button></Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="page-workflow-live">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm shrink-0">
        <Link href="/admin/workflows">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Workflows
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{graph.name}</span>
          <Badge variant="secondary" className="text-[10px]">Live</Badge>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 ml-4">
          {completedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
              <CheckCircle className="h-3 w-3" />{completedCount} done
            </span>
          )}
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
              <span className="animate-pulse">●</span>{runningCount} running
            </span>
          )}
          {waitingCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
              <Clock className="h-3 w-3" />{waitingCount} waiting
            </span>
          )}
          {failedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
              <XCircle className="h-3 w-3" />{failedCount} failed
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetchLive()} data-testid="button-refresh-live">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Link href={`/admin/workflow-builder?graphId=${graphId}`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-edit-graph">
              Edit Workflow
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative">
          {nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No nodes in this workflow</p>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={true}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
              <Controls showInteractive={false} />
              <MiniMap nodeColor={n => {
                const state = (n.data as any)?.executionState ?? "idle";
                return EXEC_STATE_CONFIG[state]?.border ?? "#94a3b8";
              }} className="rounded-lg" />

              <Panel position="bottom-center">
                <div className="flex items-center gap-3 bg-card/90 backdrop-blur border rounded-lg px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                  <span className={`font-medium ${overallStatus === "running" ? "text-blue-600" : overallStatus === "completed" ? "text-green-600" : overallStatus === "failed" ? "text-red-600" : ""}`}>
                    {overallStatus === "running" && <span className="animate-pulse mr-1">●</span>}
                    {overallStatus}
                  </span>
                  <span>·</span>
                  <span>{nodes.length} nodes</span>
                  {liveData?.startedAt && (
                    <>
                      <span>·</span>
                      <span>Started {formatDistanceToNow(new Date(liveData.startedAt), { addSuffix: true })}</span>
                    </>
                  )}
                </div>
              </Panel>

              {/* State legend */}
              <Panel position="top-right">
                <div className="bg-card/90 backdrop-blur border rounded-lg p-2 space-y-1 shadow-sm">
                  {Object.entries(EXEC_STATE_CONFIG).filter(([k]) => ["running","completed","failed","waiting_approval","blocked"].includes(k)).map(([state, conf]) => (
                    <div key={state} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: conf.border }} />
                      {conf.label}
                    </div>
                  ))}
                </div>
              </Panel>
            </ReactFlow>
          )}
        </div>

        {/* Right panel — explainability + event log */}
        <div className="w-72 border-l bg-card flex flex-col shrink-0">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-semibold">Execution Inspector</p>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <ExplainabilityPanel node={selectedNode} events={executionEvents} />
          </div>

          <Separator />

          <div className="border-t">
            <div className="px-3 py-2 border-b">
              <p className="text-xs font-semibold">Event Log</p>
            </div>
            <ScrollArea className="h-48">
              <div className="px-3 py-1">
                {executionEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No events yet</p>
                ) : (
                  executionEvents.slice(0, 20).map((e, i) => <EventLogEntry key={i} event={e} />)
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
