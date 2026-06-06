/**
 * Software Improvement Agent
 *
 * Scans workflow failures, dead letters, trigger audit logs, agent execution logs,
 * and other system signals to create Codex-ready engineering tasks.
 *
 * SAFETY: This agent creates structured task records ONLY.
 * It does NOT execute code, deploy, merge PRs, send emails, or touch Stripe.
 */

import { db } from "../db";
import { eq, and, desc, gte, lt, sql, or, ne } from "drizzle-orm";
import {
  softwareImprovementTasks,
  workflowRuns,
  emailTriggerEvents,
  unifiedAgentActionLog,
  organizations,
} from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DetectedIssue {
  sourceAgent: string;
  sourceType: string;
  sourceRefId?: string;
  title: string;
  problemSummary: string;
  businessContext: string;
  affectedArea: string;
  suspectedFiles: string;
  reproductionSteps: string;
  expectedBehavior: string;
  severity: "critical" | "high" | "medium" | "low";
  priority: number;
}

// ─── Cooldown tracking (in-memory per org) ────────────────────────────────────

const _lastRunAt: Record<string, Date> = {};
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown between agent runs

export function canRunSoftwareImprovementAgent(orgId: string): boolean {
  const last = _lastRunAt[orgId];
  if (!last) return true;
  return Date.now() - last.getTime() > COOLDOWN_MS;
}

function markRunComplete(orgId: string) {
  _lastRunAt[orgId] = new Date();
}

// ─── Codex prompt builder ─────────────────────────────────────────────────────

function buildCodexPrompt(task: {
  title: string;
  problemSummary: string;
  businessContext: string;
  affectedArea: string;
  suspectedFiles: string;
  reproductionSteps: string;
  expectedBehavior: string;
}): string {
  return `You are working on TrainEfficiency, a multi-tenant SaaS scheduling platform for strength and conditioning businesses.

## Problem
${task.problemSummary}

## Business context
${task.businessContext}

## Affected area
${task.affectedArea}

## Suspected files / routes
${task.suspectedFiles}

## Reproduction steps
${task.reproductionSteps}

## Expected behavior
${task.expectedBehavior}

## Constraints
- Preserve multi-tenant isolation (every query must be scoped to organization_id)
- Do not break organization authentication
- Do not expose global data across organizations
- Do NOT modify production data
- Do NOT send emails, trigger Stripe actions, or execute any business actions
- Keep all UI mobile responsive
- Add useful logging for debugging
- Add or update tests where possible

## Acceptance checks
- \`npm run check\` passes with zero TypeScript errors
- The affected endpoint works correctly
- No cross-org data leakage (test with a second organization)
- UI renders correctly on mobile if frontend is affected
- No regression in existing functionality`;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

async function findExistingTask(
  orgId: string,
  title: string,
  sourceType: string,
  sourceRefId?: string,
): Promise<boolean> {
  try {
    const [existing] = await db
      .select({ id: softwareImprovementTasks.id })
      .from(softwareImprovementTasks)
      .where(
        and(
          eq(softwareImprovementTasks.organizationId, orgId),
          eq(softwareImprovementTasks.title, title),
          ne(softwareImprovementTasks.status, "archived"),
          ne(softwareImprovementTasks.status, "merged"),
          ne(softwareImprovementTasks.status, "rejected"),
        ),
      )
      .limit(1)
      .catch(() => []);
    return !!existing;
  } catch {
    return false;
  }
}

// ─── Scanners ─────────────────────────────────────────────────────────────────

async function scanWorkflowFailures(orgId: string): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const failures = await db
      .select({
        id: workflowRuns.id,
        workflowName: workflowRuns.workflowName,
        status: workflowRuns.status,
        errorMessage: workflowRuns.errorMessage,
        startedAt: workflowRuns.startedAt,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.orgId, orgId),
          or(
            eq(workflowRuns.status, "failed"),
            eq(workflowRuns.status, "dead_letter"),
          ),
          gte(workflowRuns.startedAt, cutoff),
        ),
      )
      .orderBy(desc(workflowRuns.startedAt))
      .limit(20)
      .catch(() => []);

    // Group by workflow name to avoid flooding with duplicates
    const byName: Record<string, typeof failures[0][]> = {};
    for (const f of failures) {
      const key = f.workflowName ?? "unknown";
      if (!byName[key]) byName[key] = [];
      byName[key].push(f);
    }

    for (const [name, runs] of Object.entries(byName)) {
      const sample = runs[0];
      issues.push({
        sourceAgent: "workflow_monitor",
        sourceType: "workflow_failure",
        sourceRefId: sample.id,
        title: `Workflow failure: ${name} (${runs.length} occurrences)`,
        problemSummary: `Workflow "${name}" has failed ${runs.length} time(s) in the last 7 days. Last error: ${sample.errorMessage ?? "no error message captured"}`,
        businessContext: `Failed workflows disrupt automated operations and can cause data inconsistency or missed actions for organization ${orgId}.`,
        affectedArea: `Workflow Engine / ${name}`,
        suspectedFiles: `server/routes.ts (workflow execution), server/services/ (relevant service for ${name})`,
        reproductionSteps: `1. Trigger workflow "${name}" for org ${orgId}\n2. Observe failure in workflow_runs table\n3. Check errorMessage field for root cause`,
        expectedBehavior: `Workflow "${name}" should complete successfully and log status "completed"`,
        severity: runs.length >= 5 ? "high" : "medium",
        priority: runs.length >= 5 ? 80 : 60,
      });
    }
  } catch (err: any) {
    // Silent — do not interrupt the agent run
  }
  return issues;
}

