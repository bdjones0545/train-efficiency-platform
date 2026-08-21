/**
 * AgentMail Ownership Service
 *
 * Authoritative source for the organization ↔ AgentMail inbox ownership relationship.
 * Every inbound routing decision and every outbound address selection must go through
 * this module. Nothing here is a fallback — if a record is missing, callers fail closed.
 *
 * Invariant:
 *   An inbound AgentMail event may create organization-owned state only when one
 *   authoritative active persisted AgentMail identity resolves to exactly one organization,
 *   AND the provider inbox ID (from the event) matches the ownership record.
 *
 * Lifecycle: provisioning → active → disabled → retired
 * Only 'active' ownership permits inbound routing and outbound origination.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { runAgentMailMigration } from "./agentmail-migration";

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
  | "inactive_ownership"
  | "provider_id_mismatch";

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

// ─── Schema bootstrap (delegates to deterministic migration) ──────────────────

/**
 * Kept for backward compatibility; delegates to runAgentMailMigration().
 * New code should call runAgentMailMigration() directly.
 */
export async function ensureOwnershipTable(): Promise<void> {
  await runAgentMailMigration();
}

// ─── Inbound routing — primary resolver using provider inbox ID ───────────────

/**
 * Resolve the owning organization for an inbound message using the provider
 * inbox ID as the PRIMARY trusted identity.  The destination address is used
 * as corroborating evidence.
 *
 * Rules (all must pass):
 *   1. Exactly one active row in org_agentmail_inboxes matches provider_inbox_id.
 *   2. That row's email_address matches the normalized destination address.
 *   3. ownership_state = 'active'.
 *
 * If provider inbox ID and destination address disagree → fail closed → quarantine.
 * Never returns a default/fallback organization.
 */
export async function resolveOrgByProviderInboxId(
  providerInboxId: string,
  toAddress: string,
): Promise<ResolveResult> {
  let result: any[];
  try {
    result = rows(
      await db.execute(sql`
        SELECT organization_id, role, email_address, ownership_state
        FROM org_agentmail_inboxes
        WHERE provider_inbox_id = ${providerInboxId}
        LIMIT 2
      `),
    );
  } catch (err: any) {
    console.error("[AgentMail Ownership] resolveOrgByProviderInboxId DB error:", err?.message);
    return { orgId: null, role: null, reason: "no_ownership_record" };
  }

  if (result.length === 0) {
    return { orgId: null, role: null, reason: "no_ownership_record" };
  }
  if (result.length > 1) {
    console.error(
      "[AgentMail Ownership] INVARIANT VIOLATION: multiple ownership records for provider_inbox_id:",
      providerInboxId,
    );
    return { orgId: null, role: null, reason: "ambiguous_ownership" };
  }

  const row = result[0];

  if (row.ownership_state !== "active") {
    return { orgId: null, role: null, reason: "inactive_ownership" };
  }

  // Corroborate: provider inbox ID resolves to this address; destination must match.
  const normalizedTo = normalizeAddress(toAddress);
  const expectedAddr = (row.email_address as string).toLowerCase().trim();

  if (normalizedTo !== expectedAddr) {
    console.error(
      "[AgentMail Ownership] Provider inbox ID / destination address mismatch:",
      { providerInboxId, resolvedAddress: expectedAddr, eventDestination: normalizedTo },
    );
    return { orgId: null, role: null, reason: "provider_id_mismatch" };
  }

  return {
    orgId: row.organization_id,
    role: row.role as AgentMailRole,
    reason: "resolved",
  };
}

/**
 * Resolve the owning organization for an inbound AgentMail message by
 * destination address alone (used when provider_inbox_id is unavailable).
 *
 * Rules:
 *   1. Exactly one row in org_agentmail_inboxes matches the normalized email_address.
 *   2. That row has ownership_state = 'active'.
 *
 * Returns { orgId, role, reason: "resolved" } on success.
 * Returns { orgId: null, role: null, reason: <why> } on any failure.
 * Never returns a default/fallback organization.
 */
