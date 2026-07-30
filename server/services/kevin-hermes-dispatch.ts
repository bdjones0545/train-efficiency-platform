/**
 * kevin-hermes-dispatch.ts — Dispatch agent_jobs through Kevin's live Hermes tunnel.
 *
 * Kevin's live gateway (kevin-api.trainefficiency.com) is a Hermes agent API
 * server: it exposes run submission (/v1/runs) + status polling, NOT the
 * signed POST /tasks contract. This module bridges the agent_jobs pipeline
 * onto Hermes runs:
 *
 *   1. Build a strict-JSON task prompt from agentId/taskType/context
 *   2. hermesCreateRun() → store run_id as remote_task_id, job → 'queued'
 *   3. Background-poll hermesGetRun() until terminal
 *   4. On completion: parse JSON output →
 *        retention-agent  → insert retention_agent_analyses row + complete job
 *        all other agents → store result_payload on the job + complete
 *   5. On failure/timeout: mark job failed with a safe error code
 *
 * The signed-callback path (kevin-webhook-routes.ts) remains live for a
 * future gateway that implements the /tasks contract; this module is the
 * working path against today's tunnel.
 */

import crypto from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { hermesCreateRun, hermesGetRun, isKevinConfigured } from "./kevin-hermes-client";
import { auditAgentJob } from "./kevin-agent-audit";

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

const RETENTION_SCHEMA = `{
  "riskLevel": "low" | "medium" | "high",
  "riskScore": <integer 0-100>,
  "confidenceScore": <integer 0-100>,
  "summary": "<2-4 sentence plain-language assessment>",
  "keyFactors": ["<factor>", ...],
  "recommendedActions": ["<action>", ...]
}`;

const GENERIC_SCHEMAS: Record<string, string> = {
  generate_executive_brief: `{ "headline": "<one-line summary>", "brief": "<3-6 sentence executive brief>", "highlights": ["<item>", ...], "risks": ["<item>", ...], "recommendedActions": ["<action>", ...] }`,
  analyze_revenue_health: `{ "healthScore": <integer 0-100>, "summary": "<3-5 sentences>", "strengths": ["<item>", ...], "concerns": ["<item>", ...], "recommendedActions": ["<action>", ...] }`,
  identify_growth_opportunities: `{ "summary": "<3-5 sentences>", "opportunities": [{ "title": "<short>", "rationale": "<why>", "impact": "low"|"medium"|"high" }], "recommendedActions": ["<action>", ...] }`,
  analyze_schedule_utilization: `{ "utilizationAssessment": "<3-5 sentences>", "findings": ["<item>", ...], "recommendedActions": ["<action>", ...] }`,
  assess_client_success_health: `{ "healthScore": <integer 0-100>, "summary": "<3-5 sentences>", "atRiskSignals": ["<item>", ...], "recommendedActions": ["<action>", ...] }`,
  generate_strategic_priorities: `{ "summary": "<2-4 sentences>", "priorities": [{ "title": "<short>", "rationale": "<why>", "urgency": "low"|"medium"|"high" }] }`,
};

export function isHermesDispatchAvailable(): boolean {
  return isKevinConfigured();
}

function buildPrompt(agentId: string, taskType: string, context: unknown): { input: string; instructions: string } {
  const schema = agentId === "retention-agent"
    ? RETENTION_SCHEMA
    : GENERIC_SCHEMAS[taskType] ?? `{ "summary": "<3-5 sentences>", "findings": ["<item>", ...], "recommendedActions": ["<action>", ...] }`;

  const instructions = [
    `You are the ${agentId} for the TrainEfficiency platform (a sports-training business OS).`,
    `Execute the task "${taskType}" using ONLY the business context JSON provided.`,
    `Respond with EXACTLY ONE JSON object matching this schema and nothing else — no markdown, no code fences, no commentary:`,
    schema,
    `If the context has little data, still return valid JSON with conservative values and say so in the summary.`,
  ].join("\n\n");

  const input = `Task: ${taskType}\n\nBusiness context JSON:\n${JSON.stringify(context, null, 2)}`;
  return { input, instructions };
}

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

