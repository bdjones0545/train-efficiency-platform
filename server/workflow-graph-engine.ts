/**
 * Workflow Graph Engine — Phase 6
 *
 * Serializes, validates, compiles, and simulates visual workflow graphs
 * built in the Workflow Builder UI.
 *
 * NO autonomous execution happens here — this engine produces compiled
 * workflow definitions that are passed to the governed workflow-job-queue.
 */

import { randomUUID } from "crypto";

// ─── Graph Node Types ─────────────────────────────────────────────────────────

export type NodeCategory = "trigger" | "agent_action" | "logic" | "human" | "outcome";

export type TriggerNodeType =
  | "schedule_trigger" | "webhook_trigger" | "gmail_reply_trigger"
  | "meta_lead_trigger" | "payment_failed_trigger" | "booking_cancelled_trigger"
  | "workflow_completed_trigger" | "manual_trigger";

export type AgentActionNodeType =
  | "send_email" | "generate_recommendation" | "summarize_thread"
  | "research_lead" | "generate_report" | "classify_reply"
  | "create_booking" | "post_slack_alert";

export type LogicNodeType =
  | "if_else" | "confidence_threshold" | "risk_evaluation"
  | "approval_required" | "wait_delay" | "rate_limit_gate"
  | "retry_policy" | "branch_routing";

export type HumanNodeType =
  | "approval_gate" | "manual_review" | "assign_operator" | "escalate_admin";

export type OutcomeNodeType =
  | "workflow_completed" | "workflow_failed" | "workflow_escalated"
  | "client_retained" | "client_converted" | "session_booked";

export type AnyNodeType =
  | TriggerNodeType | AgentActionNodeType | LogicNodeType | HumanNodeType | OutcomeNodeType;

// ─── Graph Data Structures ────────────────────────────────────────────────────

export interface GraphNodeData {
  label: string;
  nodeType: AnyNodeType;
  category: NodeCategory;
  config: Record<string, any>; // node-specific configuration
  agentType?: string;
  integrationTypes?: string[];
  riskLevel?: "low" | "medium" | "high" | "critical";
  requiresApproval?: boolean;
  governanceNote?: string;
  estimatedDurationMs?: number;
  estimatedCostCents?: number;
  // Runtime state (not persisted in graph definition, used for live view)
  executionState?: "idle" | "running" | "completed" | "failed" | "waiting_approval" | "blocked" | "retrying";
  executionStartedAt?: string;
  executionCompletedAt?: string;
  lastAgentType?: string;
  lastError?: string;
}

export interface GraphNode {
  id: string;
  type: "workflowNode"; // ReactFlow node type
  position: { x: number; y: number };
  data: GraphNodeData;
  width?: number;
  height?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // for branching (true/false, etc.)
  targetHandle?: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowGraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: GraphViewport;
}

// ─── Compiled Definition ──────────────────────────────────────────────────────

export interface CompiledStep {
  stepId: string;
  nodeId: string;
  nodeType: AnyNodeType;
  category: NodeCategory;
  agentType?: string;
  config: Record<string, any>;
  nextSteps: Array<{ stepId: string; condition?: string }>;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  estimatedDurationMs: number;
  estimatedCostCents: number;
}

export interface CompiledWorkflowGraph {
  compiledAt: string;
  version: string;
  entryStepId: string;
  steps: Record<string, CompiledStep>;
  executionOrder: string[]; // topological sort
  complexity: number;
  estimatedDurationMs: number;
  estimatedCostCents: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  governanceWarnings: string[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  nodeId?: string;
  code: string;
  message: string;
  governanceNote?: boolean;
}

export function validateWorkflowGraph(graph: WorkflowGraphDefinition): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const { nodes, edges } = graph;

  // 1. Must have at least one trigger node
  const triggerNodes = nodes.filter(n => n.data.category === "trigger");
  if (triggerNodes.length === 0) {
    errors.push({ code: "NO_TRIGGER", message: "Workflow must have at least one trigger node." });
  }
  if (triggerNodes.length > 1) {
    warnings.push({ code: "MULTIPLE_TRIGGERS", message: "Workflow has multiple triggers — only the first will fire by default." });
  }

  // 2. Must have at least one outcome node
  const outcomeNodes = nodes.filter(n => n.data.category === "outcome");
  if (outcomeNodes.length === 0) {
    errors.push({ code: "NO_OUTCOME", message: "Workflow must have at least one outcome node." });
  }

