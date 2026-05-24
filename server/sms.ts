import { storage } from './storage';
import type { InsertCommunicationLog } from '@shared/schema';
import crypto from 'crypto';
import { db } from './db';
import { eq } from 'drizzle-orm';
import { orgAiGovernanceSettings, integrationExecutionLog } from '@shared/schema';
import { logUnifiedAction } from './unified-action-logger';

let twilioClient: any = null;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER ?? '';

function getTwilioClient(): any {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    return twilioClient;
  } catch {
    return null;
  }
}

export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

export const DEFAULT_SMS_PREFS = {
  bookingConfirmations: false,
  cancellations: false,
  reschedules: false,
  reminders: false,
  outreach: false,
  marketing: false,
};

const SMS_TYPE_TO_PREF_KEY: Record<string, keyof typeof DEFAULT_SMS_PREFS> = {
  booking_confirmation: 'bookingConfirmations',
  cancellation: 'cancellations',
  reschedule: 'reschedules',
  recurring: 'bookingConfirmations',
  reminder: 'reminders',
  outreach: 'outreach',
  marketing: 'marketing',
};

export interface SmsContext {
  orgId: string;
  type: string;
  userId?: string;
  coachId?: string;
  bookingId?: string;
  agentActionId?: string;
  recipientUserId?: string;
  messagePurpose?: "operational" | "marketing" | "automated_outreach";
}

interface SmsLogPayload {
  orgId: string;
  type: string;
  userId?: string;
  coachId?: string;
  bookingId?: string;
  agentActionId?: string;
  recipientPhone: string;
  body: string;
  status: 'sent' | 'failed' | 'skipped';
  provider: string;
  errorMessage?: string;
}

// ── Governance helpers (Part 1 hardening patch) ────────────────────────────

async function isSmsEmergencyPaused(orgId: string): Promise<boolean> {
  try {
    const [s] = await db
      .select({ paused: orgAiGovernanceSettings.emergencyPauseEnabled })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
    return s?.paused ?? false;
  } catch { return false; }
}

async function writeSmsIntegrationLog(params: {
  orgId: string;
  status: string;
  to: string;
  body: string;
  latencyMs?: number;
  errorMessage?: string;
  errorClass?: string;
  governanceDecision?: string;
  providerMessageId?: string;
}): Promise<void> {
  try {
    await db.insert(integrationExecutionLog).values({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      integrationType: 'twilio',
      actionType: 'send_sms',
      status: params.status,
      inputSummary: JSON.stringify({ to: params.to, bodyPreview: params.body.substring(0, 80) }),
      resultSummary: params.status === 'success' ? (params.providerMessageId ? `sid:${params.providerMessageId}` : 'SMS delivered') : undefined,
      errorMessage: params.errorMessage,
      errorClass: params.errorClass,
      latencyMs: params.latencyMs,
      governanceChecked: true,
      governanceDecision: params.governanceDecision ?? 'allowed',
    } as any);
  } catch (err) {
    console.error('[SMS] Failed to write integration execution log:', err);
  }
}

async function logSms(payload: SmsLogPayload): Promise<void> {
  try {
    const logData: InsertCommunicationLog = {
      orgId: payload.orgId,
      userId: payload.userId,
      coachId: payload.coachId,
      bookingId: payload.bookingId,
      agentActionId: payload.agentActionId,
      type: payload.type,
      channel: 'sms',
      recipientPhone: payload.recipientPhone,
      messageBody: payload.body.substring(0, 320),
      status: payload.status,
      provider: payload.provider,
      errorMessage: payload.errorMessage,
    };
    await storage.createCommunicationLog(logData);
  } catch (err) {
    console.error('[SMS] Failed to log SMS:', err);
  }
}

