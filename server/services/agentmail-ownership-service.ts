/**
 * AgentMail Ownership Service
 *
 * Authoritative source for the organization ↔ AgentMail inbox ownership relationship.
 * Every inbound routing decision and every outbound address selection must go through
 * this module. Nothing here is a fallback — if a record is missing, callers fail closed.
 *
 * Invariant:
 *   An inbound AgentMail event may create organization-owned state only when one
 *   authoritative active persisted AgentMail identity resolves to exactly one organization.
 *
 * Lifecycle: provisioning → active → disabled → retired
 * Only 'active' ownership permits inbound routing and outbound origination.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentMailRole =
  | "revenue"
  | "hiring"
  | "scheduling"
  | "support"
  | "operations"
  | "ceo";

export type OwnershipState = "provisioning" | "active" | "disabled" | "retired";

export interface OrgInboxRow {
  id: string;
  organizationId: string;
  role: AgentMailRole;
  username: string;
  emailAddress: string;
  providerInboxId: string | null;
  providerDomain: string | null;
  ownershipState: OwnershipState;
  provisionedAt: Date | null;
  activatedAt: Date | null;
  disabledAt: Date | null;
  retiredAt: Date | null;
  disableReason: string | null;
}

export type ResolveReason =
  | "resolved"
  | "no_ownership_record"
  | "ambiguous_ownership"
  | "inactive_ownership";

export type ResolveResult =
  | { orgId: string; role: AgentMailRole; reason: "resolved" }
  | { orgId: null; role: null; reason: Exclude<ResolveReason, "resolved"> };

export const AGENT_ROLES: AgentMailRole[] = [
  "revenue",
  "hiring",
  "scheduling",
  "support",
  "operations",
  "ceo",
];

// ─── DB helper ────────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Address construction ─────────────────────────────────────────────────────

/**
 * Build the immutable AgentMail routing username for an org+role pair.
 *
 * Scheme: {role}-{orgId_without_hyphens}
 * Example: "revenue-fef2c242f14c4537bc041813644b1c8c"
 *
 * Uses the full 128-bit UUID (32 hex chars) to maximise namespace uniqueness.
 * Local-part max: "operations-" (11) + 32 = 43 chars — well within the 64-char SMTP limit.
 * Characters are lowercase hex + hyphen — universally safe in email local-parts.
 * The orgId component is immutable (UUID never changes), making the address stable.
 */
export function buildOrgUsername(role: AgentMailRole, orgId: string): string {
  const hex = orgId.replace(/-/g, "").toLowerCase();
  return `${role}-${hex}`;
}

export function buildOrgEmailAddress(username: string, domain: string): string {
  return `${username}@${domain}`.toLowerCase();
}

export function getAgentMailDomain(): string {
  return (
    process.env.AGENTMAIL_ORG_DOMAIN ||
    process.env.AGENTMAIL_DOMAIN ||
    "agentmail.to"
  ).toLowerCase();
}

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