  // 3. All nodes (except outcomes) must have at least one outgoing edge
  const nodeIds = new Set(nodes.map(n => n.id));
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));

  for (const node of nodes) {
    if (node.data.category === "outcome") continue;
    if (!sourceIds.has(node.id)) {
      errors.push({ nodeId: node.id, code: "DISCONNECTED_NODE", message: `Node "${node.data.label}" has no outgoing connections.` });
    }
  }

  // 4. All edges must reference existing nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ edgeId: edge.id, code: "INVALID_EDGE_SOURCE", message: `Edge references non-existent source node: ${edge.source}` });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ edgeId: edge.id, code: "INVALID_EDGE_TARGET", message: `Edge references non-existent target node: ${edge.target}` });
    }
  }

  // 5. Cycle detection (DFS)
  const cycles = detectCycles(nodes, edges);
  for (const cycle of cycles) {
    errors.push({ code: "CYCLE_DETECTED", message: `Infinite loop detected in path: ${cycle.join(" → ")}` });
  }

  // 6. IF/ELSE nodes must have exactly 2 outgoing edges (true/false branches)
  const ifElseNodes = nodes.filter(n => n.data.nodeType === "if_else");
  for (const node of ifElseNodes) {
    const outgoing = edges.filter(e => e.source === node.id);
    if (outgoing.length < 2) {
      errors.push({ nodeId: node.id, code: "IF_ELSE_MISSING_BRANCH", message: `IF/ELSE node "${node.data.label}" must have both true and false branches.` });
    }
  }

  // 7. Governance warnings
  for (const node of nodes) {
    if (node.data.riskLevel === "high" || node.data.riskLevel === "critical") {
      warnings.push({
        nodeId: node.id,
        code: "HIGH_RISK_NODE",
        message: `Node "${node.data.label}" is rated ${node.data.riskLevel} risk and may require approval.`,
        governanceNote: true,
      });
    }
    if (node.data.nodeType === "send_email" && !node.data.requiresApproval) {
      warnings.push({
        nodeId: node.id,
        code: "UNGUARDED_COMMUNICATION",
        message: `"${node.data.label}" sends email without approval gate — this may be blocked by governance policy.`,
        governanceNote: true,
      });
    }
    if (node.data.nodeType === "research_lead") {
      warnings.push({
        nodeId: node.id,
        code: "WEB_ACCESS_REQUIRED",
        message: `"${node.data.label}" requires Research Agent web access — confirm governance allows external browsing.`,
        governanceNote: true,
      });
    }
  }

  // 8. Orphan nodes (not reachable from any trigger)
  const reachable = getReachableNodes(triggerNodes.map(n => n.id), edges);
  for (const node of nodes) {
    if (!reachable.has(node.id) && node.data.category !== "trigger") {
      warnings.push({ nodeId: node.id, code: "ORPHAN_NODE", message: `Node "${node.data.label}" is not reachable from any trigger.` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Compilation ──────────────────────────────────────────────────────────────

export function compileWorkflowGraph(
  graph: WorkflowGraphDefinition,
  orgId: string,
): CompiledWorkflowGraph | null {
  const validation = validateWorkflowGraph(graph);
  if (!validation.valid) return null;

  const { nodes, edges } = graph;
  const steps: Record<string, CompiledStep> = {};

  // Build adjacency list
  const adjList: Record<string, Array<{ nodeId: string; condition?: string }>> = {};
  for (const edge of edges) {
    if (!adjList[edge.source]) adjList[edge.source] = [];
    adjList[edge.source].push({ nodeId: edge.target, condition: edge.label });
  }

  // Topological sort
  const order = topologicalSort(nodes, edges);

  // Build compiled steps
  let totalDurationMs = 0;
  let totalCostCents = 0;
  let maxRisk: "low" | "medium" | "high" | "critical" = "low";
  let requiresApproval = false;
  const governanceWarnings: string[] = validation.warnings.filter(w => w.governanceNote).map(w => w.message);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const nextSteps = (adjList[nodeId] ?? []).map(next => ({
      stepId: next.nodeId,
      condition: next.condition,
    }));

    const risk = node.data.riskLevel ?? "low";
    const durationMs = node.data.estimatedDurationMs ?? estimateNodeDuration(node.data.nodeType);
    const costCents = node.data.estimatedCostCents ?? estimateNodeCost(node.data.nodeType);
    const needsApproval = node.data.requiresApproval ?? isApprovalRequired(node.data.nodeType, node.data.riskLevel);

    totalDurationMs += durationMs;
    totalCostCents += costCents;
    if (riskRank(risk) > riskRank(maxRisk)) maxRisk = risk;
    if (needsApproval) requiresApproval = true;

    steps[nodeId] = {
      stepId: nodeId,
      nodeId,
      nodeType: node.data.nodeType,
      category: node.data.category,
      agentType: node.data.agentType,
      config: node.data.config ?? {},
      nextSteps,
      riskLevel: risk,
      requiresApproval: needsApproval,
      estimatedDurationMs: durationMs,
      estimatedCostCents: costCents,
    };
  }

  // Entry point = first trigger node
  const triggerNode = nodes.find(n => n.data.category === "trigger");

  return {
    compiledAt: new Date().toISOString(),
    version: "1.0",
    entryStepId: triggerNode?.id ?? order[0],
    steps,
    executionOrder: order,
    complexity: calculateComplexity(nodes, edges),
    estimatedDurationMs: totalDurationMs,
    estimatedCostCents: totalCostCents,
    riskLevel: maxRisk,
    requiresApproval,
    governanceWarnings,
  };
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export interface SimulationStep {
  stepId: string;
  nodeType: AnyNodeType;
  category: NodeCategory;
  agentType?: string;
  action: string;
  expectedOutcome: string;
  estimatedDurationMs: number;
  estimatedCostCents: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  governanceDecision: "allowed" | "blocked" | "approval_required";
  governanceReason?: string;
  branchTaken?: string;
  confidence?: number;
}

export interface SimulationResult {
  ok: boolean;
  simulatedAt: string;
  totalSteps: number;
  expectedPath: SimulationStep[];
  estimatedDurationMs: number;
  estimatedCostCents: number;
  approvalCount: number;
  blockedCount: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  governanceWarnings: string[];
  potentialDeadlocks: string[];
  apiCallEstimates: Record<string, number>;
  error?: string;
}

export async function simulateWorkflowExecution(
  graph: WorkflowGraphDefinition,
  orgId: string,
  simulationOptions?: {
    simulateFailures?: boolean;
    simulateApprovalDelays?: boolean;
    simulateGovernanceBlocks?: boolean;
    branchOverrides?: Record<string, string>; // nodeId → branch label
  },
): Promise<SimulationResult> {
  const compiled = compileWorkflowGraph(graph, orgId);
  if (!compiled) {
    const validation = validateWorkflowGraph(graph);
    return {
      ok: false,
      simulatedAt: new Date().toISOString(),
      totalSteps: 0,
      expectedPath: [],
      estimatedDurationMs: 0,
      estimatedCostCents: 0,
      approvalCount: 0,
      blockedCount: 0,
      riskLevel: "low",
      governanceWarnings: [],
      potentialDeadlocks: [],
      apiCallEstimates: {},
      error: validation.errors.map(e => e.message).join("; "),
    };
  }

  const expectedPath: SimulationStep[] = [];
  const apiCallEstimates: Record<string, number> = {};
  let approvalCount = 0;
  let blockedCount = 0;

  // Simulate path traversal
  const visited = new Set<string>();
  let currentStepId = compiled.entryStepId;
  let safetyCounter = 0;

  while (currentStepId && safetyCounter < 50) {
    safetyCounter++;
    if (visited.has(currentStepId)) break; // cycle guard
    visited.add(currentStepId);

    const step = compiled.steps[currentStepId];
    if (!step) break;

    // Determine governance decision
    let governanceDecision: "allowed" | "blocked" | "approval_required" = "allowed";
    let governanceReason: string | undefined;

    if (step.requiresApproval) {
      governanceDecision = "approval_required";
      governanceReason = "Node requires operator approval before execution";
      approvalCount++;
    }

    if (simulationOptions?.simulateGovernanceBlocks && step.riskLevel === "critical") {
      governanceDecision = "blocked";
      governanceReason = "Critical risk level blocked by governance policy";
      blockedCount++;
    }

    // Track API usage
    const integration = getNodeIntegration(step.nodeType);
    if (integration) {
      apiCallEstimates[integration] = (apiCallEstimates[integration] ?? 0) + 1;
    }

    const simStep: SimulationStep = {
      stepId: step.stepId,
      nodeType: step.nodeType,
      category: step.category,
      agentType: step.agentType,
      action: describeNodeAction(step.nodeType, step.config),
      expectedOutcome: describeNodeOutcome(step.nodeType),
      estimatedDurationMs: step.estimatedDurationMs,
      estimatedCostCents: step.estimatedCostCents,
      riskLevel: step.riskLevel,
      requiresApproval: step.requiresApproval,
      governanceDecision,
      governanceReason,
      confidence: 0.85,
    };

    // Branch selection
    if (step.nextSteps.length > 1) {
      const override = simulationOptions?.branchOverrides?.[currentStepId];
      const selectedBranch = step.nextSteps.find(s => s.condition === override) ?? step.nextSteps[0];
      simStep.branchTaken = selectedBranch.condition ?? "default";
      currentStepId = selectedBranch.stepId;
    } else if (step.nextSteps.length === 1) {
      currentStepId = step.nextSteps[0].stepId;
    } else {
      currentStepId = ""; // terminal
    }

    expectedPath.push(simStep);

    if (governanceDecision === "blocked") break; // stop at governance block
  }

  // Detect potential deadlocks (approval gates with no timeout)
  const potentialDeadlocks: string[] = [];
  for (const step of expectedPath) {
    if (step.governanceDecision === "approval_required" && !step.config?.timeout) {
      potentialDeadlocks.push(`Step "${step.action}" may wait indefinitely if approval is not granted.`);
    }
  }

  return {
    ok: true,
    simulatedAt: new Date().toISOString(),
    totalSteps: expectedPath.length,
    expectedPath,
    estimatedDurationMs: compiled.estimatedDurationMs,
    estimatedCostCents: compiled.estimatedCostCents,
    approvalCount,
    blockedCount,
    riskLevel: compiled.riskLevel,
    governanceWarnings: compiled.governanceWarnings,
    potentialDeadlocks,
    apiCallEstimates,
  };
}

// ─── Complexity + Risk ────────────────────────────────────────────────────────

export function calculateWorkflowComplexity(graph: WorkflowGraphDefinition): number {
  return calculateComplexity(graph.nodes, graph.edges);
}

function calculateComplexity(nodes: GraphNode[], edges: GraphEdge[]): number {
  const branchingNodes = nodes.filter(n =>
    n.data.nodeType === "if_else" || n.data.nodeType === "branch_routing" || n.data.nodeType === "confidence_threshold"
  ).length;
  const approvalNodes = nodes.filter(n => n.data.category === "human").length;
  const baseScore = nodes.length;
  const edgeScore = Math.round(edges.length * 0.5);
  return baseScore + edgeScore + branchingNodes * 3 + approvalNodes * 2;
}

export function estimateExecutionRisk(graph: WorkflowGraphDefinition): "low" | "medium" | "high" | "critical" {
  const { nodes } = graph;
  let maxRisk: "low" | "medium" | "high" | "critical" = "low";
  for (const node of nodes) {
    const r = node.data.riskLevel ?? deriveNodeRisk(node.data.nodeType);
    if (riskRank(r) > riskRank(maxRisk)) maxRisk = r;
  }
  return maxRisk;
}

export function traceWorkflowPath(
  graph: WorkflowGraphDefinition,
  fromNodeId: string,
  toNodeId: string,
): string[] {
  const { edges } = graph;
  const adj: Record<string, string[]> = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  // BFS
  const queue: string[][] = [[fromNodeId]];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    if (node === toNodeId) return path;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adj[node] ?? []) {
      queue.push([...path, next]);
    }
  }
  return [];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function detectCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adj: Record<string, string[]> = {};
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string) {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);
    for (const next of adj[nodeId] ?? []) {
      if (!visited.has(next)) dfs(next);
      else if (inStack.has(next)) {
        const cycleStart = path.indexOf(next);
        cycles.push(path.slice(cycleStart).map(id => nodeMap.get(id)?.data.label ?? id));
      }
    }
    path.pop();
    inStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id);
  }

  return cycles;
}

