/**
 * Unified Integration Status Service
 *
 * Single source of truth for integration connected/disconnected status.
 *
 * Resolution order (first match wins):
 *   1. external_integrations DB row with status = "connected"
 *   2. Env-var presence for known types (same logic as makeIntegrations)
 *   3. Disconnected
 *
 * Infrastructure services (Hermes, AgentMail, Obsidian) are internal
 * runtime components, NOT external integrations. They must never appear
 * as "disconnected" in integration status checks.
 */

import { db } from "../db";
import { externalIntegrations } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Internal runtime components that are NOT external integrations.
 * Never count these as "disconnected" — they are infrastructure.
 */
export const INFRASTRUCTURE_SERVICES = new Set([
  "hermes",
  "agentmail",
  "obsidian",
]);

/**
 * All recognized external integration types.
 */
export const EXTERNAL_INTEGRATION_TYPES = [
  "gmail",
  "google_calendar",
  "slack",
  "stripe",
  "sendgrid",
  "twilio",
  "hubspot",
  "openrouter",
  "meta_ads",
] as const;

export type ExternalIntegrationType = (typeof EXTERNAL_INTEGRATION_TYPES)[number];

/**
 * Core communication integration types.
 * If ANY of these is connected, the "no communication integrations" warning
 * must NOT fire.
 */
export const COMMUNICATION_INTEGRATION_TYPES = new Set<string>([
  "gmail",
  "slack",
  "sendgrid",
  "twilio",
]);

/**
 * Core integrations whose absence should penalise the health score.
 * Optional integrations (hubspot, meta_ads, openrouter) do NOT penalise.
 */
export const CORE_INTEGRATION_TYPES = new Set<string>([
  "gmail",
  "google_calendar",
  "stripe",
]);

// ─── Env-var detection (mirrors makeIntegrations logic exactly) ───────────────

function envVarConnected(type: ExternalIntegrationType): boolean {
  const e = process.env;
  switch (type) {
    case "gmail":
      return !!(e.GOOGLE_GMAIL_ACCESS_TOKEN || e.GMAIL_ACCESS_TOKEN || e.GOOGLE_CLIENT_SECRET);
    case "google_calendar":
      return !!(e.GOOGLE_CALENDAR_CLIENT_SECRET || e.GOOGLE_CLIENT_SECRET);
    case "slack":
      return !!(e.SLACK_BOT_TOKEN || e.SLACK_API_TOKEN);
    case "stripe":
      return !!(e.STRIPE_SECRET_KEY);
    case "sendgrid":
      return !!(e.SENDGRID_API_KEY);
    case "twilio":
      return !!(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN);
    case "hubspot":
      return !!(e.HUBSPOT_ACCESS_TOKEN || e.HUBSPOT_API_KEY);
    case "openrouter":
      return !!(e.OPENROUTER_API_KEY);
    case "meta_ads":
      return !!(e.META_ADS_ACCESS_TOKEN);
    default:
      return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the set of integration type strings that are effectively "connected"
 * for the given org.
 *
 * DB row with status="connected" wins; env-var presence is the fallback.
 * Infrastructure services (Hermes, AgentMail, Obsidian) are excluded.
 */
export async function getEffectiveConnectedIntegrations(orgId: string): Promise<Set<string>> {
  let dbRows: Array<{ integrationType: string; status: string }> = [];
  try {
    dbRows = await db
      .select({
        integrationType: externalIntegrations.integrationType,
        status: externalIntegrations.status,
      })
      .from(externalIntegrations)
      .where(eq(externalIntegrations.orgId, orgId));
  } catch {
    // DB unavailable — rely on env-var detection only
  }

  const dbConnected = new Set(
    dbRows.filter(r => r.status === "connected").map(r => r.integrationType),
  );

  const connected = new Set<string>(dbConnected);

  // Env-var fallback for types not already confirmed by DB
  for (const type of EXTERNAL_INTEGRATION_TYPES) {
    if (!connected.has(type) && envVarConnected(type)) {
      connected.add(type);
    }
  }

  return connected;
}

export interface IntegrationStatusDetail {
  type: string;
  status: "connected" | "disconnected";
  source: "db" | "env" | "none";
}

/**
 * Returns per-type status details for every known external integration type.
 */
export async function getIntegrationStatusDetails(orgId: string): Promise<IntegrationStatusDetail[]> {
  let dbRows: Array<{ integrationType: string; status: string }> = [];
  try {
    dbRows = await db
      .select({
        integrationType: externalIntegrations.integrationType,
        status: externalIntegrations.status,
      })
      .from(externalIntegrations)
      .where(eq(externalIntegrations.orgId, orgId));
  } catch {
    // fall through
  }

  const dbMap = new Map(dbRows.map(r => [r.integrationType, r.status]));

  return EXTERNAL_INTEGRATION_TYPES.map(type => {
    const dbStatus = dbMap.get(type);
    if (dbStatus === "connected")  return { type, status: "connected",    source: "db"  };
    if (dbStatus !== undefined)    return { type, status: "disconnected", source: "db"  };
    if (envVarConnected(type))     return { type, status: "connected",    source: "env" };
    return                                { type, status: "disconnected", source: "none" };
  });
}