export async function sendSms(params: {
  to: string;
  body: string;
  ctx: SmsContext;
}): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  const { to, body, ctx } = params;

  const normalizedPhone = normalizePhone(to);
  if (!normalizedPhone) {
    const reason = 'invalid_phone';
    console.log(`[SMS] Skipped: ${reason} for ${to}`);
    await logSms({ ...ctx, recipientPhone: to, body, status: 'skipped', provider: 'twilio', errorMessage: reason });
    return { sent: false, skipped: reason };
  }

  if (ctx.recipientUserId) {
    // Phase 6: Org-only reads — org prefs are the source of truth
    let effectiveSmsOptIn: boolean = false;
    let effectiveNotifPrefs: any = null;

    if (ctx.orgId) {
      try {
        const orgPrefs = await storage.getUserOrgPreferences(ctx.recipientUserId, ctx.orgId);
        if (orgPrefs) {
          effectiveSmsOptIn = orgPrefs.smsOptIn;
          effectiveNotifPrefs = orgPrefs.notificationPreferences;
        } else {
          // Edge case: backfill missed this user — warn and fall back to user level
          console.warn(`[SMS] No org prefs for user ${ctx.recipientUserId} in org ${ctx.orgId} — falling back to user level`);
          const user = await storage.getUser(ctx.recipientUserId);
          effectiveSmsOptIn = user?.smsOptIn ?? false;
          effectiveNotifPrefs = user?.notificationPreferences as any;
        }
      } catch (err) {
        console.error('[SMS] Failed to load org prefs, falling back to user prefs:', err);
        const user = await storage.getUser(ctx.recipientUserId);
        effectiveSmsOptIn = user?.smsOptIn ?? false;
        effectiveNotifPrefs = user?.notificationPreferences as any;
      }
    } else {
      // No org context — use user-level prefs directly
      const user = await storage.getUser(ctx.recipientUserId);
      effectiveSmsOptIn = user?.smsOptIn ?? false;
      effectiveNotifPrefs = user?.notificationPreferences as any;
    }

    // Operational messages (manual coach-to-client) bypass the opt-in gate.
    // Only marketing and automated outreach require explicit SMS opt-in.
    const isOperational = ctx.messagePurpose === "operational" || (!ctx.messagePurpose && ctx.type !== "marketing" && ctx.type !== "automated_outreach");
    if (!isOperational && !effectiveSmsOptIn) {
      const reason = 'sms_not_opted_in';
      console.log(`[SMS] Skipped: ${reason} for ${normalizedPhone} (purpose: ${ctx.messagePurpose ?? ctx.type})`);
      await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'skipped', provider: 'twilio', errorMessage: reason });
      return { sent: false, skipped: reason };
    }

    const prefKey = SMS_TYPE_TO_PREF_KEY[ctx.type];
    // Operational messages bypass per-type notification preference checks too.
    // Marketing and automated outreach must still respect granular preferences.
    if (prefKey && !isOperational) {
      const smsPrefs = effectiveNotifPrefs?.sms ?? DEFAULT_SMS_PREFS;
      const enabled = smsPrefs[prefKey] ?? DEFAULT_SMS_PREFS[prefKey] ?? false;
      if (!enabled) {
        const reason = 'sms_preference_disabled';
        console.log(`[SMS] Skipped: ${reason} (${prefKey}) for ${normalizedPhone}`);
        await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'skipped', provider: 'twilio', errorMessage: reason });
        return { sent: false, skipped: reason };
      }
    }
  }

  // ── Emergency pause guard ─────────────────────────────────────────────────
  if (ctx.orgId) {
    const paused = await isSmsEmergencyPaused(ctx.orgId);
    if (paused) {
      const PAUSE_MSG = 'Blocked: AI operations are paused for this organization. Emergency pause must be disabled before outbound communication can be sent.';
      console.warn(`[SMS] Emergency pause active — blocking send (orgId=${ctx.orgId})`);
      await writeSmsIntegrationLog({ orgId: ctx.orgId, status: 'blocked', to: normalizedPhone, body, errorMessage: PAUSE_MSG, errorClass: 'governance', governanceDecision: 'blocked' });
      try { await logUnifiedAction({ orgId: ctx.orgId, actorType: 'system', actorName: 'relay_agent', actionType: 'governance_blocked', status: 'blocked', riskLevel: 'high', reasoningSummary: PAUSE_MSG }); } catch {}
      await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'failed', provider: 'twilio', errorMessage: PAUSE_MSG });
      return { sent: false, skipped: 'emergency_pause' };
    }
  }

  if (!isTwilioConfigured()) {
    console.log(`[SMS] Twilio not configured — skipping SMS to ${normalizedPhone}`);
    return { sent: false, skipped: 'twilio_not_configured' };
  }

  const client = getTwilioClient();
  if (!client) {
    console.error('[SMS] Failed to initialize Twilio client');
    return { sent: false, skipped: 'twilio_client_error' };
  }

  const _smsSendStart = Date.now();
  try {
    const message = await client.messages.create({
      to: normalizedPhone,
      from: TWILIO_FROM,
      body,
    });
    const _smsLatencyMs = Date.now() - _smsSendStart;
    const providerMessageId = message?.sid;
    console.log(`[SMS] Sent to ${normalizedPhone}: ${body.substring(0, 60)}...`);
    await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'sent', provider: 'twilio' });
    // Mirror into integration_execution_log
    if (ctx.orgId) {
      await writeSmsIntegrationLog({ orgId: ctx.orgId, status: 'success', to: normalizedPhone, body, latencyMs: _smsLatencyMs, providerMessageId, governanceDecision: 'allowed' });
    }
    return { sent: true };
  } catch (err: any) {
    const _smsLatencyMs = Date.now() - _smsSendStart;
    const errorMessage = err?.message || 'Unknown Twilio error';
    console.error(`[SMS] Failed to send to ${normalizedPhone}:`, errorMessage);
    await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'failed', provider: 'twilio', errorMessage });
    // Mirror into integration_execution_log
    if (ctx.orgId) {
      await writeSmsIntegrationLog({ orgId: ctx.orgId, status: 'failed', to: normalizedPhone, body, latencyMs: _smsLatencyMs, errorMessage, errorClass: 'transient', governanceDecision: 'allowed' });
    }
    return { sent: false, error: errorMessage };
  }
}