function extractOutputText(remote: any): string {
  if (!remote || typeof remote !== "object") return "";
  const direct = remote.output_text ?? remote.summary ?? remote.result ?? remote.output;
  if (typeof direct === "string" && direct.trim()) return direct;
  if (direct && typeof direct === "object") return JSON.stringify(direct);
  // messages/items arrays (responses-api style)
  const items = remote.items ?? remote.messages ?? remote.events;
  if (Array.isArray(items)) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const t = it?.content ?? it?.text ?? it?.output_text;
      if (typeof t === "string" && t.trim()) return t;
      if (Array.isArray(t)) {
        const s = t.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("");
        if (s.trim()) return s;
      }
    }
  }
  return "";
}

const TERMINAL = ["completed", "failed", "cancelled", "timed_out", "blocked_by_policy"];

async function markJobFailed(jobId: string, code: string, message: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'failed', error_code = ${code}, error_message = ${message},
        failed_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId}
      AND status NOT IN ('completed', 'failed', 'cancelled', 'timed_out', 'blocked_by_policy')
  `);
}

async function getJobStatus(jobId: string): Promise<string | null> {
  const res: any = await db.execute(sql`SELECT status FROM agent_jobs WHERE id = ${jobId}`);
  const rows = Array.isArray(res) ? res : res?.rows ?? [];
  return rows.length ? String(rows[0].status) : null;
}

async function completeJob(
  jobId: string,
  agentId: string,
  organizationId: string,
  subjectId: string,
  result: Record<string, unknown>,
): Promise<void> {
  if (agentId === "retention-agent") {
    // Normalize to the retention_risk_level enum (low|moderate|high|critical)
    const rawLevel = String(result.riskLevel ?? "").toLowerCase();
    const riskLevel = rawLevel === "medium" ? "moderate" : rawLevel;
    const riskScore = Math.round(Number(result.riskScore));
    const confidence = Math.round(Number(result.confidenceScore));
    const summary = String(result.summary ?? "");
    if (!["low", "moderate", "high", "critical"].includes(riskLevel) || !Number.isFinite(riskScore) || !summary) {
      await markJobFailed(jobId, "kevin_invalid_result", "Kevin returned an unusable retention result.");
      return;
    }
    await db.execute(sql`
      INSERT INTO retention_agent_analyses (
        id, organization_id, client_id, agent_job_id,
        risk_level, risk_score, confidence_score, summary,
        risk_factors, recommended_actions, evidence, model_version, created_at, updated_at
      ) VALUES (
        ${crypto.randomUUID()}, ${organizationId}, ${subjectId}, ${jobId},
        ${riskLevel}, ${riskScore}, ${Number.isFinite(confidence) ? confidence : 50}, ${summary},
        ${JSON.stringify(result.keyFactors ?? [])}, ${JSON.stringify(result.recommendedActions ?? [])},
        ${JSON.stringify(result)}, 'kevin-hermes', NOW(), NOW()
      )
      ON CONFLICT DO NOTHING
    `);
  }
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'completed', completed_at = NOW(),
        result_payload = ${JSON.stringify(result)}, updated_at = NOW()
    WHERE id = ${jobId}
      AND status NOT IN ('completed', 'failed', 'cancelled', 'timed_out', 'blocked_by_policy')
  `);
}

