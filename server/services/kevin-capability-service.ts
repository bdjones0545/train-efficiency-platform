/**
 * Kevin Capability Service — Phase 3
 *
 * Persistent per-org capability controls with approval-mode enforcement.
 *
 * Approval mode ordering (least → most permissive):
 *   disabled < observe < recommend < draft < require_approval < auto
 *
 * IMPORTANT: Even `auto` mode does NOT bypass TE's existing Autonomy Policy,
 * Send Guard, Outbound Audit, or Approval systems. It only removes the
 * additional Kevin-layer approval gate. All existing TE safety systems still apply.
 */

import { db } from "../db";
import { kevinCapabilities } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { recordKevinAuditEvent } from "./kevin-audit-service";

// ─── Capability catalogue ─────────────────────────────────────────────────────

export const KEVIN_CAPABILITIES = [
  "ceo_heartbeat_enrichment",
  "executive_briefing_context",
  "recommendation_context",
  "attention_inbox_signals",
  "environment_change_signals",
  "email_draft_assistance",
  "scheduling_assistance",
  "retention_assistance",
  "client_success_assistance",
  "engineering_signal_intake",
  "outcome_learning",
  "cross_application_context",
] as const;

export type KevinCapabilityName = (typeof KEVIN_CAPABILITIES)[number];

export const APPROVAL_MODE_ORDER = [
  "disabled",
  "observe",
  "recommend",
  "draft",
  "require_approval",
  "auto",
] as const;

export type ApprovalMode = (typeof APPROVAL_MODE_ORDER)[number];