function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};

  for (const n of nodes) {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  }
  for (const e of edges) {
    adj[e.source].push(e.target);
    inDegree[e.target] = (inDegree[e.target] ?? 0) + 1;
  }

  const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  const result: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj[id] ?? []) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  return result;
}

function getReachableNodes(startIds: string[], edges: GraphEdge[]): Set<string> {
  const adj: Record<string, string[]> = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const reachable = new Set<string>(startIds);
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj[id] ?? []) {
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  return reachable;
}

function riskRank(r: string): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[r] ?? 0;
}

function deriveNodeRisk(nodeType: AnyNodeType): "low" | "medium" | "high" | "critical" {
  const highRisk = ["send_email", "post_slack_alert", "create_booking", "research_lead"];
  const mediumRisk = ["generate_report", "classify_reply", "generate_recommendation", "summarize_thread"];
  if (highRisk.includes(nodeType)) return "high";
  if (mediumRisk.includes(nodeType)) return "medium";
  return "low";
}

function estimateNodeDuration(nodeType: AnyNodeType): number {
  const durations: Partial<Record<AnyNodeType, number>> = {
    send_email: 3000, post_slack_alert: 1000, research_lead: 30000,
    generate_report: 15000, classify_reply: 3000, summarize_thread: 5000,
    create_booking: 5000, approval_gate: 86400000, wait_delay: 60000,
    if_else: 100, confidence_threshold: 200,
  };
  return durations[nodeType] ?? 2000;
}