export async function resolveOrgFromInbox(toEmail: string): Promise<ResolveResult> {
  const address = normalizeAddress(toEmail);

  let result: any[];
  try {
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

// ─── Outbound identity lookup ─────────────────────────────────────────────────

/**
 * Return the active ownership row (email + providerInboxId) for an org+role pair.
 * Returns null if no active record with a provider_inbox_id exists.
 * Caller must fail closed — no send if this returns null.
 */
export async function getActiveOwnershipRow(
  orgId: string,
  role: AgentMailRole,
): Promise<{ emailAddress: string; providerInboxId: string } | null> {
  try {
    const result = rows(
      await db.execute(sql`
        SELECT email_address, provider_inbox_id
        FROM org_agentmail_inboxes
        WHERE organization_id = ${orgId}
          AND role            = ${role}
          AND ownership_state = 'active'
          AND provider_inbox_id IS NOT NULL
        LIMIT 1
      `),
    );
    const row = result[0];
    if (!row?.email_address || !row?.provider_inbox_id) return null;
    return { emailAddress: row.email_address as string, providerInboxId: row.provider_inbox_id as string };
  } catch {
    return null;
  }
}

/**
 * Return the active from-address for an org+role pair.
 * @deprecated Use getActiveOwnershipRow() which also returns provider_inbox_id.
 */
export async function getActiveOutboundAddress(
  orgId: string,
  role: AgentMailRole,
): Promise<string | null> {
  const row = await getActiveOwnershipRow(orgId, role);
  return row?.emailAddress ?? null;
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

export interface ProvisionRoleResult {
  role: AgentMailRole;
  username: string;
  emailAddress: string;
  status: "created" | "already_provisioned" | "reconciled" | "failed";
  providerInboxId: string | null;
  error?: string;
}

export interface ProvisionOrgResult {
  organizationId: string;
  domain: string;
  roles: ProvisionRoleResult[];
  allProvisioned: boolean;
}

export interface AgentMailOwnershipProvider {
  createOrVerifyInbox: (username: string, clientId: string) => Promise<any>;
  verifyInboxExists: (emailAddress: string) => Promise<{ exists: boolean; inboxId?: string; email?: string }>;
  afterProviderProvision?: (context: { orgId: string; role: AgentMailRole; providerInboxId: string }) => Promise<void>;
}

/**
 * Provision AgentMail role inboxes for one organization.
 *
 * For each role:
 *   1. Checks DB — if row exists with a provider_inbox_id, skips (idempotent).
 *   2. If row exists WITHOUT a provider_inbox_id (crashed/partial provision),
 *      reconciles by re-fetching from the provider using client_id.
 *   3. Creates the inbox at the AgentMail provider using client_id for idempotency
 *      (the provider returns the existing inbox if client_id already exists).
 *   4. Persists the authoritative ownership row (state = 'provisioning').
 *
 * Does NOT activate ownership — call activateOrgInboxes() after verification.
 *
 * @param orgId    Target organization.
 * @param roles    Optional filter — defaults to all AGENT_ROLES.
 */
export async function provisionOrgInboxes(
  orgId: string,
  roles?: AgentMailRole[],
  providerOverride?: Pick<AgentMailOwnershipProvider, "createOrVerifyInbox" | "afterProviderProvision">,
): Promise<ProvisionOrgResult> {
  const { createOrVerifyInbox: defaultCreateOrVerifyInbox } = await import("./agentmail-service");
  const createOrVerifyInbox = providerOverride?.createOrVerifyInbox ?? defaultCreateOrVerifyInbox;
  const domain = getAgentMailDomain();
  const targetRoles = (roles && roles.length > 0) ? validateRoles(roles) : AGENT_ROLES;
  const roleResults: ProvisionRoleResult[] = [];

  for (const role of targetRoles) {
    const username = buildOrgUsername(role, orgId);
    const emailAddress = buildOrgEmailAddress(username, domain);
    const clientId = `te-${orgId}-${role}`;

    // Check if already provisioned with a provider_inbox_id
    let existingRow: any | null = null;
    try {
      const existing = rows(
        await db.execute(sql`
          SELECT id, provider_inbox_id FROM org_agentmail_inboxes
          WHERE organization_id = ${orgId} AND role = ${role}
          LIMIT 1
        `),
      );
      existingRow = existing[0] ?? null;
    } catch (err: any) {
      roleResults.push({ role, username, emailAddress, status: "failed", providerInboxId: null, error: `DB check failed: ${err?.message}` });
      continue;
    }

    if (existingRow?.provider_inbox_id) {
      // Fully provisioned — skip
      roleResults.push({ role, username, emailAddress, status: "already_provisioned", providerInboxId: existingRow.provider_inbox_id });
      continue;
    }

    // Create or fetch from provider (client_id makes this idempotent)
    try {
      const providerResult = await createOrVerifyInbox(username, clientId);

      if (!providerResult.ok) {
        roleResults.push({ role, username, emailAddress, status: "failed", providerInboxId: null, error: providerResult.error ?? "Provider returned error" });
        continue;
      }

      // The correct field per AgentMail API is inbox_id (verified from docs)
      const providerInboxId: string | null = (providerResult.inbox as any)?.inbox_id ?? null;
      const providerDomain: string | null = (providerResult.inbox as any)?.domain ?? domain;

      if (!providerInboxId) {
        roleResults.push({ role, username, emailAddress, status: "failed", providerInboxId: null, error: "Provider returned no inbox_id" });
        continue;
      }

      await providerOverride?.afterProviderProvision?.({ orgId, role, providerInboxId });

      if (existingRow) {
        // Row exists but was missing provider_inbox_id — reconcile
        await db.execute(sql`
          UPDATE org_agentmail_inboxes
          SET provider_inbox_id = ${providerInboxId},
              provider_domain   = ${providerDomain ?? domain},
              updated_at        = NOW()
          WHERE id = ${existingRow.id}
        `);
        roleResults.push({ role, username, emailAddress, status: "reconciled", providerInboxId });
      } else {
        // Fresh insert
        await db.execute(sql`
          INSERT INTO org_agentmail_inboxes (
            id, organization_id, role, username, email_address,
            provider_inbox_id, provider_domain, ownership_state,
            provisioned_at, created_at, updated_at
          ) VALUES (
            gen_random_uuid()::text,
            ${orgId}, ${role}, ${username}, ${emailAddress},
            ${providerInboxId}, ${providerDomain ?? domain}, 'provisioning',
            NOW(), NOW(), NOW()
          )
          ON CONFLICT (organization_id, role) DO UPDATE
            SET provider_inbox_id = EXCLUDED.provider_inbox_id,
                provider_domain   = EXCLUDED.provider_domain,
                updated_at        = NOW()
        `);
        roleResults.push({ role, username, emailAddress, status: "created", providerInboxId });
      }
    } catch (err: any) {
      roleResults.push({ role, username, emailAddress, status: "failed", providerInboxId: null, error: err?.message });
    }
  }

  const allProvisioned = roleResults.every(
    (r) => r.status === "created" || r.status === "already_provisioned" || r.status === "reconciled",
  );
  return { organizationId: orgId, domain, roles: roleResults, allProvisioned };
}

// ─── Lifecycle management ─────────────────────────────────────────────────────

export interface ActivateRoleResult {
  role: AgentMailRole;
  emailAddress: string;
  status: "activated" | "already_active" | "skipped_no_provider_id" | "skipped_verify_failed" | "skipped_not_found" | "skipped_wrong_org";
  providerInboxId: string | null;
  reason?: string;
}

export interface ActivateOrgResult {
  organizationId: string;
  roles: ActivateRoleResult[];
  allActivated: boolean;
}

/**
 * Activate org inboxes with pre-activation verification gate.
 *
 * Before an inbox becomes 'active':
 *   1. Must have a persisted provider_inbox_id.
 *   2. Provider must confirm the inbox exists.
 *   3. Provider-returned email must match the ownership record.
 *   4. Row must still belong to this org (no cross-org tampering).
 *
 * Inboxes that fail any check remain 'provisioning' — never silently promoted.
 *
 * @param orgId    Target organization.
 * @param roles    Optional filter — defaults to all provisioning-state inboxes.
 */
export async function activateOrgInboxes(
  orgId: string,
  roles?: AgentMailRole[],
  providerOverride?: Pick<AgentMailOwnershipProvider, "verifyInboxExists">,
): Promise<ActivateOrgResult> {
  const { verifyInboxExists: defaultVerifyInboxExists } = await import("./agentmail-service");
  const verifyInboxExists = providerOverride?.verifyInboxExists ?? defaultVerifyInboxExists;
  const domain = getAgentMailDomain();

  // Fetch rows that are candidates for activation
  const candidateRows = rows(
    await db.execute(sql`
      SELECT id, role, email_address, provider_inbox_id, ownership_state, organization_id
      FROM org_agentmail_inboxes
      WHERE organization_id = ${orgId}
        AND ownership_state IN ('provisioning', 'active')
    `).catch(() => [] as any),
  );

  const targetRoles = (roles && roles.length > 0) ? validateRoles(roles) : null;
  const results: ActivateRoleResult[] = [];

  for (const row of candidateRows) {
    const role = row.role as AgentMailRole;
    if (targetRoles && !targetRoles.includes(role)) continue;

    const emailAddress: string = row.email_address;
    const providerInboxId: string | null = row.provider_inbox_id ?? null;

    // Already active — no-op
    if (row.ownership_state === "active") {
      results.push({ role, emailAddress, status: "already_active", providerInboxId });
      continue;
    }

    // Gate 1: must have a persisted provider_inbox_id
    if (!providerInboxId) {
      results.push({ role, emailAddress, status: "skipped_no_provider_id", providerInboxId: null, reason: "Run provisionOrgInboxes first" });
      continue;
    }

    // Gate 2: org ownership check (row must belong to this org)
    if (row.organization_id !== orgId) {
      results.push({ role, emailAddress, status: "skipped_wrong_org", providerInboxId, reason: "Organization mismatch" });
      continue;
    }

    // Gate 3: verify provider
    let verification: { exists: boolean; inboxId?: string; email?: string } = { exists: false };
    try {
      verification = await verifyInboxExists(emailAddress);
    } catch (err: any) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: `Verification error: ${err?.message}` });
      continue;
    }

    if (!verification.exists) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: "Provider inbox not found" });
      continue;
    }

    // Gate 4: provider must return an email address (all identity evidence required)
    if (!verification.email) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: "Provider returned no email address — all identity fields required for activation" });
      continue;
    }

    // Gate 5: returned address must exactly match persisted normalized address
    if (verification.email.toLowerCase() !== emailAddress.toLowerCase()) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: `Provider address mismatch: ${verification.email} ≠ ${emailAddress}` });
      continue;
    }

    // Gate 6: provider must return an inbox_id (all identity evidence required)
    if (!verification.inboxId) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: "Provider returned no inbox_id — all identity fields required for activation" });
      continue;
    }

    // Gate 7: returned inbox_id must exactly equal the persisted provider_inbox_id
    if (verification.inboxId !== providerInboxId) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: `Provider inbox ID mismatch: ${verification.inboxId} ≠ ${providerInboxId}` });
      continue;
    }

    // All gates passed — activate
    try {
      await db.execute(sql`
        UPDATE org_agentmail_inboxes
        SET ownership_state = 'active',
            activated_at    = NOW(),
            updated_at      = NOW()
        WHERE id              = ${row.id}
          AND organization_id = ${orgId}
          AND ownership_state = 'provisioning'
      `);
      results.push({ role, emailAddress, status: "activated", providerInboxId });
    } catch (err: any) {
      results.push({ role, emailAddress, status: "skipped_verify_failed", providerInboxId, reason: `DB update failed: ${err?.message}` });
    }
  }

  // Any requested roles with no candidate rows
  if (targetRoles) {
    const covered = new Set(results.map((r) => r.role));
    for (const role of targetRoles) {
      if (!covered.has(role)) {
        const username = buildOrgUsername(role, orgId);
        results.push({ role, emailAddress: buildOrgEmailAddress(username, domain), status: "skipped_not_found", providerInboxId: null, reason: "No ownership row found" });
      }
    }
  }

  return {
    organizationId: orgId,
    roles: results,
    allActivated: results.length > 0 && results.every((r) => r.status === "activated" || r.status === "already_active"),
  };
}