export async function ensureOwnershipTable(): Promise<void> {
  // Main ownership table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_agentmail_inboxes (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id   TEXT        NOT NULL,
      role              TEXT        NOT NULL,
      username          TEXT        NOT NULL,
      email_address     TEXT        NOT NULL,
      provider_inbox_id TEXT,
      provider_domain   TEXT,
      ownership_state   TEXT        NOT NULL DEFAULT 'provisioning',
      provisioned_at    TIMESTAMPTZ,
      activated_at      TIMESTAMPTZ,
      disabled_at       TIMESTAMPTZ,
      retired_at        TIMESTAMPTZ,
      disable_reason    TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, role),
      UNIQUE (email_address),
      UNIQUE (username)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_org
    ON org_agentmail_inboxes (organization_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_email
    ON org_agentmail_inboxes (email_address)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_state
    ON org_agentmail_inboxes (ownership_state)
  `);

  // Migrate agent_mail_inbound_messages:
  //   1. Make organization_id nullable (quarantined messages have no owner)
  //   2. Add routing columns
  await db.execute(sql`
    ALTER TABLE agent_mail_inbound_messages
    ALTER COLUMN organization_id DROP NOT NULL
  `).catch(() => {}); // no-op if already nullable or table missing

  await db.execute(sql`
    ALTER TABLE agent_mail_inbound_messages
    ADD COLUMN IF NOT EXISTS routing_status TEXT NOT NULL DEFAULT 'routed'
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE agent_mail_inbound_messages
    ADD COLUMN IF NOT EXISTS routing_reason TEXT
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE agent_mail_inbound_messages
    ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_routing
    ON agent_mail_inbound_messages (routing_status)
  `).catch(() => {});
}

// ─── Inbound routing — the authoritative resolver ─────────────────────────────

/**
 * Resolve the owning organization for an inbound AgentMail message.
 *
 * Rules (all must pass):
 *   1. Exactly one row in org_agentmail_inboxes matches the normalized email_address.
 *   2. That row has ownership_state = 'active'.
 *
 * Returns { orgId, role, reason: "resolved" } on success.
 * Returns { orgId: null, role: null, reason: <why> } on any failure — caller quarantines.
 * Never returns a default/fallback organization.
 */
export async function resolveOrgFromInbox(toEmail: string): Promise<ResolveResult> {
  // Normalize and strip display-name wrapper if present ("Name <addr@domain>" → "addr@domain")
  const raw = toEmail.toLowerCase().trim();
  const angleMatch = raw.match(/<([^>]+)>/);
  const address = (angleMatch ? angleMatch[1] : raw).trim();

  let result: any[];
  try {
    // LIMIT 2 exposes ambiguity; the UNIQUE constraint prevents it, but we defend in-depth.
    result = rows(
      await db.execute(sql`
        SELECT organization_id, role, ownership_state
        FROM org_agentmail_inboxes
        WHERE email_address = ${address}
        LIMIT 2
      `),
    );
  } catch (err: any) {
    console.error("[AgentMail Ownership] resolveOrgFromInbox DB error:", err?.message);
    return { orgId: null, role: null, reason: "no_ownership_record" };
  }

  if (result.length === 0) {
    return { orgId: null, role: null, reason: "no_ownership_record" };
  }
  if (result.length > 1) {
    console.error(
      "[AgentMail Ownership] INVARIANT VIOLATION: multiple ownership records for address:",
      address,
    );
    return { orgId: null, role: null, reason: "ambiguous_ownership" };
  }

  const row = result[0];
  if (row.ownership_state !== "active") {
    return { orgId: null, role: null, reason: "inactive_ownership" };
  }

  return {
    orgId: row.organization_id,
    role: row.role as AgentMailRole,
    reason: "resolved",
  };
}

// ─── Outbound address lookup ──────────────────────────────────────────────────

/**
 * Return the active from-address for an org+role pair.
 * Returns null if no active record exists — caller must fail closed (no send).
 */
export async function getActiveOutboundAddress(
  orgId: string,
  role: AgentMailRole,
): Promise<string | null> {
  try {
    const result = rows(
      await db.execute(sql`
        SELECT email_address
        FROM org_agentmail_inboxes
        WHERE organization_id = ${orgId}
          AND role            = ${role}
          AND ownership_state = 'active'
        LIMIT 1
      `),
    );
    return result[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

export interface ProvisionRoleResult {
  role: AgentMailRole;
  username: string;
  emailAddress: string;
  status: "created" | "already_provisioned" | "failed";
  providerInboxId: string | null;
  error?: string;
}

export interface ProvisionOrgResult {
  organizationId: string;
  domain: string;
  roles: ProvisionRoleResult[];
  allProvisioned: boolean;
}

/**
 * Provision AgentMail role inboxes for one organization.
 *
 * For each of the six roles:
 *   1. Checks DB — skips if already provisioned (idempotent).
 *   2. Creates the inbox at the AgentMail provider.
 *   3. Persists the authoritative ownership row (state = 'provisioning').
 *
 * Does NOT activate ownership — call activateOrgInboxes() after verification.
 * Safe to re-run: existing rows are skipped with status "already_provisioned".
 * On provider failure the role is reported as "failed" and the script continues.
 */
export async function provisionOrgInboxes(
  orgId: string,
  opts: { autoActivate?: boolean } = {},
): Promise<ProvisionOrgResult> {
  // Lazy import avoids circular dependency with agentmail-service.ts
  const { createOrVerifyInbox } = await import("./agentmail-service");
  const domain = getAgentMailDomain();
  const roleResults: ProvisionRoleResult[] = [];

  for (const role of AGENT_ROLES) {
    const username = buildOrgUsername(role, orgId);
    const emailAddress = buildOrgEmailAddress(username, domain);

    // Check if already provisioned
    try {
      const existing = rows(
        await db.execute(sql`
          SELECT id FROM org_agentmail_inboxes
          WHERE organization_id = ${orgId} AND role = ${role}
          LIMIT 1
        `),
      );
      if (existing.length > 0) {
        roleResults.push({
          role,
          username,
          emailAddress,
          status: "already_provisioned",
          providerInboxId: null,
        });
        continue;
      }
    } catch (err: any) {
      roleResults.push({
        role,
        username,
        emailAddress,
        status: "failed",
        providerInboxId: null,
        error: `DB check failed: ${err?.message}`,
      });
      continue;
    }

    // Create at provider (createOrVerifyInbox uses the config domain;
    // we pass the org-specific username as the local-part)
    try {
      const providerResult = await createOrVerifyInbox(username);
      const providerInboxId: string | null =
        providerResult.ok ? ((providerResult.inbox as any)?.id ?? null) : null;
      const providerDomain: string | null =
        providerResult.ok ? ((providerResult.inbox as any)?.domain ?? domain) : null;

      if (!providerResult.ok && !providerResult.inbox) {
        roleResults.push({
          role,
          username,
          emailAddress,
          status: "failed",
          providerInboxId: null,
          error: providerResult.error ?? "Provider returned no inbox",
        });
        continue;
      }

      const state = opts.autoActivate ? "active" : "provisioning";
      await db.execute(sql`
        INSERT INTO org_agentmail_inboxes (
          id, organization_id, role, username, email_address,
          provider_inbox_id, provider_domain, ownership_state,
          provisioned_at, activated_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text,
          ${orgId}, ${role}, ${username}, ${emailAddress},
          ${providerInboxId}, ${providerDomain ?? domain}, ${state},
          NOW(),
          ${opts.autoActivate ? sql`NOW()` : sql`NULL`},
          NOW(), NOW()
        )
        ON CONFLICT (organization_id, role) DO NOTHING
      `);

      roleResults.push({ role, username, emailAddress, status: "created", providerInboxId });
    } catch (err: any) {
      roleResults.push({
        role,
        username,
        emailAddress,
        status: "failed",
        providerInboxId: null,
        error: err?.message,
      });
    }
  }

  const allProvisioned = roleResults.every(
    (r) => r.status === "created" || r.status === "already_provisioned",
  );
  return { organizationId: orgId, domain, roles: roleResults, allProvisioned };
}

// ─── Lifecycle management ─────────────────────────────────────────────────────

/** Activate all provisioning-state inboxes for an org (call after verification). */
export async function activateOrgInboxes(orgId: string): Promise<void> {
  await db.execute(sql`
    UPDATE org_agentmail_inboxes
    SET ownership_state = 'active',
        activated_at    = NOW(),
        updated_at      = NOW()
    WHERE organization_id = ${orgId}
      AND ownership_state = 'provisioning'
  `);
}

/** Disable one role inbox for an org. Inbound mail to this address quarantines. */
export async function disableOrgInbox(
  orgId: string,
  role: AgentMailRole,
  reason: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE org_agentmail_inboxes
    SET ownership_state = 'disabled',
        disabled_at     = NOW(),
        disable_reason  = ${reason},
        updated_at      = NOW()
    WHERE organization_id = ${orgId}
      AND role            = ${role}
      AND ownership_state = 'active'
  `);
}