function pollRunUntilDone(
  jobId: string,
  agentId: string,
  organizationId: string,
  subjectId: string,
  runId: string,
  correlationId: string,
): void {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  const tick = async (): Promise<void> => {
    // If another path (e.g. the signed webhook) already finished this job, stop.
    try {
      const current = await getJobStatus(jobId);
      if (current === null || TERMINAL.includes(current)) return;
    } catch { /* transient DB error — keep polling */ }
    try {
      const remote = await hermesGetRun(runId);
      const status = String(remote?.status ?? "").toLowerCase();

      if (["completed", "complete", "succeeded", "success"].includes(status)) {
        const text = extractOutputText(remote);
        const parsed = extractJson(text);
        if (!parsed) {
          await markJobFailed(jobId, "kevin_invalid_result", "Kevin run completed but output was not parseable JSON.");
        } else {
          await completeJob(jobId, agentId, organizationId, subjectId, parsed);
          auditAgentJob("agent.job.completed", { jobId, agentId, organizationId, remoteTaskId: runId, correlationId });
          console.log(JSON.stringify({ event: "KEVIN_HERMES_RUN_COMPLETED", jobId, runId, agentId, timestamp: new Date().toISOString() }));
        }
        return;
      }
      if (["failed", "error", "stopped", "cancelled", "canceled"].includes(status)) {
        await markJobFailed(jobId, "kevin_run_failed", `Kevin run ended with status ${status}.`);
        return;
      }
      // still running — mark running once
      await db.execute(sql`
        UPDATE agent_jobs SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = ${jobId} AND status IN ('queued', 'dispatching')
      `);
    } catch (err) {
      console.log(JSON.stringify({ event: "KEVIN_HERMES_POLL_ERROR", jobId, runId, timestamp: new Date().toISOString() }));
    }
    if (Date.now() > deadline) {
      await markJobFailed(jobId, "kevin_timeout", "Kevin run did not complete within the polling window.");
      return;
    }
    setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
  };

  setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
}

/**
 * Dispatch a job as a Hermes run. Returns the Hermes run id.
 * Throws on submission failure (caller marks the job failed).
 */
export async function dispatchViaHermesRun(
  jobId: string,
  agentId: string,
  taskType: string,
  organizationId: string,
  subjectType: string,
  subjectId: string,
  context: unknown,
  correlationId: string,
): Promise<string> {
  const { input, instructions } = buildPrompt(agentId, taskType, context);
  const created = await hermesCreateRun({ input, instructions });

  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'queued', remote_task_id = ${created.runId},
        accepted_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId}
  `);
  auditAgentJob("agent.job.accepted", { jobId, agentId, taskType, organizationId, remoteTaskId: created.runId, correlationId });
  console.log(JSON.stringify({
    event: "KEVIN_HERMES_RUN_SUBMITTED", jobId, runId: created.runId, agentId, taskType,
    timestamp: new Date().toISOString(),
  }));

  pollRunUntilDone(jobId, agentId, organizationId, subjectId, created.runId, correlationId);
  return created.runId;
}

/**
 * Boot-time reconciler: resume polling for Hermes-dispatched jobs that were
 * left in a non-terminal state by a server restart. Jobs older than the
 * polling window are timed out instead of resumed.
 */
export async function reconcileInFlightHermesJobs(): Promise<void> {
  if (!isKevinConfigured()) return;
  try {
    const res: any = await db.execute(sql`
      SELECT id, agent_id, organization_id, subject_id, remote_task_id, correlation_id, requested_at
      FROM agent_jobs
      WHERE remote_task_id LIKE 'run_%'
        AND status IN ('queued', 'dispatching', 'running')
    `);
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    for (const r of rows) {
      const ageMs = Date.now() - new Date(r.requested_at).getTime();
      if (ageMs > POLL_TIMEOUT_MS) {
        await markJobFailed(String(r.id), "kevin_timeout", "Kevin run did not complete before a server restart.");
        continue;
      }
      pollRunUntilDone(
        String(r.id), String(r.agent_id), String(r.organization_id),
        String(r.subject_id), String(r.remote_task_id), String(r.correlation_id ?? ""),
      );
    }
    if (rows.length) {
      console.log(JSON.stringify({
        event: "KEVIN_HERMES_RECONCILE", inFlight: rows.length, timestamp: new Date().toISOString(),
      }));
    }
  } catch (err) {
    console.error("[KevinHermesDispatch] reconcile failed:", (err as Error)?.message);
  }
}
