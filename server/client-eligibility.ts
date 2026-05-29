/**
 * Client Eligibility Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for determining whether a user account is a real,
 * actionable client eligible for engagement signals (inactive, activation,
 * churn, retention, etc.).
 *
 * An account is INELIGIBLE when it is:
 *   • A walk-in profile (userId starts with "walk-in-")
 *   • A test / dev account (ID or email pattern)
 *   • A coach (has a coach_profile in this org)
 *   • An admin, staff, or coach by role (user_profiles.role ≠ 'CLIENT')
 *   • A cross-account alias of a coach/admin (same name → same person)
 *   • The org owner (matched by owner_email in organizations table)
 *
 * Usage in raw SQL queries (Signal 11/12 and future signals):
 *
 *   import { CLIENT_ELIGIBILITY_SQL } from "./client-eligibility";
 *   const rows = await db.execute(sql`
 *     SELECT ... FROM user_profiles up JOIN users u ON u.id = up.user_id
 *     WHERE ... ${sql.raw(CLIENT_ELIGIBILITY_SQL(orgId))}
 *   `);
 *
 * Usage for individual user checks:
 *
 *   const ok = await isEligibleClientForSignals(userId, orgId);
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SQL fragment builder
// ─────────────────────────────────────────────────────────────────────────────
// Returns raw SQL AND-conditions for embedding in any query that already has
// the aliases:
//   up  → user_profiles row (role = 'CLIENT' must already be in WHERE)
//   u   → users row (joined on u.id = up.user_id)
//
// orgId is a trusted internal value (comes from server-side auth context, never
// raw HTTP input) — safe to embed as a quoted literal.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function CLIENT_ELIGIBILITY_SQL(orgId: string): string {
  const safe = orgId.replace(/'/g, "''");
  return `
  -- Walk-in and test/dev exclusions
  AND up.user_id NOT LIKE 'walk-in-%'
  AND LOWER(up.user_id) NOT LIKE '%test%'
  AND LOWER(up.user_id) NOT LIKE '%theme-test%'
  AND (
    u.email IS NULL OR (
      LOWER(u.email) NOT LIKE '%test%' AND
      LOWER(u.email) NOT LIKE '%demo%' AND
      LOWER(u.email) NOT LIKE '%example%' AND
      LOWER(u.email) NOT LIKE '%dev%'
    )
  )
  -- Internal user exclusions
  AND NOT EXISTS (
    -- Direct: user also has a coach profile in this org
    SELECT 1 FROM coach_profiles cp_elig
    WHERE cp_elig.user_id = u.id AND cp_elig.organization_id = '${safe}'
  )
  AND NOT EXISTS (
    -- Direct: user also has an admin/coach/staff role in this org
    SELECT 1 FROM user_profiles up_roles
    WHERE up_roles.user_id = u.id
      AND up_roles.organization_id = '${safe}'
      AND up_roles.role IN ('ADMIN', 'COACH', 'STAFF')
  )
  AND NOT EXISTS (
    -- Cross-account: another user with the same full name is a coach/admin in this org
    SELECT 1 FROM users u_alt
    JOIN user_profiles up_alt
      ON up_alt.user_id = u_alt.id AND up_alt.organization_id = '${safe}'
    WHERE LOWER(TRIM(u_alt.first_name)) = LOWER(TRIM(COALESCE(u.first_name, '')))
      AND LOWER(TRIM(u_alt.last_name))  = LOWER(TRIM(COALESCE(u.last_name, '')))
      AND LENGTH(TRIM(COALESCE(u_alt.last_name, ''))) > 1
      AND LENGTH(TRIM(COALESCE(u.last_name, ''))) > 1
      AND u_alt.id != u.id
      AND up_alt.role IN ('ADMIN', 'COACH', 'STAFF')
  )
  AND NOT EXISTS (
    -- Cross-account: another user with the same full name has a coach profile
    SELECT 1 FROM users u_alt
    JOIN coach_profiles cp_alt
      ON cp_alt.user_id = u_alt.id AND cp_alt.organization_id = '${safe}'
    WHERE LOWER(TRIM(u_alt.first_name)) = LOWER(TRIM(COALESCE(u.first_name, '')))
      AND LOWER(TRIM(u_alt.last_name))  = LOWER(TRIM(COALESCE(u.last_name, '')))
      AND LENGTH(TRIM(COALESCE(u_alt.last_name, ''))) > 1
      AND LENGTH(TRIM(COALESCE(u.last_name, ''))) > 1
      AND u_alt.id != u.id
  )
  AND NOT EXISTS (
    -- Org owner: user email matches the org's owner_email
    SELECT 1 FROM organizations org_own
    WHERE org_own.id = '${safe}'
      AND u.email IS NOT NULL
      AND org_own.owner_email IS NOT NULL
      AND LOWER(u.email) = LOWER(org_own.owner_email)
  )
  `;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Individual user check
// ─────────────────────────────────────────────────────────────────────────────
// Use when you have a specific userId to evaluate (e.g., before generating
// a recommendation or email for a single client).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function isEligibleClientForSignals(
  userId: string,
  orgId: string
): Promise<boolean> {
  if (!userId || !orgId) return false;

  // Fast rejections — no DB needed
  if (
    userId.startsWith("walk-in-") ||
    userId.toLowerCase().includes("test") ||
    userId.toLowerCase().includes("theme-test")
  ) {
    return false;
  }

  const [row] = await db.execute(sql`
    SELECT
      up.role AS profile_role,
      u.email,
      CASE WHEN cp.id IS NOT NULL THEN true ELSE false END AS has_coach_profile,
      CASE WHEN org.owner_email IS NOT NULL
            AND u.email IS NOT NULL
            AND LOWER(u.email) = LOWER(org.owner_email)
           THEN true ELSE false END AS is_org_owner_email,
      EXISTS (
        SELECT 1 FROM users u_alt
        JOIN user_profiles up_alt ON up_alt.user_id = u_alt.id
          AND up_alt.organization_id = ${orgId}
        WHERE LOWER(TRIM(u_alt.first_name)) = LOWER(TRIM(COALESCE(u.first_name, '')))
          AND LOWER(TRIM(u_alt.last_name))  = LOWER(TRIM(COALESCE(u.last_name, '')))
          AND LENGTH(TRIM(COALESCE(u_alt.last_name, ''))) > 1
          AND u_alt.id != u.id
          AND up_alt.role IN ('ADMIN', 'COACH', 'STAFF')
      ) AS cross_account_internal,
      EXISTS (
        SELECT 1 FROM users u_alt
        JOIN coach_profiles cp_alt ON cp_alt.user_id = u_alt.id
          AND cp_alt.organization_id = ${orgId}
        WHERE LOWER(TRIM(u_alt.first_name)) = LOWER(TRIM(COALESCE(u.first_name, '')))
          AND LOWER(TRIM(u_alt.last_name))  = LOWER(TRIM(COALESCE(u.last_name, '')))
          AND LENGTH(TRIM(COALESCE(u_alt.last_name, ''))) > 1
          AND u_alt.id != u.id
      ) AS cross_account_coach
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id AND up.organization_id = ${orgId}
    LEFT JOIN coach_profiles cp ON cp.user_id = u.id AND cp.organization_id = ${orgId}
    LEFT JOIN organizations org ON org.id = ${orgId}
    WHERE u.id = ${userId}
    LIMIT 1
  `) as any;

  if (!row) return false;

  const email = (row.email ?? "").toLowerCase();

  // Email-based rejections
  if (
    email.includes("test") ||
    email.includes("demo") ||
    email.includes("example") ||
    email.includes("dev")
  ) {
    return false;
  }

  // Role must be CLIENT
  if (row.profile_role && row.profile_role !== "CLIENT") return false;

  // Must not be a coach
  if (row.has_coach_profile === true) return false;

  // Must not be org owner by email
  if (row.is_org_owner_email === true) return false;

  // Must not be a cross-account alias of an internal user
  if (row.cross_account_internal === true) return false;
  if (row.cross_account_coach === true) return false;

  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Batch check — returns set of eligible userIds from a given list
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getEligibleClientIds(
  orgId: string
): Promise<Set<string>> {
  const safe = orgId.replace(/'/g, "''");
  const rows = await db.execute(sql`
    SELECT up.user_id
    FROM user_profiles up
    JOIN users u ON u.id = up.user_id
    WHERE up.organization_id = ${orgId}
      AND up.role = 'CLIENT'
      ${sql.raw(CLIENT_ELIGIBILITY_SQL(orgId))}
    LIMIT 500
  `) as any[];

  return new Set(rows.map((r: any) => r.user_id));
}
