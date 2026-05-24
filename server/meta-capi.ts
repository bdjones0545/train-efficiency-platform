import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { orgAiGovernanceSettings, integrationExecutionLog } from "@shared/schema";
import { logUnifiedAction } from "./unified-action-logger";

const PIXEL_ID = "1707062324050326";
const CAPI_URL = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// ── Error classification ───────────────────────────────────────────────────

function classifyCapiError(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  if (status >= 400) return "permanent";
  return "transient";
}

// ── Idempotency check ──────────────────────────────────────────────────────

async function isAlreadySent(idempotencyKey: string): Promise<{ duplicate: boolean; resultSummary?: string }> {
  try {
    const [existing] = await db
      .select({ status: integrationExecutionLog.status, resultSummary: integrationExecutionLog.resultSummary })
      .from(integrationExecutionLog)
      .where(
        and(
          eq(integrationExecutionLog.idempotencyKey, idempotencyKey),
          eq(integrationExecutionLog.integrationType, "meta_capi"),
        )
      );
    if (existing && existing.status === "success") {
      return { duplicate: true, resultSummary: existing.resultSummary ?? undefined };
    }
    return { duplicate: false };
  } catch { return { duplicate: false }; }
}

// ── Governance check ───────────────────────────────────────────────────────

async function isCapiEmergencyPaused(orgId: string): Promise<boolean> {
  try {
    const [s] = await db
      .select({ paused: orgAiGovernanceSettings.emergencyPauseEnabled })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
    return s?.paused ?? false;
  } catch { return false; }
}

// ── Integration log writer ─────────────────────────────────────────────────

async function writeCapiLog(params: {
  orgId: string;
  idempotencyKey: string;
  eventName: string;
  status: string;
  latencyMs?: number;
  errorMessage?: string;
  errorClass?: string;
  providerStatusCode?: number;
  resultSummary?: string;
  governanceDecision?: string;
}): Promise<void> {
  try {
    await db.insert(integrationExecutionLog).values({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      integrationType: "meta_capi",
      actionType: `capi_event:${params.eventName}`,
      idempotencyKey: params.idempotencyKey,
      status: params.status,
      inputSummary: JSON.stringify({ eventName: params.eventName }),
      resultSummary: params.resultSummary,
      errorMessage: params.errorMessage,
      errorClass: params.errorClass,
      providerStatusCode: params.providerStatusCode,
      latencyMs: params.latencyMs,
      governanceChecked: !!params.governanceDecision,
      governanceDecision: params.governanceDecision,
    } as any);
  } catch (err) {
    console.error("[Meta CAPI] Failed to write integration log:", err);
  }
}

// ── Core event sender ──────────────────────────────────────────────────────

interface CapiEventPayload {
  orgId?: string;
  eventName: string;
  eventId?: string;
  leadId?: string;
  submissionId?: string;
  eventSourceUrl?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  email?: string;
  phone?: string;
  customData?: Record<string, unknown>;
}

interface CapiResult {
  sent: boolean;
  duplicate?: boolean;
  blocked?: boolean;
  reason?: string;
}

