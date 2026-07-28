/**
 * kevin-agent-registry.ts — Central agent registry for Kevin-backed agents.
 *
 * All agent metadata and task permissions are resolved through this registry.
 * Do not hardcode agent behavior throughout the application.
 */

export type AgentExecutionLevel =
  | "observe"       // read-only, no output
  | "recommend"     // can analyze and recommend, cannot act
  | "draft"         // can produce drafts for human review
  | "require_approval" // acts only after explicit human approval
  | "auto";         // fully autonomous (not granted to any agent in Phase 1)

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  executionLevel: AgentExecutionLevel;
  capabilities: string[];
  allowedTaskTypes: string[];
  description: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, AgentDefinition>([
  [
    "retention-agent",
    {
      id: "retention-agent",
      name: "Retention Agent",
      version: "1.0.0",
      enabled: true,
      executionLevel: "recommend",
      capabilities: [
        "evaluate_client_retention_risk",
        "recommend_retention_intervention",
        "draft_retention_message",
      ],
      allowedTaskTypes: ["evaluate_client_retention_risk"],
      description:
        "Analyzes client attendance, engagement, and payment signals to assess retention risk and recommend interventions.",
    },
  ],

  // Placeholders — enabled: false until Phase 2+
  [
    "executive-agent",
    {
      id: "executive-agent",
      name: "Executive Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Strategic executive intelligence agent.",
    },
  ],
  [
    "revenue-agent",
    {
      id: "revenue-agent",
      name: "Revenue Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Revenue optimization and forecasting agent.",
    },
  ],
  [
    "growth-agent",
    {
      id: "growth-agent",
      name: "Growth Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Client acquisition and growth agent.",
    },
  ],
  [
    "scheduling-agent",
    {
      id: "scheduling-agent",
      name: "Scheduling Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Calendar and scheduling intelligence agent.",
    },
  ],
  [
    "client-success-agent",
    {
      id: "client-success-agent",
      name: "Client Success Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Client satisfaction and success agent.",
    },
  ],
  [
    "ceo-agent",
    {
      id: "ceo-agent",
      name: "CEO Agent",
      version: "0.1.0",
      enabled: false,
      executionLevel: "recommend",
      capabilities: [],
      allowedTaskTypes: [],
      description: "Strategic CEO-level intelligence and orchestration agent.",
    },
  ],
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAgent(agentId: string): AgentDefinition | undefined {
  return REGISTRY.get(agentId);
}

export function isAgentEnabled(agentId: string): boolean {
  return REGISTRY.get(agentId)?.enabled === true;
}

export function isTaskTypeAllowed(agentId: string, taskType: string): boolean {
  const agent = REGISTRY.get(agentId);
  return agent?.enabled === true && agent.allowedTaskTypes.includes(taskType);
}

export function getAllAgents(): AgentDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getEnabledAgents(): AgentDefinition[] {
  return getAllAgents().filter((a) => a.enabled);
}