function estimateNodeCost(nodeType: AnyNodeType): number {
  const costs: Partial<Record<AnyNodeType, number>> = {
    send_email: 1, post_slack_alert: 0, research_lead: 15,
    generate_report: 10, classify_reply: 2, summarize_thread: 3,
    generate_recommendation: 5,
  };
  return costs[nodeType] ?? 0;
}

function isApprovalRequired(nodeType: AnyNodeType, riskLevel?: string): boolean {
  if (riskLevel === "critical" || riskLevel === "high") return true;
  const requiresApproval: AnyNodeType[] = ["approval_gate", "manual_review", "escalate_admin"];
  return requiresApproval.includes(nodeType);
}

function getNodeIntegration(nodeType: AnyNodeType): string | null {
  const map: Partial<Record<AnyNodeType, string>> = {
    send_email: "gmail", post_slack_alert: "slack", create_booking: "google_calendar",
    research_lead: "research_agent", generate_report: "openrouter",
    classify_reply: "openrouter", summarize_thread: "openrouter",
    generate_recommendation: "openrouter",
  };
  return map[nodeType] ?? null;
}

function describeNodeAction(nodeType: AnyNodeType, config: Record<string, any>): string {
  const labels: Partial<Record<AnyNodeType, string>> = {
    schedule_trigger: "Trigger on schedule", manual_trigger: "Manual trigger",
    gmail_reply_trigger: "Trigger on Gmail reply", webhook_trigger: "Trigger on webhook",
    send_email: `Send email${config.subject ? ` — "${config.subject}"` : ""}`,
    post_slack_alert: `Post Slack alert${config.channel ? ` to ${config.channel}` : ""}`,
    research_lead: "Research lead via web",
    generate_report: "Generate AI report",
    classify_reply: "Classify email reply",
    summarize_thread: "Summarize email thread",
    create_booking: "Create calendar booking",
    generate_recommendation: "Generate AI recommendation",
    if_else: `Branch on: ${config.condition ?? "condition"}`,
    confidence_threshold: `Confidence gate (min: ${config.threshold ?? "0.8"})`,
    approval_gate: "Wait for operator approval",
    wait_delay: `Wait ${config.delayMs ? `${config.delayMs / 60000}min` : "delay"}`,
    workflow_completed: "Workflow completed ✓",
    workflow_failed: "Workflow failed ✗",
    workflow_escalated: "Escalated to operator",
    client_retained: "Client retained",
    client_converted: "Client converted",
    session_booked: "Session booked",
  };
  return labels[nodeType] ?? nodeType.replace(/_/g, " ");
}

