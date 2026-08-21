/**
 * AgentMail Per-Org Inbox Provisioning Script
 *
 * Creates AgentMail role inboxes for every organization that has AgentMail
 * explicitly enabled (an active entry in org_ai_integrations where provider = 'agentmail').
 * After creation the rows are left in ownership_state = 'provisioning'.
 *
 * Run this BEFORE routing cutover:
 *   npx tsx server/scripts/provision-agentmail-inboxes.ts
 *
 * Safe to re-run — already-provisioned orgs are skipped.
 * Does NOT activate ownership or modify any routing code.
 *
 * Production rollout sequence:
 *   1. Deploy org_agentmail_inboxes schema      ← non-breaking additive migration
 *   2. Run this script (provision)
 *   3. Run with --verify flag (provider + DB check)
 *   4. Run with --activate flag (flip state to 'active')
 *   5. Deploy updated resolveOrgFromInbox + sendAgentEmail code
 *   6. Monitor legacy global inbox volume (30-day grace period)
 *   7. Retire legacy inboxes after traffic confirms transition
 *
 * Rollback:
 *   If routing cutover causes issues, revert the server code deployment.
 *   The org_agentmail_inboxes rows remain but are not consulted by the reverted code.
 *   No AgentMail provider inboxes need to be deleted — unused inboxes receive no traffic.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  provisionOrgInboxes,
  activateOrgInboxes,
  verifyOrgInboxProvisioning,
  ensureOwnershipTable,
} from "../services/agentmail-ownership-service";

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Org discovery ────────────────────────────────────────────────────────────

/**
 * Return org IDs that have AgentMail explicitly enabled.
 * "Enabled" = active row in org_ai_integrations where provider = 'agentmail'.
 *
 * If PROVISION_ALL_ORGS=true env var is set (for initial migration), returns ALL
 * org IDs and the operator is expected to handle the provisioning scope decision.
 */
async function getAgentMailEnabledOrgIds(): Promise<string[]> {
  if (process.env.PROVISION_ALL_ORGS === "true") {
    console.warn(
      "[Provision] PROVISION_ALL_ORGS=true — will provision ALL organizations. " +
        "This should only be used for initial migration from the shared-inbox era.",
    );
    const orgRows = rows(
      await db.execute(sql`SELECT id FROM organizations ORDER BY created_at`),
    );
    return orgRows.map((r: any) => r.id);
  }

  // Default: only orgs with explicit AgentMail integration record
  const integrationRows = rows(
    await db.execute(sql`
      SELECT DISTINCT org_id
      FROM org_ai_integrations
      WHERE provider  = 'agentmail'
        AND is_active = true
    `),
  );

  // Also include orgs that already have provisioned inboxes (idempotency — re-provision
  // partially-provisioned orgs if the previous run was interrupted)
  const partialRows = rows(
    await db.execute(sql`
      SELECT DISTINCT organization_id AS org_id
      FROM org_agentmail_inboxes
      WHERE ownership_state = 'provisioning'
    `).catch(() => [] as any),
  );

  const ids = new Set<string>([
    ...integrationRows.map((r: any) => r.org_id),
    ...partialRows.map((r: any) => r.org_id),
  ]);
  return [...ids];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doVerify   = args.includes("--verify");
  const doActivate = args.includes("--activate");
  const dryRun     = args.includes("--dry-run");

  console.log("=".repeat(72));
  console.log("AgentMail Per-Org Inbox Provisioning");
  console.log("=".repeat(72));
  if (dryRun)     console.log("[Mode] DRY RUN — no writes will occur");
  if (doVerify)   console.log("[Mode] VERIFY — checking provider + DB state");
  if (doActivate) console.log("[Mode] ACTIVATE — flipping ownership_state to active");
  console.log();

  // 1. Ensure schema exists
  if (!dryRun) {
    console.log("Ensuring schema...");
    await ensureOwnershipTable();
    console.log("Schema ready.");
    console.log();
  }

  // 2. Discover orgs
  const orgIds = await getAgentMailEnabledOrgIds();
  if (orgIds.length === 0) {
    console.log(
      "No AgentMail-enabled organizations found.\n" +
        "Set org_ai_integrations rows with provider='agentmail' and is_active=true,\n" +
        "or set PROVISION_ALL_ORGS=true for initial migration.",
    );
    process.exit(0);
  }

  console.log(`Organizations to process: ${orgIds.length}`);
  orgIds.forEach((id) => console.log(`  • ${id}`));
  console.log();

  // 3. Provision
  if (!doVerify && !doActivate) {
    let successCount = 0;
    let failCount = 0;

    for (const orgId of orgIds) {
      console.log(`[${orgId}] Provisioning...`);
      if (dryRun) {
        console.log(`  (dry-run) would provision 6 inboxes`);
        continue;
      }

      const result = await provisionOrgInboxes(orgId);
      for (const r of result.roles) {
        const icon = r.status === "failed" ? "✗" : r.status === "already_provisioned" ? "↩" : "✓";
        console.log(
          `  ${icon} [${r.role}] ${r.emailAddress}  status=${r.status}` +
            (r.providerInboxId ? `  providerInboxId=${r.providerInboxId}` : "") +
            (r.error ? `  ERROR: ${r.error}` : ""),
        );
      }

      if (result.allProvisioned) {
        successCount++;
        console.log(`  ✓ All 6 roles provisioned for org ${orgId}`);
      } else {
        failCount++;
        console.error(`  ✗ Some roles FAILED for org ${orgId} — fix errors before activating`);
      }
      console.log();
    }

    console.log(`=`.repeat(72));
    console.log(`Summary: ${successCount} orgs provisioned, ${failCount} orgs with failures`);
    if (failCount > 0) {
      console.error("Do NOT activate or cut over routing until all failures are resolved.");
      process.exit(1);
    }
    console.log("Next step: re-run with --verify to confirm provider state, then --activate.");
    process.exit(0);
  }

  // 4. Verify
  if (doVerify) {
    let allOk = true;
    for (const orgId of orgIds) {
      const result = await verifyOrgInboxProvisioning(orgId);
      console.log(`[${orgId}] Verification (domain=${result.domain}):`);
      for (const r of result.roles) {
        const icon = r.verified ? "✓" : "✗";
        console.log(
          `  ${icon} [${r.role}] ${r.emailAddress}  db=${r.dbState}  provider=${
            r.providerExists === null ? "unknown" : r.providerExists ? "exists" : "missing"
          }`,
        );
        if (!r.verified) allOk = false;
      }
      console.log();
    }
    if (!allOk) {
      console.error("VERIFICATION FAILED — do not activate routing until all roles verify.");
      process.exit(1);
    }
    console.log("All inboxes verified. Next step: re-run with --activate.");
    process.exit(0);
  }

  // 5. Activate
  if (doActivate) {
    if (dryRun) {
      console.log("(dry-run) would activate ownership_state for all provisioning rows");
      process.exit(0);
    }
    for (const orgId of orgIds) {
      await activateOrgInboxes(orgId);
      console.log(`[${orgId}] Activated.`);
    }
    console.log();
    console.log("All orgs activated. Routing cutover is now safe to deploy.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Provisioning script fatal error:", err);
  process.exit(1);
});