async function scanTriggerAuditFailures(orgId: string): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const blocked = await db
      .select({
        id: emailTriggerEvents.id,
        triggerType: emailTriggerEvents.triggerType,
        blockReason: emailTriggerEvents.blockReason,
        errorMessage: emailTriggerEvents.errorMessage,
        createdAt: emailTriggerEvents.createdAt,
      })
      .from(emailTriggerEvents)
      .where(
        and(
          eq(emailTriggerEvents.orgId, orgId),
          eq(emailTriggerEvents.decision, "blocked"),
          gte(emailTriggerEvents.createdAt, cutoff),
        ),
      )
      .orderBy(desc(emailTriggerEvents.createdAt))
      .limit(30)
      .catch(() => []);

    const byReason: Record<string, number> = {};
    for (const b of blocked) {
      const key = b.blockReason ?? "unknown";
      byReason[key] = (byReason[key] ?? 0) + 1;
    }

    for (const [reason, count] of Object.entries(byReason)) {
      if (count < 3) continue; // Only surface patterns, not one-offs
      issues.push({
        sourceAgent: "trigger_audit_monitor",
        sourceType: "trigger_block_pattern",
        title: `Email trigger consistently blocked: "${reason}" (${count}x)`,
        problemSummary: `Email triggers are being systematically blocked due to "${reason}" — ${count} occurrences in the last 7 days. This may indicate a configuration issue or logic bug.`,
        businessContext: `Blocked triggers mean automated outreach and follow-ups are silently failing, reducing pipeline activity and revenue for org ${orgId}.`,
        affectedArea: "Email Agent / Trigger Decision Engine",
        suspectedFiles: `server/email-agent/reply-classifier.ts, server/email-agent/follow-up-cron.ts, server/email-agent/trigger-logger.ts`,
        reproductionSteps: `1. Query email_trigger_events WHERE org_id = '${orgId}' AND decision = 'blocked' AND block_reason = '${reason}'\n2. Review the trigger context and decision logic\n3. Trace back to the relevant classifier or cron`,
        expectedBehavior: `Triggers blocked for "${reason}" should be legitimate blocks with clear business rules, not systematic failures`,
        severity: count >= 10 ? "high" : "medium",
        priority: count >= 10 ? 75 : 55,
      });
    }
  } catch {
    // Silent
  }
  return issues;
}

async function scanAgentActionFailures(orgId: string): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failed = await db
      .select({
        id: unifiedAgentActionLog.id,
        agentName: unifiedAgentActionLog.agentName,
        actionType: unifiedAgentActionLog.actionType,
        status: unifiedAgentActionLog.status,
        errorMessage: unifiedAgentActionLog.errorMessage,
        createdAt: unifiedAgentActionLog.createdAt,
      })
      .from(unifiedAgentActionLog)
      .where(
        and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.status, "failed"),
          gte(unifiedAgentActionLog.createdAt, cutoff),
        ),
      )
      .orderBy(desc(unifiedAgentActionLog.createdAt))
      .limit(50)
      .catch(() => []);

    const byAgent: Record<string, { count: number; sample: typeof failed[0] }> = {};
    for (const f of failed) {
      const key = `${f.agentName}:${f.actionType}`;
      if (!byAgent[key]) byAgent[key] = { count: 0, sample: f };
      byAgent[key].count++;
    }

    for (const [key, { count, sample }] of Object.entries(byAgent)) {
      if (count < 2) continue;
      const [agentName, actionType] = key.split(":");
      issues.push({
        sourceAgent: "agent_action_monitor",
        sourceType: "agent_action_failure",
        sourceRefId: sample.id,
        title: `Agent action failing: ${agentName} / ${actionType} (${count}x)`,
        problemSummary: `Agent "${agentName}" is repeatedly failing action "${actionType}" — ${count} failures in the last 7 days. Last error: ${sample.errorMessage ?? "not captured"}`,
        businessContext: `Repeated agent failures reduce AI system reliability and may mean critical business actions (outreach, follow-ups, pipeline updates) are being silently dropped for org ${orgId}.`,
        affectedArea: `AI Agent / ${agentName}`,
        suspectedFiles: `server/services/${agentName.replace(/_/g, "-")}.ts, server/routes.ts`,
        reproductionSteps: `1. Query unified_agent_action_log WHERE org_id = '${orgId}' AND agent_name = '${agentName}' AND action_type = '${actionType}' AND status = 'failed'\n2. Review error_message for root cause\n3. Reproduce the action in a non-production context`,
        expectedBehavior: `Agent "${agentName}" should complete action "${actionType}" with status "completed" and log a meaningful result`,
        severity: count >= 10 ? "high" : "medium",
        priority: count >= 10 ? 70 : 50,
      });
    }
  } catch {
    // Silent
  }
  return issues;
}