function describeNodeOutcome(nodeType: AnyNodeType): string {
  const outcomes: Partial<Record<AnyNodeType, string>> = {
    send_email: "Email delivered to recipient",
    post_slack_alert: "Alert posted to Slack channel",
    research_lead: "Contact information discovered",
    generate_report: "Report generated and stored",
    classify_reply: "Reply classified with intent + sentiment",
    summarize_thread: "Thread summarized",
    create_booking: "Calendar event created",
    if_else: "Branches to next node based on condition",
    approval_gate: "Pauses until human approves",
    workflow_completed: "Workflow ends successfully",
  };
  return outcomes[nodeType] ?? "Step completes";
}

// ─── Built-in workflow templates ──────────────────────────────────────────────

export const BUILT_IN_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  graphDefinition: WorkflowGraphDefinition;
}> = [
  {
    id: "tpl-onboarding",
    name: "Client Onboarding",
    description: "Welcome new clients with personalized outreach and booking setup.",
    category: "onboarding",
    riskLevel: "medium",
    graphDefinition: buildTemplate_Onboarding(),
  },
  {
    id: "tpl-retention",
    name: "Retention Campaign",
    description: "Re-engage at-risk clients before they churn.",
    category: "retention",
    riskLevel: "medium",
    graphDefinition: buildTemplate_Retention(),
  },
  {
    id: "tpl-lead-qualification",
    name: "Lead Qualification",
    description: "Research and qualify inbound team training leads.",
    category: "outreach",
    riskLevel: "high",
    graphDefinition: buildTemplate_LeadQualification(),
  },
  {
    id: "tpl-executive-summary",
    name: "Daily Executive Summary",
    description: "Generate and distribute daily business intelligence briefing.",
    category: "executive",
    riskLevel: "low",
    graphDefinition: buildTemplate_ExecutiveSummary(),
  },
  {
    id: "tpl-churn-recovery",
    name: "Churn Recovery",
    description: "Multi-step recovery campaign for lapsed clients.",
    category: "retention",
    riskLevel: "medium",
    graphDefinition: buildTemplate_ChurnRecovery(),
  },
];

