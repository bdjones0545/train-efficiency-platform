#!/usr/bin/env npx tsx
/**
 * kevin-live-agent-test.mts — Live tunnel verification for ALL Kevin agents.
 *
 * For each enabled agent, inserts a real agent_job and dispatches it to the
 * live Kevin gateway (KEVIN_GATEWAY_BASE_URL), then polls agent_jobs for
 * callback-driven status transitions. Requires KEVIN_AGENT_INTEGRATION_ENABLED=true.
 *
 * Usage: npx tsx server/scripts/kevin-live-agent-test.mts
 */

import crypto from "node:crypto";
import { db } from "../db.js";
import { sql } from "drizzle-orm";
import { getEnabledAgents } from "../services/kevin-agent-registry.js";
import { dispatchKevinTask } from "../services/kevin-gateway-client.js";
import { buildOrgAgentContext } from "../services/kevin-org-context-service.js";
import { buildRetentionContext } from "../services/retention-context-service.js";
import { getKevinAgentConfig } from "../services/kevin-agent-config.js";

const ORG_ID = process.env.TEST_ORG_ID ?? process.env.TRAINEFFICIENCY_DEFAULT_ORG_ID ?? "";
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;

function rowsOf(r: any): any[] { return Array.isArray(r) ? r : r?.rows ?? []; }

async function main() {
  const cfg = getKevinAgentConfig();
  console.log(`Gateway: ${cfg.gatewayBaseUrl} | enabled=${cfg.enabled} | callback=${cfg.callbackBaseUrl}`);
  if (!cfg.enabled) { console.error("Integration disabled — aborting."); process.exit(1); }
  if (!ORG_ID) { console.error("No org id."); process.exit(1); }

  const agents = getEnabledAgents();
  console.log(`Enabled agents: ${agents.map(a => a.id).join(", ")}\n`);

  const jobs: { agentId: string; taskType: string; jobId: string; dispatched: boolean; dispatchError?: string }[] = [];

  for (const agent of agents) {
    const taskType = agent.allowedTaskTypes[0];
    if (!taskType) continue;

    let subjectType = "organization";
    let subjectId = ORG_ID;
    let context: any = null;

    if (agent.id === "retention-agent") {
      const clients = rowsOf(await db.execute(sql`
        SELECT up.user_id FROM user_profiles up WHERE up.organization_id = ${ORG_ID} LIMIT 5
      `));
      for (const c of clients) {
        context = await buildRetentionContext(String(c.user_id), ORG_ID);
        if (context) { subjectType = "client"; subjectId = String(c.user_id); break; }
      }
      if (!context) { console.log(`⚠️  ${agent.id}: no client context available — skipping`); continue; }
    } else {
      context = await buildOrgAgentContext(ORG_ID);
      if (!context) { console.log(`⚠️  ${agent.id}: org context unavailable — skipping`); continue; }
    }

    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const uniqueKey = `${ORG_ID}:${agent.id}:${taskType}:live-test:${jobId}`;

    await db.execute(sql`
      INSERT INTO agent_jobs (
        id, organization_id, agent_id, task_type, status,
        requested_by_user_id, subject_type, subject_id,
        request_payload, idempotency_key, correlation_id,
        attempt_count, requested_at, created_at, updated_at
      ) VALUES (
        ${jobId}, ${ORG_ID}, ${agent.id}, ${taskType}, 'requested',
        'live-tunnel-test', ${subjectType}, ${subjectId},
        ${JSON.stringify({ liveTest: true })}, ${uniqueKey}, ${correlationId},
        1, NOW(), NOW(), NOW()
      )
    `);

    try {
      const remoteTaskId = await dispatchKevinTask(
        jobId, agent.id, taskType, ORG_ID, "live-tunnel-test", "admin",
        subjectType, subjectId, context, uniqueKey, correlationId,
      );
      console.log(`🚀 ${agent.id} (${taskType}) → accepted, remoteTaskId=${remoteTaskId}`);
      jobs.push({ agentId: agent.id, taskType, jobId, dispatched: true });
    } catch (err: any) {
      console.log(`❌ ${agent.id} (${taskType}) → dispatch failed: ${err.code ?? err.message}`);
      jobs.push({ agentId: agent.id, taskType, jobId, dispatched: false, dispatchError: err.code ?? err.message });
    }
  }

  // Poll for callback-driven transitions
  const dispatchedJobs = jobs.filter(j => j.dispatched);
  console.log(`\nPolling ${dispatchedJobs.length} dispatched jobs for up to ${POLL_TIMEOUT_MS / 1000}s...`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const terminal = new Set(["completed", "failed", "cancelled", "timed_out", "blocked_by_policy"]);
  const final: Record<string, string> = {};

  while (Date.now() < deadline && dispatchedJobs.length > 0) {
    const idList = sql.join(dispatchedJobs.map(j => sql`${j.jobId}`), sql`, `);
    const rows = rowsOf(await db.execute(sql`
      SELECT id, agent_id, status, error_code, result_payload IS NOT NULL AS has_result
      FROM agent_jobs WHERE id IN (${idList})
    `));
    let allDone = true;
    for (const r of rows) {
      final[String(r.agent_id)] = `${r.status}${r.error_code ? ` (${r.error_code})` : ""}${r.has_result ? " +result" : ""}`;
      if (!terminal.has(String(r.status))) allDone = false;
    }
    if (allDone && rows.length) break;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log("\n═══ FINAL REPORT ═══");
  for (const j of jobs) {
    const status = j.dispatched ? (final[j.agentId] ?? "unknown") : `DISPATCH_FAILED: ${j.dispatchError}`;
    console.log(`  ${j.agentId.padEnd(22)} ${j.taskType.padEnd(34)} ${status}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
