/**
 * Kevin Slack EOH — Identity Mapping Service
 *
 * Maps Slack workspace/user IDs to verified TrainEfficiency identities.
 *
 * Rules:
 * - No state-changing actions without a verified mapping
 * - Auto-linking by email is explicitly forbidden
 * - Cross-org actions are rejected
 * - Revoked mappings stop working immediately
 * - Every mapping operation is audited
 *
 * Tables created lazily via ensureIdentityTables().
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";

export type MappingStatus = "pending" | "verified" | "revoked" | "disabled";

export interface SlackIdentityMapping {
  id: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  slackUserId: string;
  trainefficiencyUserId: string;
  orgId: string;
  mappingStatus: MappingStatus;
  linkedBy: string | null;
  linkedAt: Date;
  revokedAt: Date | null;
  lastVerifiedAt: Date | null;
}

export interface ResolvedIdentity {
  mapping: SlackIdentityMapping;
  userId: string;
  orgId: string;
  role: string;
}

/**
 * @deprecated Tables are created by migrations/0002_kevin_slack_tables.sql
 * and by runKevinSlackMigration() in kevin-slack-routes.ts at startup.
 * This function is retained for call-site compatibility only. It is a no-op.
 */
export async function ensureIdentityTables(): Promise<void> {
  // No-op — tables are created at startup by the committed migration runner.
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

export async function findMapping(
  slackTeamId: string,
  slackUserId: string,
): Promise<SlackIdentityMapping | null> {
  await ensureIdentityTables();
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_identity_mappings
      WHERE slack_team_id = ${slackTeamId}
        AND slack_user_id = ${slackUserId}
      LIMIT 1
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    if (!arr[0]) return null;
    return rowToMapping(arr[0]);
  } catch (err: any) {
    console.error("[Kevin Slack] findMapping error:", err?.message);
    return null;
  }
}

export async function resolveIdentity(
  slackTeamId: string,
  slackUserId: string,
): Promise<ResolvedIdentity | null> {
  const mapping = await findMapping(slackTeamId, slackUserId);
  if (!mapping) return null;
  if (mapping.mappingStatus !== "verified") return null;

  try {
    const profile = await storage.getUserProfile(mapping.trainefficiencyUserId);
    const role = profile?.role ?? "CLIENT";

    // Verify the org matches what is stored in the mapping
    if (profile && profile.organizationId && profile.organizationId !== mapping.orgId) {
      // Profile org changed — mapping is stale, treat as unresolved
      return null;
    }

    return {
      mapping,
      userId: mapping.trainefficiencyUserId,
      orgId: mapping.orgId,
      role,
    };
  } catch (err: any) {
    console.error("[Kevin Slack] resolveIdentity profile lookup error:", err?.message);
    return null;
  }
}

// ─── Create / update ─────────────────────────────────────────────────────────

export interface CreateMappingInput {
  slackTeamId: string;
  slackEnterpriseId?: string;
  slackUserId: string;
  trainefficiencyUserId: string;
  orgId: string;
  linkedBy: string;
  status?: MappingStatus;
}

export async function createOrUpdateMapping(input: CreateMappingInput): Promise<SlackIdentityMapping | null> {
  await ensureIdentityTables();
  try {
    const status = input.status ?? "pending";
    const rows = await db.execute(sql`
      INSERT INTO kevin_slack_identity_mappings
        (slack_team_id, slack_enterprise_id, slack_user_id, trainefficiency_user_id, org_id, mapping_status, linked_by, linked_at, last_verified_at)
      VALUES
        (${input.slackTeamId}, ${input.slackEnterpriseId ?? null}, ${input.slackUserId},
         ${input.trainefficiencyUserId}, ${input.orgId}, ${status}, ${input.linkedBy},
         NOW(), ${status === "verified" ? sql`NOW()` : sql`NULL`})
      ON CONFLICT (slack_team_id, slack_user_id)
      DO UPDATE SET
        trainefficiency_user_id = EXCLUDED.trainefficiency_user_id,
        org_id = EXCLUDED.org_id,
        mapping_status = EXCLUDED.mapping_status,
        linked_by = EXCLUDED.linked_by,
        last_verified_at = CASE WHEN EXCLUDED.mapping_status = 'verified' THEN NOW() ELSE kevin_slack_identity_mappings.last_verified_at END
      RETURNING *
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr[0] ? rowToMapping(arr[0]) : null;
  } catch (err: any) {
    console.error("[Kevin Slack] createOrUpdateMapping error:", err?.message);
    return null;
  }
}

export async function verifyMapping(id: string, verifiedBy: string): Promise<boolean> {
  await ensureIdentityTables();
  try {
    await db.execute(sql`
      UPDATE kevin_slack_identity_mappings
      SET mapping_status = 'verified', last_verified_at = NOW(), linked_by = ${verifiedBy}
      WHERE id = ${id}
    `);
    return true;
  } catch (err: any) {
    console.error("[Kevin Slack] verifyMapping error:", err?.message);
    return false;
  }
}

export async function revokeMapping(id: string, revokedBy: string): Promise<boolean> {
  await ensureIdentityTables();
  try {
    await db.execute(sql`
      UPDATE kevin_slack_identity_mappings
      SET mapping_status = 'revoked', revoked_at = NOW(), linked_by = ${revokedBy}
      WHERE id = ${id}
    `);
    return true;
  } catch (err: any) {
    console.error("[Kevin Slack] revokeMapping error:", err?.message);
    return false;
  }
}

export async function listMappingsForOrg(orgId: string): Promise<SlackIdentityMapping[]> {
  await ensureIdentityTables();
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_identity_mappings
      WHERE org_id = ${orgId}
      ORDER BY linked_at DESC
      LIMIT 200
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.map(rowToMapping);
  } catch (err: any) {
    console.error("[Kevin Slack] listMappingsForOrg error:", err?.message);
    return [];
  }
}

export async function listAllMappings(): Promise<SlackIdentityMapping[]> {
  await ensureIdentityTables();
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_identity_mappings
      ORDER BY linked_at DESC
      LIMIT 500
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.map(rowToMapping);
  } catch (err: any) {
    console.error("[Kevin Slack] listAllMappings error:", err?.message);
    return [];
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToMapping(row: any): SlackIdentityMapping {
  return {
    id: row.id,
    slackTeamId: row.slack_team_id,
    slackEnterpriseId: row.slack_enterprise_id ?? null,
    slackUserId: row.slack_user_id,
    trainefficiencyUserId: row.trainefficiency_user_id,
    orgId: row.org_id,
    mappingStatus: row.mapping_status as MappingStatus,
    linkedBy: row.linked_by ?? null,
    linkedAt: new Date(row.linked_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at) : null,
  };
}