function makeNode(id: string, type: AnyNodeType, label: string, x: number, y: number, extra?: Partial<GraphNodeData>): GraphNode {
  return {
    id,
    type: "workflowNode",
    position: { x, y },
    data: {
      label,
      nodeType: type,
      category: getCategoryForType(type),
      config: {},
      ...extra,
    },
  };
}

function makeEdge(id: string, source: string, target: string, label?: string): GraphEdge {
  return { id, source, target, label, animated: false };
}

function getCategoryForType(t: AnyNodeType): NodeCategory {
  const triggers: AnyNodeType[] = ["schedule_trigger","webhook_trigger","gmail_reply_trigger","meta_lead_trigger","payment_failed_trigger","booking_cancelled_trigger","workflow_completed_trigger","manual_trigger"];
  const actions: AnyNodeType[] = ["send_email","generate_recommendation","summarize_thread","research_lead","generate_report","classify_reply","create_booking","post_slack_alert"];
  const logic: AnyNodeType[] = ["if_else","confidence_threshold","risk_evaluation","approval_required","wait_delay","rate_limit_gate","retry_policy","branch_routing"];
  const human: AnyNodeType[] = ["approval_gate","manual_review","assign_operator","escalate_admin"];
  if (triggers.includes(t)) return "trigger";
  if (actions.includes(t)) return "agent_action";
  if (logic.includes(t)) return "logic";
  if (human.includes(t)) return "human";
  return "outcome";
}

