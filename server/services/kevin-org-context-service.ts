/**
 * kevin-org-context-service.ts — Generic organization context for Kevin agents.
 *
 * Builds a compact, org-scoped business snapshot that any Kevin-backed agent
 * (executive, revenue, growth, scheduling, client-success, ceo) can use as
 * task context. Retention keeps its own richer per-client context builder.
 *
 * Every metric block is best-effort: a failing query yields null for that
 * block rather than failing the whole dispatch.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface OrgAgentContext {
  schemaVersion: "1.0";
  organization: {
    id: string;
    name: string | null;
    type: string | null;
  };
  clients: {
    total: number;
    activeLast30Days: number;
  } | null;
  scheduling: {
    sessionsLast30Days: number;
    sessionsNext14Days: number;
  } | null;
  revenue: {
    ledgerRevenueCents30d: number;
  } | null;
  generatedAt: string;
}

function rowsOf(res: any): any[] {
  return Array.isArray(res) ? res : res?.rows ?? [];
}

export async function buildOrgAgentContext(orgId: string): Promise<OrgAgentContext | null> {
  let orgName: string | null = null;
  let orgType: string | null = null;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT name, organization_type FROM organizations WHERE id = ${orgId} LIMIT 1
    `));
    if (!rows.length) return null;
    orgName = rows[0].name ?? null;
    orgType = rows[0].organization_type ?? null;
  } catch {
    return null;
  }

  let clients: OrgAgentContext["clients"] = null;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.client_id = up.user_id AND b.start_at > NOW() - INTERVAL '30 days'
        ))::int AS active
      FROM user_profiles up
      WHERE up.organization_id = ${orgId}
    `));
    clients = { total: Number(rows[0]?.total ?? 0), activeLast30Days: Number(rows[0]?.active ?? 0) };
  } catch {
    clients = null;
  }

  let scheduling: OrgAgentContext["scheduling"] = null;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE b.start_at > NOW() - INTERVAL '30 days' AND b.start_at <= NOW())::int AS past30,
        count(*) FILTER (WHERE b.start_at > NOW() AND b.start_at <= NOW() + INTERVAL '14 days')::int AS next14
      FROM bookings b
      WHERE b.organization_id = ${orgId}
    `));
    scheduling = {
      sessionsLast30Days: Number(rows[0]?.past30 ?? 0),
      sessionsNext14Days: Number(rows[0]?.next14 ?? 0),
    };
  } catch {
    scheduling = null;
  }

  let revenue: OrgAgentContext["revenue"] = null;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT COALESCE(sum(amount_cents), 0)::bigint AS cents
      FROM revenue_ledger_events
      WHERE org_id = ${orgId}
        AND created_at > NOW() - INTERVAL '30 days'
    `));
    revenue = { ledgerRevenueCents30d: Number(rows[0]?.cents ?? 0) };
  } catch {
    revenue = null;
  }

  return {
    schemaVersion: "1.0",
    organization: { id: orgId, name: orgName, type: orgType },
    clients,
    scheduling,
    revenue,
    generatedAt: new Date().toISOString(),
  };
}
