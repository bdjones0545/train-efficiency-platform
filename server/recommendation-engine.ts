/**
 * Recommendation Engine — Phase 7
 *
 * Analyzes org state (integrations, workflows, agents, governance) and
 * generates actionable, explainable recommendations for operators.
 *
 * All recommendations are non-autonomous — operators must act on them.
 */

import type { IStorage } from "./storage";

export interface Recommendation {
  id: string;
  type: "workflow" | "integration" | "governance" | "approval" | "agent" | "automation";
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  impact: string;
  actionLabel?: string;
  actionUrl?: string;
}

export async function generateRecommendations(
  orgId: string,
  storage: IStorage,
): Promise<Recommendation[]> {
  const recs: Recommendation[] = [];

  try {
    // Load org state
    const [integrations, graphs, agents] = await Promise.all([
      storage.getExternalIntegrations(orgId).catch(() => []),
      storage.getWorkflowGraphs(orgId).catch(() => []),
      storage.getWorkflowJobs(orgId, undefined, 20).catch(() => []),
    ]);

    const connectedIntegrationTypes = new Set(
      integrations.filter((i: any) => i.status === "connected").map((i: any) => i.integrationType)
    );
    const publishedWorkflows = graphs.filter((g: any) => g.published);
    const draftWorkflows = graphs.filter((g: any) => !g.published && (g.graphDefinition as any)?.nodes?.length > 0);

    // ─── Integration gaps ─────────────────────────────────────────────────────

    if (connectedIntegrationTypes.has("gmail") && !publishedWorkflows.some((w: any) => w.category === "outreach" || w.category === "retention")) {
      recs.push({
        id: "rec-gmail-no-workflow",
        type: "workflow",
        priority: "high",
        title: "Gmail connected but no email workflows active",
        reason: "You've connected Gmail but don't have any published outreach or retention workflows. Your email integration isn't being used for automation.",
        impact: "Enabling a follow-up workflow could save 2–5 hrs/week of manual outreach",
        actionLabel: "Browse workflow templates",
        actionUrl: "/admin/workflow-builder",
      });
    }

    if (!connectedIntegrationTypes.has("gmail") && !connectedIntegrationTypes.has("slack")) {
      recs.push({
        id: "rec-no-integrations",
        type: "integration",
        priority: "high",
        title: "No communication integrations connected",
        reason: "Your AI agents can't send emails or alerts without a communication integration. Connect Gmail or Slack to unlock automation.",
        impact: "Connecting Gmail enables automated outreach, follow-ups, and lead qualification",
        actionLabel: "Connect integrations",
        actionUrl: "/admin/ai-workforce",
      });
    }

    if (!connectedIntegrationTypes.has("google_calendar") && publishedWorkflows.some((w: any) => w.category === "onboarding" || w.category === "scheduling")) {
      recs.push({
        id: "rec-no-calendar",
        type: "integration",
        priority: "medium",
        title: "Scheduling workflows active but no calendar connected",
        reason: "You have scheduling workflows published, but Google Calendar isn't connected. Session booking automation won't work without it.",
        impact: "Connect Google Calendar to enable automated booking and reminders",
        actionLabel: "Connect calendar",
        actionUrl: "/admin/ai-workforce",
      });
    }

    // ─── Workflow gaps ────────────────────────────────────────────────────────

    if (publishedWorkflows.length === 0 && graphs.length === 0) {
      recs.push({
        id: "rec-no-workflows",
        type: "workflow",
        priority: "high",
        title: "No workflows created yet",
        reason: "You haven't built any automation workflows yet. Start with a template to save time on your first automation.",
        impact: "Your first workflow could automate hours of weekly manual work",
        actionLabel: "Open Workflow Builder",
        actionUrl: "/admin/workflow-builder",
      });
    } else if (publishedWorkflows.length === 0 && draftWorkflows.length > 0) {
      recs.push({
        id: "rec-unpublished-drafts",
        type: "workflow",
        priority: "medium",
        title: `${draftWorkflows.length} workflow draft${draftWorkflows.length > 1 ? "s" : ""} waiting to be published`,
        reason: "You've built workflow drafts but haven't published them. Nothing runs until you review and publish.",
        impact: "Publishing your drafts activates your automation pipeline",
        actionLabel: "Review drafts",
        actionUrl: "/admin/workflows-library",
      });
    }

    if (!graphs.some((g: any) => g.category === "retention") && connectedIntegrationTypes.has("gmail")) {
      recs.push({
        id: "rec-no-retention",
        type: "workflow",
        priority: "medium",
        title: "No retention workflows configured",
        reason: "Client churn is one of the biggest revenue risks. A retention workflow can automatically re-engage at-risk clients before they cancel.",
        impact: "A retention workflow could recover 10–20% of clients who might otherwise churn",
        actionLabel: "Create retention workflow",
        actionUrl: "/admin/workflow-builder",
      });
    }

    // ─── Governance recommendations ───────────────────────────────────────────

    const highRiskWorkflows = graphs.filter((g: any) => g.riskLevel === "high" || g.riskLevel === "critical");
    const approvalRequiredCount = graphs.filter((g: any) => g.requiresApproval).length;

    if (highRiskWorkflows.length > 0 && approvalRequiredCount === 0) {
      recs.push({
        id: "rec-high-risk-no-approval",
        type: "governance",
        priority: "high",
        title: "High-risk workflows have no approval gates",
        reason: `${highRiskWorkflows.length} workflow${highRiskWorkflows.length > 1 ? "s are" : " is"} rated high risk but require no approval. This means AI can execute these actions autonomously.`,
        impact: "Adding approval gates prevents unintended automated communications",
        actionLabel: "Review governance",
        actionUrl: "/admin/ai-governance",
      });
    }

    // ─── Agent utilization ────────────────────────────────────────────────────

    if (publishedWorkflows.length > 0 && !connectedIntegrationTypes.has("openrouter")) {
      recs.push({
        id: "rec-no-ai-model",
        type: "agent",
        priority: "medium",
        title: "No AI model integration connected",
        reason: "Several of your agents use AI for recommendations and analysis. Connect OpenRouter to unlock multi-model AI capabilities.",
        impact: "AI model access improves recommendation quality and enables smarter automation",
        actionLabel: "Connect AI models",
        actionUrl: "/admin/ai-workforce",
      });
    }

    // ─── Positive / trust signals ─────────────────────────────────────────────

    if (publishedWorkflows.length >= 3) {
      recs.push({
        id: "rec-good-adoption",
        type: "automation",
        priority: "low",
        title: "Strong workflow adoption — consider upgrading governance",
        reason: `You have ${publishedWorkflows.length} active workflows running well. If you trust the system, consider moving to Balanced or Advanced governance for less friction.`,
        impact: "Reducing approval requirements on trusted workflows saves time",
        actionLabel: "Review governance settings",
        actionUrl: "/admin/ai-governance",
      });
    }

  } catch (e) {
    console.error("[recommendation-engine] error:", e);
  }

  // Sort by priority
  const priority = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => priority[a.priority] - priority[b.priority]);
}

