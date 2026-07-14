/**
 * Kevin Signal Router — Phase 3
 *
 * Receives validated Kevin→TE signals and routes them to the appropriate
 * TE destination:
 *   critical/high risk         → Attention Inbox
 *   pattern.detected           → Attention Inbox (suggested)
 *   recommendation             → Attention Inbox (suggested or important)
 *   environment.change         → CEO Heartbeat enrichment note
 *   architecture.change        → Attention Inbox + CEO Heartbeat
 *   integration.failure        → Attention Inbox (important)
 *   security.signal            → Attention Inbox (critical, evidence NOT exposed)
 *   memory.conflict            → Admin Kevin Console + CEO Heartbeat
 *
 * Loop prevention:
 *   - Deduplication: identical (org, signalType, entityType, entityId) with
 *     status=pending blocks duplicate insertions.
 *   - Depth > MAX_DEPTH is rejected at intake.
 *   - Attention Items from Kevin signals never trigger new Kevin signals.
 */

import { db } from "../db";
import { kevinSignals } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import { isKevinCapabilityEnabled } from "./kevin-capability-service";

const MAX_SIGNAL_DEPTH = 3;
const MAX_TITLE_LEN = 300;
const MAX_SUMMARY_LEN = 2000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type InboundSignalPayload = {
  externalSignalId?: string | null;
  orgId: string;
  signalType: string;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  summary?: string | null;
  evidence?: Record<string, unknown>;
  confidence?: number | null;
  riskClass?: "low" | "medium" | "high" | "critical" | null;
  source?: string | null;
  traceId?: string | null;
  depth?: number;
};

export type SignalRouteResult = {
  ok: boolean;
  signalId?: string;
  status: string;
  routedTo?: string;
  attentionItemId?: string | null;
  error?: string;
};