// ─── SMS Templates ─────────────────────────────────────────────────────────────

export function smsBookingConfirmation(params: {
  clientFirstName: string;
  serviceName: string;
  coachFirstName: string;
  dateStr: string;
  timeStr: string;
  orgName: string;
}): string {
  const { clientFirstName, serviceName, coachFirstName, dateStr, timeStr, orgName } = params;
  return `Hi ${clientFirstName}, your ${serviceName} with ${coachFirstName} is confirmed for ${dateStr} at ${timeStr}. — ${orgName}`;
}

export function smsCancellation(params: {
  clientFirstName: string;
  serviceName: string;
  dateStr: string;
  timeStr: string;
  orgName: string;
}): string {
  const { clientFirstName, serviceName, dateStr, timeStr, orgName } = params;
  return `Hi ${clientFirstName}, your ${serviceName} on ${dateStr} at ${timeStr} has been cancelled. Contact us to reschedule. — ${orgName}`;
}

export function smsReschedule(params: {
  clientFirstName: string;
  serviceName: string;
  newDateStr: string;
  newTimeStr: string;
  orgName: string;
}): string {
  const { clientFirstName, serviceName, newDateStr, newTimeStr, orgName } = params;
  return `Hi ${clientFirstName}, your ${serviceName} has been rescheduled to ${newDateStr} at ${newTimeStr}. — ${orgName}`;
}

export function smsReminder(params: {
  clientFirstName: string;
  serviceName: string;
  coachFirstName: string;
  dateStr: string;
  timeStr: string;
  orgName: string;
}): string {
  const { clientFirstName, serviceName, coachFirstName, dateStr, timeStr, orgName } = params;
  return `Reminder: Your ${serviceName} with ${coachFirstName} is ${dateStr} at ${timeStr}. Reply to your coach if you need to make changes. — ${orgName}`;
}

export function smsOutreach(params: {
  clientFirstName: string;
  message: string;
  orgName: string;
}): string {
  const { clientFirstName, message, orgName } = params;
  const body = `Hi ${clientFirstName}, ${message} — ${orgName}`;
  return body.length > 320 ? body.substring(0, 317) + '...' : body;
}