async function sendCapiEvent(payload: CapiEventPayload): Promise<CapiResult> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    console.warn("[Meta CAPI] META_CAPI_TOKEN not set — skipping event.");
    return { sent: false, reason: "token_not_configured" };
  }

  const orgId = payload.orgId ?? "system";

  // Build idempotency key
  const dedupeId = payload.eventId ?? payload.leadId ?? payload.submissionId
    ?? String(Math.floor(Date.now() / 60_000)); // 1-minute bucket fallback
  const idempotencyKey = `meta_capi:${orgId}:${payload.eventName}:${dedupeId}`;

  // ── Emergency pause check ────────────────────────────────────────────────
  if (payload.orgId) {
    const paused = await isCapiEmergencyPaused(payload.orgId);
    if (paused) {
      const reason = "Blocked: AI operations are paused for this organization. Emergency pause must be disabled before Meta CAPI events can be sent.";
      console.warn(`[Meta CAPI] Emergency pause active — blocking event "${payload.eventName}" (orgId=${payload.orgId})`);
      await writeCapiLog({ orgId, idempotencyKey, eventName: payload.eventName, status: "blocked", errorMessage: reason, errorClass: "governance", governanceDecision: "blocked" });
      await logUnifiedAction({ orgId, actorType: "system", actorName: "apex_agent", actionType: "governance_blocked", status: "blocked", riskLevel: "medium", reasoningSummary: reason }).catch(() => {});
      return { sent: false, blocked: true, reason };
    }
  }

  // ── Idempotency check ────────────────────────────────────────────────────
  const { duplicate, resultSummary } = await isAlreadySent(idempotencyKey);
  if (duplicate) {
    console.log(`[Meta CAPI] Duplicate prevented — event "${payload.eventName}" already sent (key=${idempotencyKey})`);
    await logUnifiedAction({ orgId, actorType: "system", actorName: "apex_agent", actionType: "capi_duplicate_prevented", status: "completed", riskLevel: "low", reasoningSummary: `Duplicate Meta CAPI event prevented: ${payload.eventName} (key=${idempotencyKey})` }).catch(() => {});
    return { sent: false, duplicate: true, reason: "already_sent" };
  }

  // ── Build and send event ─────────────────────────────────────────────────
  const userData: Record<string, unknown> = {};
  if (payload.clientIpAddress) userData.client_ip_address = payload.clientIpAddress;
  if (payload.clientUserAgent) userData.client_user_agent = payload.clientUserAgent;
  if (payload.fbp) userData.fbp = payload.fbp;
  if (payload.fbc) userData.fbc = payload.fbc;
  if (payload.email) userData.em = hashValue(payload.email);
  if (payload.phone) userData.ph = hashValue(payload.phone);

  const event: Record<string, unknown> = {
    event_name: payload.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: dedupeId,
    action_source: "website",
    event_source_url: payload.eventSourceUrl ?? "",
    user_data: userData,
  };
  if (payload.customData && Object.keys(payload.customData).length > 0) {
    event.custom_data = payload.customData;
  }

  const sendStart = Date.now();
  let providerStatusCode: number | undefined;
  let errorMessage: string | undefined;
  let errorClass: string | undefined;

  try {
    const res = await fetch(`${CAPI_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    });
    providerStatusCode = res.status;
    const latencyMs = Date.now() - sendStart;

    if (!res.ok) {
      const text = await res.text();
      errorMessage = `${res.status}: ${text}`;
      errorClass = classifyCapiError(res.status);
      console.error(`[Meta CAPI] Error sending event "${payload.eventName}": ${errorMessage}`);
      await writeCapiLog({ orgId, idempotencyKey, eventName: payload.eventName, status: "failed", latencyMs, errorMessage, errorClass, providerStatusCode, governanceDecision: "allowed" });
      await logUnifiedAction({ orgId, actorType: "system", actorName: "apex_agent", actionType: "capi_event_failed", status: "failed", riskLevel: "medium", reasoningSummary: `Meta CAPI event "${payload.eventName}" failed: ${errorMessage}` }).catch(() => {});
      return { sent: false, reason: errorMessage };
    }

    const responseText = await res.text();
    console.log(`[Meta CAPI] Event "${payload.eventName}" sent successfully (key=${idempotencyKey})`);
    await writeCapiLog({ orgId, idempotencyKey, eventName: payload.eventName, status: "success", latencyMs, resultSummary: responseText.substring(0, 200), providerStatusCode, governanceDecision: "allowed" });
    await logUnifiedAction({ orgId, actorType: "system", actorName: "apex_agent", actionType: "capi_event_sent", status: "completed", riskLevel: "low", reasoningSummary: `Meta CAPI event "${payload.eventName}" sent successfully` }).catch(() => {});
    return { sent: true };

  } catch (err: any) {
    const latencyMs = Date.now() - sendStart;
    errorMessage = err?.message ?? "Network error";
    errorClass = "transient";
    console.error(`[Meta CAPI] Network error sending "${payload.eventName}":`, errorMessage);
    await writeCapiLog({ orgId, idempotencyKey, eventName: payload.eventName, status: "failed", latencyMs, errorMessage, errorClass, governanceDecision: "allowed" });
    return { sent: false, reason: errorMessage };
  }
}

// ── Express route ──────────────────────────────────────────────────────────

export function registerMetaCapiRoutes(app: Express): void {
  app.post("/api/meta/event", async (req: Request, res: Response) => {
    try {
      const {
        orgId,
        eventName,
        eventId,
        leadId,
        submissionId,
        eventSourceUrl,
        fbp,
        fbc,
        email,
        phone,
        customData,
      } = req.body;

      if (!eventName || typeof eventName !== "string") {
        return res.status(400).json({ error: "eventName is required" });
      }

      const clientIpAddress =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress || "";
      const clientUserAgent = req.headers["user-agent"] || "";

      const result = await sendCapiEvent({
        orgId: orgId || undefined,
        eventName,
        eventId: eventId || undefined,
        leadId: leadId || undefined,
        submissionId: submissionId || undefined,
        eventSourceUrl,
        clientIpAddress,
        clientUserAgent,
        fbp,
        fbc,
        email,
        phone,
        customData,
      });

      if (result.blocked) return res.status(503).json({ success: false, blocked: true, reason: result.reason });
      if (result.duplicate) return res.json({ success: true, duplicate: true, reason: result.reason });
      if (!result.sent) return res.status(502).json({ success: false, reason: result.reason });
      return res.json({ success: true });
    } catch (err) {
      console.error("[Meta CAPI] Unexpected error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}

export { sendCapiEvent };