// ─── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeEvidence(
  raw: Record<string, unknown> | undefined,
  isSecuritySignal: boolean,
): Record<string, unknown> {
  if (!raw) return {};
  if (isSecuritySignal) {
    // Strip all evidence for security signals — never expose in UI
    return { _redacted: "security signal evidence not stored" };
  }
  const out: Record<string, unknown> = {};
  const SENSITIVE = ["password", "token", "secret", "key", "email", "phone", "ssn", "credential"];
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (SENSITIVE.some((s) => lower.includes(s))) {
      out[k] = "[redacted]";
    } else if (typeof v === "string") {
      out[k] = v.slice(0, 500);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

async function isDuplicatePendingSignal(
  orgId: string,
  externalSignalId: string | null | undefined,
  signalType: string,
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): Promise<string | null> {
  try {
    // External ID dedup (strongest)
    if (externalSignalId) {
      const existing = await db
        .select({ id: kevinSignals.id, status: kevinSignals.status })
        .from(kevinSignals)
        .where(
          and(
            eq(kevinSignals.orgId, orgId),
            eq(kevinSignals.externalSignalId, externalSignalId),
          ),
        )
        .limit(1);
      if (existing[0]) return existing[0].id;
    }

    // Application-level dedup for pending signals of same type+entity
    if (signalType && entityType && entityId) {
      const result = await db.execute(sql`
        SELECT id FROM kevin_signals
        WHERE org_id = ${orgId}
          AND signal_type = ${signalType}
          AND entity_type = ${entityType}
          AND entity_id = ${entityId}
          AND status = 'pending'
        LIMIT 1
      `);
      const rows = Array.isArray((result as any)?.rows)
        ? (result as any).rows
        : Array.isArray(result)
          ? result
          : [];
      if (rows[0]?.id) return rows[0].id;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

type AttentionLevel = "critical" | "important" | "suggested" | "informational";
type RoutedTo = "attention_inbox" | "ceo_heartbeat" | "kevin_console" | "engineering_queue";

function determineRouting(
  signalType: string,
  riskClass: string | null | undefined,
): { attentionLevel: AttentionLevel | null; routedTo: RoutedTo } {
  const type = signalType.toLowerCase();
  const risk = (riskClass || "medium").toLowerCase();

  // Security signals → critical Attention Inbox
  if (type === "security.signal" || type.startsWith("security.")) {
    return { attentionLevel: "critical", routedTo: "attention_inbox" };
  }

  // Critical/high risk → Attention Inbox
  if (risk === "critical") return { attentionLevel: "critical", routedTo: "attention_inbox" };
  if (risk === "high") return { attentionLevel: "important", routedTo: "attention_inbox" };

  // Integration failure → Attention Inbox
  if (type === "integration.failure" || type.startsWith("integration.")) {
    return { attentionLevel: "important", routedTo: "attention_inbox" };
  }

  // Architecture change → CEO Heartbeat
  if (type === "architecture.change" || type.startsWith("architecture.")) {
    return { attentionLevel: "suggested", routedTo: "ceo_heartbeat" };
  }

  // Environment change → CEO Heartbeat
  if (type === "environment.change" || type.startsWith("environment.")) {
    return { attentionLevel: null, routedTo: "ceo_heartbeat" };
  }

  // Memory conflict → Kevin Console
  if (type === "memory.conflict") {
    return { attentionLevel: null, routedTo: "kevin_console" };
  }

  // Pattern detected → Attention Inbox suggested
  if (type === "pattern.detected" || type.startsWith("pattern.")) {
    return { attentionLevel: "suggested", routedTo: "attention_inbox" };
  }

  // Recommendation → Attention Inbox
  if (type === "recommendation" || type.startsWith("recommendation.")) {
    const level: AttentionLevel = risk === "high" ? "important" : "suggested";
    return { attentionLevel: level, routedTo: "attention_inbox" };
  }

  // Default: suggested in Attention Inbox
  return { attentionLevel: "suggested", routedTo: "attention_inbox" };
}

async function createAttentionItem(opts: {
  orgId: string;
  level: AttentionLevel;
  title: string;
  body: string;
  signalId: string;
  signalType: string;
  riskClass?: string | null;
}): Promise<string | null> {
  try {
    const severity =
      opts.level === "critical" ? 90 : opts.level === "important" ? 65 : opts.level === "suggested" ? 35 : 15;
    const urgency =
      opts.level === "critical" ? 90 : opts.level === "important" ? 70 : opts.level === "suggested" ? 30 : 10;

    const result = await db.execute(sql`
      INSERT INTO attention_items (
        id, org_id, level, category, title, body, source,
        source_id, severity, urgency, business_impact, confidence, status, metadata
      ) VALUES (
        gen_random_uuid()::text,
        ${opts.orgId},
        ${opts.level},
        'operations',
        ${opts.title.slice(0, 255)},
        ${opts.body.slice(0, 1000)},
        'kevin',
        ${opts.signalId},
        ${severity},
        ${urgency},
        50,
        0.85,
        'active',
        ${JSON.stringify({ signalType: opts.signalType, riskClass: opts.riskClass ?? "medium", source: "kevin", _preventKevinLoop: true })}::jsonb
      )
      RETURNING id
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    return rows[0]?.id ?? null;
  } catch (e: any) {
    console.warn("[KevinSignalRouter] attention item creation failed:", e?.message);
    return null;
  }
}

// ─── Main router ──────────────────────────────────────────────────────────────

export async function routeKevinSignal(
  payload: InboundSignalPayload,
): Promise<SignalRouteResult> {
  const traceId = payload.traceId ?? randomUUID();
  const depth = payload.depth ?? 0;

  // Loop prevention
  if (depth > MAX_SIGNAL_DEPTH) {
    void recordKevinAuditEvent({
      orgId: payload.orgId,
      eventType: "signal.rejected_loop",
      payload: { reason: "depth_exceeded", depth, signalType: payload.signalType },
    });
    return { ok: false, status: "rejected_loop", error: "Signal depth exceeded" };
  }

  // Capability check
  const capKey =
    payload.signalType.startsWith("environment")
      ? "environment_change_signals"
      : "attention_inbox_signals";
  const capEnabled = await isKevinCapabilityEnabled(
    payload.orgId,
    capKey,
    "observe",
  );
  if (!capEnabled) {
    return { ok: false, status: "capability_disabled" };
  }

  // Validate org exists (basic check)
  try {
    const orgCheck = await db.execute(sql`
      SELECT id FROM organizations WHERE id = ${payload.orgId} LIMIT 1
    `);
    const orgRows = Array.isArray((orgCheck as any)?.rows)
      ? (orgCheck as any).rows
      : Array.isArray(orgCheck)
        ? orgCheck
        : [];
    if (!orgRows[0]?.id) {
      void recordKevinAuditEvent({
        orgId: payload.orgId,
        eventType: "signal.rejected_invalid_org",
        payload: { signalType: payload.signalType },
      });
      return { ok: false, status: "invalid_org", error: "Organization not found" };
    }
  } catch {
    // DB check failed — proceed cautiously but allow signal
  }

  // Deduplication
  const dupId = await isDuplicatePendingSignal(
    payload.orgId,
    payload.externalSignalId,
    payload.signalType,
    payload.entityType,
    payload.entityId,
  );
  if (dupId) {
    return { ok: true, status: "duplicate", signalId: dupId };
  }

  const isSecuritySignal = payload.signalType.toLowerCase().startsWith("security");
  const safeEvidence = sanitizeEvidence(payload.evidence, isSecuritySignal);
  const safeTitle = (payload.title || "Kevin signal").slice(0, MAX_TITLE_LEN);
  const safeSummary = payload.summary ? payload.summary.slice(0, MAX_SUMMARY_LEN) : null;

  // Validate confidence
  const confidence =
    typeof payload.confidence === "number"
      ? Math.min(1, Math.max(0, payload.confidence))
      : null;

  // Insert signal
  const signalId = randomUUID();
  try {
    await db.insert(kevinSignals).values({
      id: signalId,
      externalSignalId: payload.externalSignalId ?? null,
      orgId: payload.orgId,
      signalType: payload.signalType,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      title: safeTitle,
      summary: safeSummary,
      evidence: safeEvidence,
      confidence,
      riskClass: (payload.riskClass as any) ?? null,
      source: payload.source ?? null,
      status: "pending",
      originTraceId: traceId,
      depth,
    });
  } catch (e: any) {
    void recordKevinAuditEvent({
      orgId: payload.orgId,
      eventType: "signal.insert_failed",
      payload: { error: e?.message?.slice(0, 300), signalType: payload.signalType },
    });
    return { ok: false, status: "insert_failed", error: e?.message ?? "DB error" };
  }

  // Determine routing
  const { attentionLevel, routedTo } = determineRouting(
    payload.signalType,
    payload.riskClass,
  );

  let attentionItemId: string | null = null;

  // Route to Attention Inbox
  if (attentionLevel && routedTo === "attention_inbox") {
    const capInbox = await isKevinCapabilityEnabled(
      payload.orgId,
      "attention_inbox_signals",
      "recommend",
    );
    if (capInbox) {
      const body = isSecuritySignal
        ? `Security signal detected (${payload.signalType}). Evidence details are not displayed for security reasons. Please review the Kevin console for further investigation.`
        : `${safeSummary || safeTitle}\n\nSignal type: ${payload.signalType}\nSource: ${payload.source ?? "kevin"}\nTrace: ${traceId}`;

      attentionItemId = await createAttentionItem({
        orgId: payload.orgId,
        level: attentionLevel,
        title: safeTitle,
        body,
        signalId,
        signalType: payload.signalType,
        riskClass: payload.riskClass,
      });
    }
  }

  // Update signal with routing result
  try {
    await db
      .update(kevinSignals)
      .set({
        status: "routed",
        routedTo,
        attentionItemId,
        routedAt: new Date(),
      })
      .where(eq(kevinSignals.id, signalId));
  } catch {}

  void recordKevinAuditEvent({
    orgId: payload.orgId,
    eventType: "signal.routed",
    payload: {
      signalId,
      signalType: payload.signalType,
      routedTo,
      attentionItemId,
      riskClass: payload.riskClass,
      depth,
    },
  });

  return {
    ok: true,
    signalId,
    status: "routed",
    routedTo,
    attentionItemId,
  };
}