/** Retire one role inbox. Permanent — cannot be re-activated. */
export async function retireOrgInbox(orgId: string, role: AgentMailRole): Promise<void> {
  await db.execute(sql`
    UPDATE org_agentmail_inboxes
    SET ownership_state = 'retired',
        retired_at      = NOW(),
        updated_at      = NOW()
    WHERE organization_id = ${orgId}
      AND role            = ${role}
  `);
}

/** Retire all active/disabled inboxes for an org. Does not affect other orgs. */
export async function retireAllOrgInboxes(orgId: string): Promise<void> {
  await db.execute(sql`
    UPDATE org_agentmail_inboxes
    SET ownership_state = 'retired',
        retired_at      = NOW(),
        updated_at      = NOW()
    WHERE organization_id = ${orgId}
      AND ownership_state IN ('active', 'disabled')
  `);
}

// ─── Verification ─────────────────────────────────────────────────────────────

export interface VerifyRoleResult {
  role: AgentMailRole;
  emailAddress: string;
  dbState: OwnershipState | "missing";
  providerExists: boolean | null; // null = provider check skipped/errored
  verified: boolean;
}

export interface VerifyOrgResult {
  organizationId: string;
  domain: string;
  roles: VerifyRoleResult[];
  allVerified: boolean;
}