export const CAPABILITY_DESCRIPTIONS: Record<KevinCapabilityName, string> = {
  ceo_heartbeat_enrichment:
    "Kevin provides historical context and prior incident patterns to enrich CEO Heartbeat signals.",
  executive_briefing_context:
    "Kevin supplies relevant decisions and architectural context to the Executive Agent before briefings.",
  recommendation_context:
    "Kevin provides historical patterns for high-value agent recommendations.",
  attention_inbox_signals:
    "Kevin can surface signals as items in the Attention Inbox (observe = signal stored but not routed).",
  environment_change_signals:
    "Kevin can send environment and infrastructure change signals to CEO Heartbeat.",
  email_draft_assistance:
    "Kevin can inform AgentMail draft context (draft mode = suggests, does not send).",
  scheduling_assistance:
    "Kevin provides scheduling pattern context to the Scheduling Agent.",
  retention_assistance:
    "Kevin provides historical churn patterns to the Retention Agent.",
  client_success_assistance:
    "Kevin provides prior client success patterns to the Client Success Agent.",
  engineering_signal_intake:
    "Kevin can submit engineering and architecture change signals for admin review.",
  outcome_learning:
    "TE forwards approval and rejection outcomes back to Kevin for learning.",
  cross_application_context:
    "Kevin may retrieve context across multiple TE domains (e.g. scheduling + revenue).",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modeIndex(mode: string): number {
  const idx = APPROVAL_MODE_ORDER.indexOf(mode as ApprovalMode);
  return idx === -1 ? 0 : idx;
}

export function isModeAtLeast(actual: string, minimum: ApprovalMode): boolean {
  return modeIndex(actual) >= modeIndex(minimum);
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

export type CapabilityRow = {
  id: string;
  orgId: string;
  capability: string;
  approvalMode: ApprovalMode;
  enabled: boolean;
  updatedBy: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
};

function toRow(r: typeof kevinCapabilities.$inferSelect): CapabilityRow {
  return {
    id: r.id,
    orgId: r.orgId,
    capability: r.capability,
    approvalMode: r.approvalMode as ApprovalMode,
    enabled: r.enabled,
    updatedBy: r.updatedBy ?? null,
    description:
      CAPABILITY_DESCRIPTIONS[r.capability as KevinCapabilityName] ??
      "Kevin capability",
    createdAt: r.createdAt?.toISOString?.() ?? "",
    updatedAt: r.updatedAt?.toISOString?.() ?? "",
  };
}

export async function getKevinCapability(
  orgId: string,
  capability: string,
): Promise<CapabilityRow | null> {
  try {
    const [row] = await db
      .select()
      .from(kevinCapabilities)
      .where(
        and(
          eq(kevinCapabilities.orgId, orgId),
          eq(kevinCapabilities.capability, capability),
        ),
      )
      .limit(1);
    return row ? toRow(row) : null;
  } catch {
    return null;
  }
}

export async function listKevinCapabilities(orgId: string): Promise<CapabilityRow[]> {
  try {
    const rows = await db
      .select()
      .from(kevinCapabilities)
      .where(eq(kevinCapabilities.orgId, orgId));
    return rows.map(toRow);
  } catch {
    return [];
  }
}

// ─── Policy check ─────────────────────────────────────────────────────────────

/**
 * Returns true if the capability is enabled AND its approval_mode meets
 * the minimum required mode.
 *
 * Fails closed: unknown capabilities return false.
 * Missing DB rows behave as `observe` (safe default).
 */
export async function isKevinCapabilityEnabled(
  orgId: string,
  capability: string,
  minimumMode: ApprovalMode = "observe",
): Promise<boolean> {
  if (!KEVIN_CAPABILITIES.includes(capability as KevinCapabilityName)) {
    return false; // unknown capability — fail closed
  }

  try {
    const row = await getKevinCapability(orgId, capability);
    if (!row) {
      // Missing row → treat as observe
      return isModeAtLeast("observe", minimumMode);
    }
    if (!row.enabled) return false;
    if (row.approvalMode === "disabled") return false;
    return isModeAtLeast(row.approvalMode, minimumMode);
  } catch {
    return false; // fail closed on DB error
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function setKevinCapabilityMode(input: {
  orgId: string;
  capability: string;
  approvalMode: ApprovalMode;
  enabled?: boolean;
  updatedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!KEVIN_CAPABILITIES.includes(input.capability as KevinCapabilityName)) {
    return { ok: false, error: "Unknown capability" };
  }
  if (!APPROVAL_MODE_ORDER.includes(input.approvalMode)) {
    return { ok: false, error: "Invalid approval mode" };
  }

  try {
    await db
      .insert(kevinCapabilities)
      .values({
        orgId: input.orgId,
        capability: input.capability,
        approvalMode: input.approvalMode,
        enabled: input.enabled !== false,
        updatedBy: input.updatedBy,
      })
      .onConflictDoUpdate({
        target: [kevinCapabilities.orgId, kevinCapabilities.capability],
        set: {
          approvalMode: input.approvalMode,
          enabled: input.enabled !== false,
          updatedBy: input.updatedBy,
          updatedAt: new Date(),
        },
      });

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "capability.updated",
      payload: {
        capability: input.capability,
        approvalMode: input.approvalMode,
        enabled: input.enabled !== false,
        updatedBy: input.updatedBy,
      },
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "DB error" };
  }
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Seed all known capabilities for an org with `observe` mode.
 * Uses upsert — never overwrites existing custom settings.
 */
export async function seedKevinCapabilitiesForOrg(orgId: string): Promise<void> {
  try {
    for (const cap of KEVIN_CAPABILITIES) {
      await db
        .insert(kevinCapabilities)
        .values({
          orgId,
          capability: cap,
          approvalMode: "observe",
          enabled: true,
          updatedBy: "system_seed",
        })
        .onConflictDoNothing();
    }
  } catch (e: any) {
    console.warn("[KevinCapabilities] seed error:", e?.message);
  }
}

/**
 * Seed capabilities for all active organizations.
 * Safe to run on startup.
 */
export async function seedKevinCapabilitiesForAllOrgs(): Promise<void> {
  try {
    const { db: dbInst } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const result = await dbInst.execute(sql`
      SELECT id FROM organizations WHERE active = true LIMIT 500
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    for (const row of rows) {
      await seedKevinCapabilitiesForOrg(row.id).catch(() => {});
    }
  } catch (e: any) {
    console.warn("[KevinCapabilities] global seed error:", e?.message);
  }
}
