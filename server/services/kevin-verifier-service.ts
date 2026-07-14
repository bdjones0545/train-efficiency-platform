/**
 * Kevin Execution Verifier Service — Phase 13
 *
 * Each capability has an explicit verifier that checks the result of an execution
 * rather than just trusting an HTTP 200. Verifiers record evidence, deviations,
 * and remediation paths to the DB.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationStatus = "passed" | "failed" | "partial" | "skipped";

export interface VerificationResult {
  status: VerificationStatus;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
  deviation?: string;
  remediationAttempted?: boolean;
  remediationResult?: string;
}

interface VerificationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

interface VerifyEmailDraftArgs {
  orgId: string;
  draftId: string;
  expectedRecipient: string;
  expectedSubject?: string;
}

interface VerifyEmailSendArgs {
  orgId: string;
  actionId: string;
  approvedDraftId: string;
}

interface VerifyAgentTaskArgs {
  orgId: string;
  taskId: string;
  assignedAgent: string;
  expectedOutputSchema?: Record<string, unknown>;
}

interface VerifyScheduleCreateArgs {
  orgId: string;
  sessionId: string;
  expectedAthleteId?: string;
  expectedCoachId?: string;
}

// ─── Verifiers ────────────────────────────────────────────────────────────────

export async function verifyEmailDraft(args: VerifyEmailDraftArgs): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  try {
    const rows = await db.execute(sql`
      SELECT id, org_id, recipient_email, subject, body_preview, status
      FROM gmail_agent_actions
      WHERE id = ${args.draftId}
      LIMIT 1
    `);
    const draft = Array.isArray(rows) ? rows[0] : (rows as any)?.rows?.[0];

    checks.push({ name: "draft_exists", passed: !!draft, detail: draft ? "Draft found in DB" : "Draft not found" });
    if (!draft) {
      return { status: "failed", checks, evidence: {}, deviation: "Draft record not found" };
    }

    const orgMatch = String(draft.org_id) === String(args.orgId);
    checks.push({ name: "org_matches", passed: orgMatch, detail: orgMatch ? "org_id matches" : `Expected ${args.orgId}, got ${draft.org_id}` });

    const hasRecipient = Boolean(draft.recipient_email);
    checks.push({ name: "has_recipient", passed: hasRecipient, detail: draft.recipient_email || "no recipient" });

    const hasSubject = Boolean(draft.subject);
    checks.push({ name: "has_subject", passed: hasSubject, detail: draft.subject ? "subject present" : "missing subject" });

    const hasBody = Boolean(draft.body_preview);
    checks.push({ name: "has_body", passed: hasBody, detail: hasBody ? "body_preview present" : "missing body" });

    const allPassed = checks.every((c) => c.passed);
    return {
      status: allPassed ? "passed" : "partial",
      checks,
      evidence: { draftId: draft.id, recipientEmail: draft.recipient_email, subject: draft.subject, status: draft.status },
      deviation: allPassed ? undefined : "One or more verification checks failed",
    };
  } catch (err: any) {
    return { status: "failed", checks, evidence: {}, deviation: `Verification error: ${err.message}` };
  }
}

export async function verifyEmailSend(args: VerifyEmailSendArgs): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  try {
    const rows = await db.execute(sql`
      SELECT id, org_id, status, result, recipient_email, subject
      FROM gmail_agent_actions
      WHERE id = ${args.actionId}
      LIMIT 1
    `);
    const action = Array.isArray(rows) ? rows[0] : (rows as any)?.rows?.[0];

    checks.push({ name: "action_exists", passed: !!action });
    if (!action) return { status: "failed", checks, evidence: {}, deviation: "Action not found" };

    const orgMatch = String(action.org_id) === String(args.orgId);
    checks.push({ name: "org_matches", passed: orgMatch });

    const sent = action.status === "sent" || action.status === "executed";
    checks.push({ name: "status_sent", passed: sent, detail: `status=${action.status}` });

    const hasResult = Boolean(action.result);
    checks.push({ name: "has_provider_result", passed: hasResult });

    const allPassed = orgMatch && sent;
    return {
      status: allPassed ? "passed" : checks.every((c) => c.passed) ? "passed" : "partial",
      checks,
      evidence: { actionId: action.id, status: action.status, recipient: action.recipient_email },
      deviation: allPassed ? undefined : `Send verification: status=${action.status}`,
    };
  } catch (err: any) {
    return { status: "failed", checks, evidence: {}, deviation: err.message };
  }
}

export async function verifyAgentTask(args: VerifyAgentTaskArgs): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  try {
    const rows = await db.execute(sql`
      SELECT id, org_id, assigned_agent, status, output, failure_reason
      FROM kevin_intent_tasks
      WHERE id = ${args.taskId}
      LIMIT 1
    `);
    const task = Array.isArray(rows) ? rows[0] : (rows as any)?.rows?.[0];

    checks.push({ name: "task_exists", passed: !!task });
    if (!task) return { status: "failed", checks, evidence: {}, deviation: "Task not found" };

    const orgMatch = String(task.org_id) === String(args.orgId);
    checks.push({ name: "org_matches", passed: orgMatch });

    const agentMatch = task.assigned_agent === args.assignedAgent;
    checks.push({ name: "agent_matches", passed: agentMatch, detail: `expected=${args.assignedAgent} got=${task.assigned_agent}` });

    const completed = task.status === "completed";
    checks.push({ name: "task_completed", passed: completed, detail: `status=${task.status}` });

    const hasOutput = Boolean(task.output);
    checks.push({ name: "has_output", passed: hasOutput });

    const allPassed = checks.every((c) => c.passed);
    return {
      status: allPassed ? "passed" : completed ? "partial" : "failed",
      checks,
      evidence: { taskId: task.id, status: task.status, agent: task.assigned_agent, hasOutput },
      deviation: allPassed ? undefined : task.failure_reason || "Task verification incomplete",
    };
  } catch (err: any) {
    return { status: "failed", checks, evidence: {}, deviation: err.message };
  }
}

export async function verifyScheduleCreate(args: VerifyScheduleCreateArgs): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  try {
    const rows = await db.execute(sql`
      SELECT id, organization_id, status, athlete_id, coach_id, start_time
      FROM bookings
      WHERE id = ${args.sessionId}
      LIMIT 1
    `);
    const session = Array.isArray(rows) ? rows[0] : (rows as any)?.rows?.[0];

    checks.push({ name: "session_exists", passed: !!session });
    if (!session) return { status: "failed", checks, evidence: {}, deviation: "Session not found" };

    const orgMatch = String(session.organization_id) === String(args.orgId);
    checks.push({ name: "org_matches", passed: orgMatch });

    if (args.expectedAthleteId) {
      const athleteMatch = String(session.athlete_id) === String(args.expectedAthleteId);
      checks.push({ name: "athlete_matches", passed: athleteMatch });
    }
    if (args.expectedCoachId) {
      const coachMatch = String(session.coach_id) === String(args.expectedCoachId);
      checks.push({ name: "coach_matches", passed: coachMatch });
    }

    const notCancelled = session.status !== "CANCELLED";
    checks.push({ name: "session_not_cancelled", passed: notCancelled, detail: `status=${session.status}` });

    const allPassed = checks.every((c) => c.passed);
    return {
      status: allPassed ? "passed" : "partial",
      checks,
      evidence: { sessionId: session.id, status: session.status, startTime: session.start_time },
    };
  } catch (err: any) {
    return { status: "failed", checks, evidence: {}, deviation: err.message };
  }
}

// ─── Generic verifier dispatcher ──────────────────────────────────────────────

export async function verifyCapabilityExecution(
  capabilityKey: string,
  orgId: string,
  resourceId: string,
  additionalArgs: Record<string, unknown> = {},
): Promise<VerificationResult> {
  const key = capabilityKey.toLowerCase();

  if (key === "email.create_draft" || key === "email.create_reply_draft") {
    return verifyEmailDraft({
      orgId,
      draftId: resourceId,
      expectedRecipient: String(additionalArgs.recipient ?? ""),
      expectedSubject: additionalArgs.subject as string | undefined,
    });
  }

  if (key === "email.send") {
    return verifyEmailSend({
      orgId,
      actionId: resourceId,
      approvedDraftId: String(additionalArgs.approvedDraftId ?? resourceId),
    });
  }

  if (key.startsWith("agent.") || key.startsWith("agent_task.")) {
    return verifyAgentTask({
      orgId,
      taskId: resourceId,
      assignedAgent: String(additionalArgs.assignedAgent ?? "unknown"),
    });
  }

  if (key === "schedule.create_session" || key === "schedule.reschedule_session") {
    return verifyScheduleCreate({
      orgId,
      sessionId: resourceId,
      expectedAthleteId: additionalArgs.athleteId as string | undefined,
      expectedCoachId: additionalArgs.coachId as string | undefined,
    });
  }

  // Capabilities that are observation-only (no side-effect to verify)
  const observeOnly = [
    "platform.retrieve_context", "platform.search_records", "platform.open_location",
    "platform.inspect_integration", "platform.inspect_job",
    "ceo.request_analysis", "ceo.request_briefing", "ceo.ask_question",
    "ceo.request_decision", "ceo.submit_recommendation", "ceo.escalate_risk",
    "agent.list_available", "agent.request_analysis", "agent.request_recommendation",
    "agent.review_output",
  ];
  if (observeOnly.includes(key)) {
    return {
      status: "passed",
      checks: [{ name: "observe_only", passed: true, detail: "Read-only capability — no side-effect verification needed" }],
      evidence: { capabilityKey, resourceId },
    };
  }

  // Unknown capability — skip
  return {
    status: "skipped",
    checks: [{ name: "no_verifier", passed: true, detail: `No verifier registered for ${capabilityKey}` }],
    evidence: { capabilityKey },
  };
}

// ─── Persist verification result ──────────────────────────────────────────────

export async function persistVerificationResult(
  intentId: string,
  taskId: string | null,
  capabilityKey: string,
  result: VerificationResult,
): Promise<void> {
  try {
    if (taskId) {
      await db.execute(sql`
        UPDATE kevin_intent_tasks
        SET
          verification_result = ${JSON.stringify(result)}::jsonb,
          verification_status = ${result.status},
          updated_at = NOW()
        WHERE id = ${taskId}
      `);
    }
    if (intentId) {
      await db.execute(sql`
        UPDATE kevin_intents
        SET
          last_verification_status = ${result.status},
          last_verification_at = NOW(),
          updated_at = NOW()
        WHERE id = ${intentId}
      `);
    }
  } catch {
    /* non-fatal — best effort */
  }
}