/**
 * Verify that an org's AgentMail inboxes exist in both the DB (as 'active') and
 * at the provider. Returns a per-role breakdown. Does not mutate anything.
 */
export async function verifyOrgInboxProvisioning(orgId: string): Promise<VerifyOrgResult> {
  const { verifyInboxExists } = await import("./agentmail-service");
  const domain = getAgentMailDomain();

  const dbRows = rows(
    await db.execute(sql`
      SELECT role, email_address, ownership_state
      FROM org_agentmail_inboxes
      WHERE organization_id = ${orgId}
    `).catch(() => [] as any),
  );
  const dbByRole = Object.fromEntries(dbRows.map((r: any) => [r.role, r]));

  const roleResults: VerifyRoleResult[] = await Promise.all(
    AGENT_ROLES.map(async (role) => {
      const username = buildOrgUsername(role, orgId);
      const emailAddress = buildOrgEmailAddress(username, domain);
      const dbRow = dbByRole[role];
      const dbState: OwnershipState | "missing" = dbRow?.ownership_state ?? "missing";

      let providerExists: boolean | null = null;
      try {
        providerExists = await verifyInboxExists(emailAddress);
      } catch {
        providerExists = null;
      }

      return {
        role,
        emailAddress,
        dbState,
        providerExists,
        verified: dbState === "active" && providerExists === true,
      };
    }),
  );

  return {
    organizationId: orgId,
    domain,
    roles: roleResults,
    allVerified: roleResults.every((r) => r.verified),
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function listOrgInboxes(orgId: string): Promise<OrgInboxRow[]> {
  const result = rows(
    await db.execute(sql`
      SELECT id, organization_id, role, username, email_address,
             provider_inbox_id, provider_domain, ownership_state,
             provisioned_at, activated_at, disabled_at, retired_at, disable_reason
      FROM org_agentmail_inboxes
      WHERE organization_id = ${orgId}
      ORDER BY role
    `).catch(() => [] as any),
  );
  return result.map(mapRow);
}

/** Count how many orgs have at least one active AgentMail inbox. */
export async function countProvisionedOrgs(): Promise<number> {
  const result = rows(
    await db.execute(sql`
      SELECT COUNT(DISTINCT organization_id) AS n
      FROM org_agentmail_inboxes
      WHERE ownership_state = 'active'
    `).catch(() => [] as any),
  );
  return Number(result[0]?.n ?? 0);
}

function mapRow(r: any): OrgInboxRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    role: r.role as AgentMailRole,
    username: r.username,
    emailAddress: r.email_address,
    providerInboxId: r.provider_inbox_id ?? null,
    providerDomain: r.provider_domain ?? null,
    ownershipState: r.ownership_state as OwnershipState,
    provisionedAt: r.provisioned_at ? new Date(r.provisioned_at) : null,
    activatedAt: r.activated_at ? new Date(r.activated_at) : null,
    disabledAt: r.disabled_at ? new Date(r.disabled_at) : null,
    retiredAt: r.retired_at ? new Date(r.retired_at) : null,
    disableReason: r.disable_reason ?? null,
  };
}