function buildTemplate_Onboarding(): WorkflowGraphDefinition {
  return {
    nodes: [
      makeNode("n1","manual_trigger","New Client Trigger",100,100),
      makeNode("n2","send_email","Welcome Email",100,220,{agentType:"communication_agent",riskLevel:"high",requiresApproval:false}),
      makeNode("n3","wait_delay","Wait 24hrs",100,340,{config:{delayMs:86400000}}),
      makeNode("n4","generate_recommendation","Build Onboarding Plan",100,460,{agentType:"system_agent"}),
      makeNode("n5","create_booking","Schedule First Session",100,580,{agentType:"scheduling_agent",riskLevel:"medium"}),
      makeNode("n6","session_booked","Session Booked ✓",100,700),
    ],
    edges: [
      makeEdge("e1","n1","n2"),makeEdge("e2","n2","n3"),makeEdge("e3","n3","n4"),
      makeEdge("e4","n4","n5"),makeEdge("e5","n5","n6"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function buildTemplate_Retention(): WorkflowGraphDefinition {
  return {
    nodes: [
      makeNode("n1","schedule_trigger","Weekly Trigger",100,100,{config:{cron:"0 9 * * 1"}}),
      makeNode("n2","generate_recommendation","Identify At-Risk Clients",100,220,{agentType:"retention_agent"}),
      makeNode("n3","if_else","At-Risk Found?",100,340),
      makeNode("n4","send_email","Re-Engagement Email",250,460,{agentType:"communication_agent",riskLevel:"high"}),
      makeNode("n5","workflow_completed","No At-Risk Clients",450,460),
      makeNode("n6","wait_delay","Wait 3 Days",250,580,{config:{delayMs:259200000}}),
      makeNode("n7","classify_reply","Classify Response",250,700,{agentType:"communication_agent"}),
      makeNode("n8","if_else","Responded?",250,820),
      makeNode("n9","client_retained","Client Re-Engaged",100,940),
      makeNode("n10","approval_gate","Escalate to Coach",400,940,{riskLevel:"medium"}),
    ],
    edges: [
      makeEdge("e1","n1","n2"),makeEdge("e2","n2","n3"),
      makeEdge("e3","n3","n4","yes"),makeEdge("e4","n3","n5","no"),
      makeEdge("e5","n4","n6"),makeEdge("e6","n6","n7"),makeEdge("e7","n7","n8"),
      makeEdge("e8","n8","n9","yes"),makeEdge("e9","n8","n10","no"),
    ],
    viewport: { x: 0, y: 0, zoom: 0.8 },
  };
}

function buildTemplate_LeadQualification(): WorkflowGraphDefinition {
  return {
    nodes: [
      makeNode("n1","meta_lead_trigger","New Lead Trigger",100,100),
      makeNode("n2","research_lead","Research Lead",100,220,{agentType:"research_agent",riskLevel:"high"}),
      makeNode("n3","confidence_threshold","Confidence Gate",100,340,{config:{threshold:0.7}}),
      makeNode("n4","send_email","Outreach Email",100,460,{agentType:"communication_agent",riskLevel:"high",requiresApproval:true}),
      makeNode("n5","manual_review","Manual Review Required",350,460,{riskLevel:"medium"}),
      makeNode("n6","wait_delay","Wait 48hrs",100,580,{config:{delayMs:172800000}}),
      makeNode("n7","classify_reply","Classify Reply",100,700,{agentType:"communication_agent"}),
      makeNode("n8","client_converted","Lead Qualified ✓",100,820),
    ],
    edges: [
      makeEdge("e1","n1","n2"),makeEdge("e2","n2","n3"),
      makeEdge("e3","n3","n4","≥threshold"),makeEdge("e4","n3","n5","<threshold"),
      makeEdge("e5","n4","n6"),makeEdge("e6","n6","n7"),makeEdge("e7","n7","n8"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function buildTemplate_ExecutiveSummary(): WorkflowGraphDefinition {
  return {
    nodes: [
      makeNode("n1","schedule_trigger","Daily 7am Trigger",100,100,{config:{cron:"0 7 * * *"}}),
      makeNode("n2","generate_report","Generate Business Report",100,220,{agentType:"executive_agent",riskLevel:"low"}),
      makeNode("n3","post_slack_alert","Post to Slack",100,340,{agentType:"executive_agent",riskLevel:"low",config:{channel:"#leadership"}}),
      makeNode("n4","workflow_completed","Summary Sent ✓",100,460),
    ],
    edges: [
      makeEdge("e1","n1","n2"),makeEdge("e2","n2","n3"),makeEdge("e3","n3","n4"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function buildTemplate_ChurnRecovery(): WorkflowGraphDefinition {
  return {
    nodes: [
      makeNode("n1","booking_cancelled_trigger","Booking Cancelled",100,100),
      makeNode("n2","wait_delay","Wait 2 Days",100,220,{config:{delayMs:172800000}}),
      makeNode("n3","generate_recommendation","Generate Win-Back Offer",100,340,{agentType:"retention_agent"}),
      makeNode("n4","approval_gate","Coach Approval",100,460,{requiresApproval:true}),
      makeNode("n5","send_email","Send Win-Back Email",100,580,{agentType:"communication_agent",riskLevel:"high"}),
      makeNode("n6","wait_delay","Wait 7 Days",100,700,{config:{delayMs:604800000}}),
      makeNode("n7","if_else","Responded?",100,820),
      makeNode("n8","client_retained","Client Recovered ✓",0,940),
      makeNode("n9","workflow_failed","Lost Client",200,940),
    ],
    edges: [
      makeEdge("e1","n1","n2"),makeEdge("e2","n2","n3"),makeEdge("e3","n3","n4"),
      makeEdge("e4","n4","n5"),makeEdge("e5","n5","n6"),makeEdge("e6","n6","n7"),
      makeEdge("e7","n7","n8","yes"),makeEdge("e8","n7","n9","no"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