/**
 * Generate NL-based workflow draft from a plain-English prompt.
 * Uses OpenAI to interpret the prompt and build a graph definition.
 * ALWAYS returns a draft — never auto-publishes.
 */
export async function generateWorkflowFromPrompt(
  prompt: string,
  orgId: string,
): Promise<{
  name: string;
  graphDefinition: any;
  riskLevel: string;
  requiresApproval: boolean;
  suggestedAgents: string[];
  suggestedIntegrations: string[];
  governanceWarnings: string[];
  explanation: string;
}> {
  const { runAICompletion } = await import("./ai-model-runtime");

  const systemPrompt = `You are an AI workflow architect for a strength & conditioning coaching platform.
Convert the operator's plain-English description into a structured workflow graph definition.

Node types available:
- Triggers: schedule_trigger, webhook_trigger, gmail_reply_trigger, meta_lead_trigger, payment_failed_trigger, booking_cancelled_trigger, manual_trigger
- Agent Actions: send_email, generate_recommendation, summarize_thread, research_lead, generate_report, classify_reply, create_booking, post_slack_alert
- Logic: if_else, confidence_threshold, wait_delay, retry_policy, rate_limit_gate
- Human: approval_gate, manual_review, escalate_admin
- Outcomes: workflow_completed, workflow_failed, workflow_escalated, client_retained, client_converted, session_booked

Each node needs: id (unique), type: "workflowNode", position: {x, y}, data: {label, nodeType, category, config: {}, riskLevel, requiresApproval, agentType?}
Each edge needs: id, source, target, label?

Return ONLY valid JSON with this structure:
{
  "name": "Short workflow name",
  "explanation": "1-2 sentence plain English explanation of what this workflow does",
  "graphDefinition": {
    "nodes": [...],
    "edges": [...],
    "viewport": {"x": 0, "y": 0, "zoom": 0.8}
  },
  "riskLevel": "low|medium|high",
  "requiresApproval": boolean,
  "suggestedAgents": ["agent_type", ...],
  "suggestedIntegrations": ["gmail", "slack", ...],
  "governanceWarnings": ["warning text", ...]
}

Rules:
- Always start with a trigger node
- Always end with an outcome node
- Add approval_gate before any send_email or create_booking action
- Mark send_email nodes as riskLevel: "high", requiresApproval: true
- Position nodes vertically with 140px spacing`;

  const aiResult = await runAICompletion({
    orgId,
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Create a workflow for: "${prompt}"` },
    ],
    responseFormat: { type: "json_object" },
    maxTokens: 2000,
    purpose: "workflow_generation",
    agentType: "nexus_agent",
  });

  const raw = aiResult.content;
  const parsed = JSON.parse(raw);

  return {
    name: parsed.name ?? prompt.slice(0, 50),
    graphDefinition: parsed.graphDefinition ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    riskLevel: parsed.riskLevel ?? "medium",
    requiresApproval: parsed.requiresApproval ?? true,
    suggestedAgents: parsed.suggestedAgents ?? [],
    suggestedIntegrations: parsed.suggestedIntegrations ?? [],
    governanceWarnings: parsed.governanceWarnings ?? [],
    explanation: parsed.explanation ?? "",
  };
}