/** Disable one role inbox for an org. Inbound mail to this address quarantines. */
export async function disableOrgInbox(
  orgId: string,
  role: AgentMailRole,
  reason: string = "admin_disabled",
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
      AND ownership_state IN ('active', 'disabled', 'provisioning')
  `);
}

// ─── Verification ─────────────────────────────────────────────────────────────

export interface VerifyRoleResult {
  role: AgentMailRole;
  emailAddress: string;
  dbState: OwnershipState | "missing";
  providerInboxId: string | null;
  providerExists: boolean | null; // null = check errored
  providerIdMatch: boolean | null; // null = not checked
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
 * at the provider, and that the provider inbox ID matches what we stored.
 */
export async function verifyOrgInboxProvisioning(orgId: string): Promise<VerifyOrgResult> {
  const { verifyInboxExists } = await import("./agentmail-service");
  const domain = getAgentMailDomain();

  const dbRows = rows(
    await db.execute(sql`
      SELECT role, email_address, ownership_state, provider_inbox_id
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
      const storedProviderInboxId: string | null = dbRow?.provider_inbox_id ?? null;

      let providerExists: boolean | null = null;
      let providerIdMatch: boolean | null = null;

      try {
        const v = await verifyInboxExists(emailAddress);
        providerExists = v.exists;
        if (v.exists && storedProviderInboxId && v.inboxId) {
          providerIdMatch = v.inboxId === storedProviderInboxId;
        } else if (v.exists && storedProviderInboxId) {
          providerIdMatch = null; // provider didn't return ID
        }
      } catch {
        providerExists = null;
      }

      return {
        role,
        emailAddress,
        dbState,
        providerInboxId: storedProviderInboxId,
        providerExists,
        providerIdMatch,
        verified:
          dbState === "active" &&
          storedProviderInboxId !== null &&
          providerExists === true &&
          (providerIdMatch !== false), // null is OK (provider didn't return ID to compare)
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Normalize an RFC 2822 address to a plain lowercase email string. */
function normalizeAddress(raw: string): string {
  const s = (raw ?? "").toLowerCase().trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

/** Validate that every supplied role name is in AGENT_ROLES; throw on unknown. */
function validateRoles(roles: AgentMailRole[]): AgentMailRole[] {
  const unknown = roles.filter((r) => !AGENT_ROLES.includes(r));
  if (unknown.length > 0) {
    throw new Error(`Unknown AgentMail roles: ${unknown.join(", ")}. Valid: ${AGENT_ROLES.join(", ")}`);
  }
  return roles;
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
