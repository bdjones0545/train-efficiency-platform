import { storage } from './storage';
import type { InsertCommunicationLog } from '@shared/schema';

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
    const user = await storage.getUser(ctx.recipientUserId);
    if (user) {
      // Phase 2: Dual-read — org-level prefs first, fallback to user-level
      let effectiveSmsOptIn = user.smsOptIn;
      let effectiveNotifPrefs = user.notificationPreferences as any;

      if (ctx.orgId) {
        try {
          const orgPrefs = await storage.getUserOrgPreferences(ctx.recipientUserId, ctx.orgId);
          if (orgPrefs) {
            effectiveSmsOptIn = orgPrefs.smsOptIn;
            effectiveNotifPrefs = orgPrefs.notificationPreferences ?? effectiveNotifPrefs;
          }
        } catch (err) {
          console.error('[SMS] Failed to load org prefs, falling back to user prefs:', err);
        }
      }

      if (!effectiveSmsOptIn) {
        const reason = 'sms_not_opted_in';
        console.log(`[SMS] Skipped: ${reason} for ${normalizedPhone}`);
        await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'skipped', provider: 'twilio', errorMessage: reason });
        return { sent: false, skipped: reason };
      }

      const prefKey = SMS_TYPE_TO_PREF_KEY[ctx.type];
      if (prefKey) {
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

  try {
    await client.messages.create({
      to: normalizedPhone,
      from: TWILIO_FROM,
      body,
    });
    console.log(`[SMS] Sent to ${normalizedPhone}: ${body.substring(0, 60)}...`);
    await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'sent', provider: 'twilio' });
    return { sent: true };
  } catch (err: any) {
    const errorMessage = err?.message || 'Unknown Twilio error';
    console.error(`[SMS] Failed to send to ${normalizedPhone}:`, errorMessage);
    await logSms({ ...ctx, recipientPhone: normalizedPhone, body, status: 'failed', provider: 'twilio', errorMessage });
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