// ─── Priority scorer ──────────────────────────────────────────────────────────

function computeSeverity(issue: DetectedIssue): "critical" | "high" | "medium" | "low" {
  return issue.severity;
}

function computePriority(issue: DetectedIssue): number {
  const base = issue.priority;
  const severityBonus = issue.severity === "critical" ? 20 : issue.severity === "high" ? 10 : 0;
  return Math.min(100, base + severityBonus);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runSoftwareImprovementAgent(orgId: string): Promise<{
  tasksCreated: number;
  tasksSkipped: number;
  errors: string[];
}> {
  let tasksCreated = 0;
  let tasksSkipped = 0;
  const errors: string[] = [];

  // Enforce cooldown
  if (!canRunSoftwareImprovementAgent(orgId)) {
    return { tasksCreated: 0, tasksSkipped: 0, errors: ["Cooldown active — skipping run"] };
  }

  markRunComplete(orgId);

  // Run all scanners
  const allIssues: DetectedIssue[] = [];
  try { allIssues.push(...(await scanWorkflowFailures(orgId))); } catch (e: any) { errors.push(`workflow_scanner: ${e.message}`); }
  try { allIssues.push(...(await scanTriggerAuditFailures(orgId))); } catch (e: any) { errors.push(`trigger_audit_scanner: ${e.message}`); }
  try { allIssues.push(...(await scanAgentActionFailures(orgId))); } catch (e: any) { errors.push(`agent_action_scanner: ${e.message}`); }

  // Create tasks (with deduplication)
  for (const issue of allIssues) {
    try {
      const isDuplicate = await findExistingTask(orgId, issue.title, issue.sourceType, issue.sourceRefId);
      if (isDuplicate) {
        tasksSkipped++;
        continue;
      }

      const severity = computeSeverity(issue);
      const priority = computePriority(issue);
      const codexPrompt = buildCodexPrompt({
        title: issue.title,
        problemSummary: issue.problemSummary,
        businessContext: issue.businessContext,
        affectedArea: issue.affectedArea,
        suspectedFiles: issue.suspectedFiles,
        reproductionSteps: issue.reproductionSteps,
        expectedBehavior: issue.expectedBehavior,
      });

      await db.insert(softwareImprovementTasks).values({
        organizationId: orgId,
        sourceAgent: issue.sourceAgent,
        sourceType: issue.sourceType,
        sourceRefId: issue.sourceRefId ?? null,
        title: issue.title,
        problemSummary: issue.problemSummary,
        businessContext: issue.businessContext ?? null,
        affectedArea: issue.affectedArea ?? null,
        suspectedFiles: issue.suspectedFiles ?? null,
        reproductionSteps: issue.reproductionSteps ?? null,
        expectedBehavior: issue.expectedBehavior ?? null,
        constraints: `- Preserve multi-tenant isolation\n- No production data modification\n- No emails or Stripe actions\n- Keep mobile responsive`,
        acceptanceChecks: `- npm run check passes\n- Endpoint works correctly\n- No cross-org data leakage\n- UI works on mobile`,
        severity,
        priority,
        status: "detected",
        codexPrompt,
      });

      tasksCreated++;
    } catch (e: any) {
      errors.push(`task_create: ${e.message}`);
    }
  }

  return { tasksCreated, tasksSkipped, errors };
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureSoftwareImprovementTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS software_improvement_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        source_agent VARCHAR NOT NULL,
        source_type VARCHAR NOT NULL,
        source_ref_id VARCHAR,
        title VARCHAR(512) NOT NULL,
        problem_summary TEXT NOT NULL,
        business_context TEXT,
        affected_area VARCHAR(256),
        suspected_files TEXT,
        reproduction_steps TEXT,
        expected_behavior TEXT,
        constraints TEXT,
        acceptance_checks TEXT,
        severity VARCHAR(32) NOT NULL DEFAULT 'medium',
        priority INTEGER NOT NULL DEFAULT 50,
        status VARCHAR(64) NOT NULL DEFAULT 'detected',
        codex_prompt TEXT,
        codex_status VARCHAR(64),
        codex_branch VARCHAR(256),
        codex_pr_url VARCHAR(512),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
  } catch {
    // Table may already exist
  }
}
