import sgMail from '@sendgrid/mail';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { storage } from './storage';
import crypto from 'crypto';
import { db } from './db';
import { eq } from 'drizzle-orm';
import { orgAiGovernanceSettings, integrationExecutionLog } from '@shared/schema';
import { logUnifiedAction } from './unified-action-logger';

let connectionSettings: any;
let _credentialCache: { apiKey: string; email: string } | null = null;
let _credentialCacheTs = 0;
const CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface OrgBranding {
  name: string;
  accentColor?: string;
  emailPrimaryColor?: string;
  emailSecondaryColor?: string;
  ownerName?: string;
  ownerEmail?: string;
}

export interface EmailLogContext {
  orgId: string;
  type: string;
  userId?: string;
  coachId?: string;
  bookingId?: string;
  agentActionId?: string;
  recipientUserId?: string;
}

const DEFAULT_NOTIFICATION_PREFS: Record<string, boolean> = {
  bookingConfirmations: true,
  cancellations: true,
  reschedules: true,
  reminders: true,
  outreach: true,
  marketing: false,
};

const TYPE_TO_PREF_KEY: Record<string, string> = {
  booking_confirmation: 'bookingConfirmations',
  cancellation: 'cancellations',
  reschedule: 'reschedules',
  recurring: 'bookingConfirmations',
  reminder: 'reminders',
  outreach: 'outreach',
  marketing: 'marketing',
};

const UNSUBSCRIBE_BASE_URL = 'https://trainefficiency.com';

const DEFAULT_BRANDING: OrgBranding = {
  name: "Train Efficiency",
  accentColor: "#16a34a",
};

function brand(org?: OrgBranding) {
  const b = org || DEFAULT_BRANDING;
  const fallbackColor = b.accentColor || "#16a34a";
  return {
    name: b.name || DEFAULT_BRANDING.name!,
    color: b.emailPrimaryColor || fallbackColor,
    secondaryColor: b.emailSecondaryColor || "#1a1a1a",
    ownerName: b.ownerName || "Admin",
    ownerEmail: b.ownerEmail,
  };
}

function emailShell(title: string, body: string, orgBranding?: OrgBranding) {
  const b = brand(orgBranding);
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: ${b.color}; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">${title}</h1>
      </div>
      <div style="padding: 32px;">
        ${body}
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— ${b.name}</p>
      </div>
    </div>
  `;
}

function detailBox(lines: string[], accentColor?: string, secondaryColor?: string) {
  const color = accentColor || "#16a34a";
  const bg = secondaryColor || "#1a1a1a";
  return `<div style="background: ${bg}; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid ${color};">${lines.join("")}</div>`;
}

function line(label: string, value: string, size = "15px") {
  return `<p style="font-size: ${size}; margin: 4px 0;"><strong>${label}:</strong> ${value}</p>`;
}

function bigLine(label: string, value: string) {
  return `<p style="font-size: 18px; margin: 4px 0; font-weight: bold;">${label}: ${value}</p>`;
}

function para(text: string) {
  return `<p style="font-size: 16px; line-height: 1.6;">${text}</p>`;
}

// ── Governance helpers (Part 1 hardening patch) ────────────────────────────

async function isEmailEmergencyPaused(orgId: string): Promise<boolean> {
  try {
    const [s] = await db
      .select({ paused: orgAiGovernanceSettings.emergencyPauseEnabled })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
    return s?.paused ?? false;
  } catch { return false; }
}

async function writeEmailIntegrationLog(params: {
  orgId: string;
  status: string;
  to: string;
  subject: string;
  latencyMs?: number;
  errorMessage?: string;
  errorClass?: string;
  providerStatusCode?: number;
  governanceDecision?: string;
}): Promise<void> {
  try {
    await db.insert(integrationExecutionLog).values({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      integrationType: 'sendgrid',
      actionType: 'send_email',
      status: params.status,
      inputSummary: JSON.stringify({ to: params.to, subject: params.subject }),
      resultSummary: params.status === 'success' ? 'Email delivered' : undefined,
      errorMessage: params.errorMessage,
      errorClass: params.errorClass,
      providerStatusCode: params.providerStatusCode,
      latencyMs: params.latencyMs,
      governanceChecked: true,
      governanceDecision: params.governanceDecision ?? 'allowed',
    } as any);
  } catch (err) {
    console.error('[Email] Failed to write integration execution log:', err);
  }
}

async function getCredentials() {
  // 1. Direct env var override — highest priority
  if (process.env.SENDGRID_API_KEY) {
    return {
      apiKey: process.env.SENDGRID_API_KEY,
      email: process.env.SENDGRID_FROM_EMAIL || 'bryan.jones@efficiencystrengthtraining.com',
    };
  }

  // 2. Return cached connector credentials if fresh
  const now = Date.now();
  if (_credentialCache && (now - _credentialCacheTs) < CREDENTIAL_CACHE_TTL_MS) {
    return _credentialCache;
  }

  // 3. Fetch from Replit connector
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error('Email provider not configured — SENDGRID_API_KEY is not set and Replit Connectors hostname is unavailable');
  }

  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('Email provider not configured — authentication token unavailable (REPL_IDENTITY/WEB_REPL_RENEWAL missing)');
  }

  let fetchedSettings: any;
  try {
    fetchedSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);
  } catch (fetchErr: any) {
    throw new Error(`Email provider unreachable — could not contact Replit connector service: ${fetchErr.message}`);
  }

  connectionSettings = fetchedSettings;

  if (!connectionSettings?.settings?.api_key) {
    throw new Error('Email provider not configured — SendGrid connector is missing api_key. Connect it in the Replit Secrets panel.');
  }
  if (!connectionSettings?.settings?.from_email) {
    throw new Error('Email provider not configured — SendGrid connector is missing from_email.');
  }

  const creds = { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
  _credentialCache = creds;
  _credentialCacheTs = now;
  return creds;
}

/**
 * Returns true if SendGrid appears to be configured (env var or connector present).
 * Does NOT validate the key — use for fast pre-checks only.
 */
export function isEmailProviderConfigured(): boolean {
  if (process.env.SENDGRID_API_KEY) return true;
  if (process.env.REPLIT_CONNECTORS_HOSTNAME) return true;
  return false;
}

/**
 * Validates that credentials are actually retrievable. Throws with a clear error if not.
 * Call at startup to surface misconfiguration early.
 */
export async function validateEmailProvider(): Promise<{ ok: boolean; fromEmail?: string; error?: string }> {
  try {
    const { email } = await getCredentials();
    return { ok: true, fromEmail: email };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return { client: sgMail, fromEmail: email };
}

async function sendEmail(to: string, subject: string, html: string, senderName?: string, logCtx?: EmailLogContext, replyTo?: string) {
  let finalHtml = html;

  if (logCtx?.recipientUserId) {
    try {
      // Phase 6: Org-only reads — org prefs are the source of truth
      let rawPrefs: any = null;
      if (logCtx.orgId) {
        try {
          const orgPrefs = await storage.getUserOrgPreferences(logCtx.recipientUserId, logCtx.orgId);
          if (orgPrefs?.notificationPreferences) {
            rawPrefs = orgPrefs.notificationPreferences;
          } else if (!orgPrefs) {
            // Edge case: backfill missed this user — warn and fall back to user level
            console.warn(`[Email] No org prefs for user ${logCtx.recipientUserId} in org ${logCtx.orgId} — falling back to user level`);
            const recipientUser = await storage.getUser(logCtx.recipientUserId);
            rawPrefs = recipientUser?.notificationPreferences as any;
          }
        } catch (err) {
          console.error('[Email] Failed to load org prefs, falling back to user prefs:', err);
          const recipientUser = await storage.getUser(logCtx.recipientUserId);
          rawPrefs = recipientUser?.notificationPreferences as any;
        }
      } else {
        // No org context — use user-level prefs directly
        const recipientUser = await storage.getUser(logCtx.recipientUserId);
        rawPrefs = recipientUser?.notificationPreferences as any;
      }
      // Support both flat legacy shape and new nested { email: {...}, sms: {...} } shape
      const emailPrefs: Record<string, boolean> = rawPrefs?.email ?? (rawPrefs && !rawPrefs.email && !rawPrefs.sms ? rawPrefs : DEFAULT_NOTIFICATION_PREFS);
      const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...emailPrefs };
      const prefKey = TYPE_TO_PREF_KEY[logCtx.type];
      const effectivePref = prefKey !== undefined ? (prefs[prefKey] ?? DEFAULT_NOTIFICATION_PREFS[prefKey] ?? true) : true;

      if (effectivePref === false) {
        if (logCtx.orgId) {
          try {
            await storage.createCommunicationLog({
              orgId: logCtx.orgId,
              userId: logCtx.userId,
              coachId: logCtx.coachId,
              bookingId: logCtx.bookingId,
              agentActionId: logCtx.agentActionId,
              type: logCtx.type,
              channel: 'email',
              recipientEmail: to,
              subject,
              status: 'skipped',
              provider: 'sendgrid',
              errorMessage: 'user_opt_out',
            });
          } catch (logErr) {
            console.error('[CommLog] Failed to log skipped email:', logErr);
          }
        }
        console.log(`[Email] Skipped "${subject}" to ${to} (opt-out: ${prefKey})`);
        return;
      }

      try {
        const token = await storage.ensureUnsubscribeToken(logCtx.recipientUserId);
        const orgParam = logCtx.orgId ? `?orgId=${encodeURIComponent(logCtx.orgId)}` : '';
        const unsubUrl = `${UNSUBSCRIBE_BASE_URL}/unsubscribe/${token}${orgParam}`;
        finalHtml = html + `<div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #333;"><p style="font-size:12px;color:#666;margin:0;font-family:Arial,sans-serif;"><a href="${unsubUrl}" style="color:#888;text-decoration:underline;">Manage email preferences</a></p></div>`;
      } catch (tokenErr) {
        console.error('[Email] Failed to generate unsubscribe token:', tokenErr);
      }
    } catch (prefErr) {
      console.error('[Email] Error checking notification preferences:', prefErr);
    }
  }

  // ── Emergency pause guard ─────────────────────────────────────────────────
  if (logCtx?.orgId) {
    const paused = await isEmailEmergencyPaused(logCtx.orgId);
    if (paused) {
      const PAUSE_MSG = 'Blocked: AI operations are paused for this organization. Emergency pause must be disabled before outbound communication can be sent.';
      console.warn(`[Email] Emergency pause active — blocking send (orgId=${logCtx.orgId})`);
      await writeEmailIntegrationLog({ orgId: logCtx.orgId, status: 'blocked', to, subject, errorMessage: PAUSE_MSG, errorClass: 'governance', governanceDecision: 'blocked' });
      try { await logUnifiedAction({ orgId: logCtx.orgId, actorType: 'system', actorName: 'relay_agent', actionType: 'governance_blocked', status: 'blocked', riskLevel: 'high', reasoningSummary: PAUSE_MSG }); } catch {}
      try { await storage.createCommunicationLog({ orgId: logCtx.orgId, userId: logCtx.userId, coachId: logCtx.coachId, bookingId: logCtx.bookingId, agentActionId: logCtx.agentActionId, type: logCtx.type, channel: 'email', recipientEmail: to, subject, status: 'failed', provider: 'sendgrid', errorMessage: PAUSE_MSG }); } catch {}
      return;
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const _emailSendStart = Date.now();
  let errorMsg: string | undefined;
  let _providerStatus: number | undefined;
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to,
      from: { email: fromEmail, name: senderName || 'Train Efficiency' },
      ...(replyTo ? { replyTo: replyTo } : {}),
      subject,
      html: finalHtml,
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (error: any) {
    errorMsg = error?.response?.body ? JSON.stringify(error.response.body) : (error.message || 'Unknown error');
    _providerStatus = error?.response?.status;
    console.error(`Failed to send email to ${to}:`, error?.response?.body || error.message);
  }
  const _emailLatencyMs = Date.now() - _emailSendStart;

  if (logCtx?.orgId) {
    try {
      await storage.createCommunicationLog({
        orgId: logCtx.orgId,
        userId: logCtx.userId,
        coachId: logCtx.coachId,
        bookingId: logCtx.bookingId,
        agentActionId: logCtx.agentActionId,
        type: logCtx.type,
        channel: 'email',
        recipientEmail: to,
        subject,
        status: errorMsg ? 'failed' : 'sent',
        provider: 'sendgrid',
        errorMessage: errorMsg,
      });
    } catch (logErr) {
      console.error('[CommLog] Failed to write communication log:', logErr);
    }
    // Mirror into integration_execution_log for unified observability
    await writeEmailIntegrationLog({
      orgId: logCtx.orgId,
      status: errorMsg ? 'failed' : 'success',
      to,
      subject,
      latencyMs: _emailLatencyMs,
      errorMessage: errorMsg,
      errorClass: errorMsg ? 'permanent' : undefined,
      providerStatusCode: _providerStatus,
      governanceDecision: 'allowed',
    });
  }
}

export async function sendWelcomeEmail(email: string, firstName: string, org?: OrgBranding) {
  const b = brand(org);
  const subject = `Welcome to ${b.name}!`;
  const html = emailShell(`Welcome to ${b.name}!`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`Thanks for creating your account with <strong>${b.name}</strong>! We're excited to help you reach your performance goals.`)}
    ${para("Here's what you can do:")}
    <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
      <li>Browse coaches and their specialties</li>
      <li>Book training sessions</li>
      <li>Join open group sessions</li>
    </ul>
    ${para("Ready to get started? Log in and book your first session today!")}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendCoachWelcomeEmail(email: string, firstName: string, password?: string, org?: OrgBranding) {
  const b = brand(org);
  const subject = `Welcome to the ${b.name} Coaching Team!`;
  const credBlock = password ? detailBox([
    line("Login Email", email),
    line("Password", password),
  ], b.color, b.secondaryColor) : '';
  const html = emailShell(`Welcome, Coach ${firstName}!`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`You've been added as a coach on the <strong>${b.name}</strong> scheduling platform. We're excited to have you on the team!`)}
    ${credBlock}
    ${para("Here's what you can do as a coach:")}
    <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
      <li>Manage your availability and schedule</li>
      <li>View and manage client sessions</li>
      <li>Track your business analytics</li>
      <li>Redeem completed sessions</li>
    </ul>
    ${para("Log in using the Coach Sign In button to get started." + (password ? " We recommend changing your password after your first login." : ""))}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendBookingConfirmationToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Session Confirmed — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Session Confirmed", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("Your training session has been confirmed! Here are the details:")}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("See you there! If you need to make changes, you can manage your bookings from your account.")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name, logCtx);
}

export async function sendBookingNotificationToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `New Session Booked — ${clientName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("New Session Booked", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para("A new session has been booked on your schedule:")}
    ${detailBox([
      line("Client", clientName),
      line("Service", serviceName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("You can view and manage this session from your coach dashboard.")}
  `, org);
  await sendEmail(coachEmail, subject, html, b.name);
}

export async function sendCashoutRequestEmail(
  ownerEmail: string,
  coachName: string,
  amountCents: number,
  cashoutId: string,
  org?: OrgBranding
) {
  const b = brand(org);
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;
  const html = emailShell("Cash Out Request", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${b.ownerName},</p>
    ${para(`<strong>${coachName}</strong> has requested a cash out of their redeemed sessions.`)}
    ${detailBox([
      bigLine("Amount", amountStr),
      `<p style="font-size: 14px; margin: 4px 0; color: #888;">Cashout ID: ${cashoutId}</p>`,
    ], b.color, b.secondaryColor)}
    ${para("Please process this payout at your earliest convenience. You can manage cashout requests from the admin dashboard.")}
  `, org);
  await sendEmail(ownerEmail, `Cash Out Request — ${coachName}`, html, b.name);
}

export async function sendPaymentConfirmationEmail(
  clientEmail: string,
  clientFirstName: string,
  amountCents: number,
  description: string,
  newBalanceCents: number,
  org?: OrgBranding
) {
  const b = brand(org);
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;
  const balanceStr = newBalanceCents < 0
    ? `-$${(Math.abs(newBalanceCents) / 100).toFixed(2)}`
    : `$${(newBalanceCents / 100).toFixed(2)}`;

  const html = emailShell("Payment Confirmation", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("We've received your payment. Here are the details:")}
    ${detailBox([
      bigLine("Amount", amountStr),
      line("Description", description),
      line("Updated Wallet Balance", balanceStr),
    ], b.color, b.secondaryColor)}
    ${para("Thank you for your payment! You can view your full transaction history from your account.")}
  `, org);
  await sendEmail(clientEmail, `Payment Confirmation — ${b.name}`, html, b.name);
}

export async function sendSessionChargeEmail(
  clientEmail: string,
  clientFirstName: string,
  amountCents: number,
  serviceName: string,
  newBalanceCents: number,
  org?: OrgBranding
) {
  const b = brand(org);
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;
  const balanceStr = newBalanceCents < 0
    ? `-$${(Math.abs(newBalanceCents) / 100).toFixed(2)}`
    : `$${(newBalanceCents / 100).toFixed(2)}`;

  const html = emailShell("Session Charged", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("Your completed session has been charged to your wallet:")}
    ${detailBox([
      line("Session", serviceName),
      bigLine("Amount Charged", amountStr),
      line("Updated Wallet Balance", balanceStr),
    ], b.color, b.secondaryColor)}
    ${para("You can view your full transaction history from your account. If you have any questions, feel free to reach out.")}
  `, org);
  await sendEmail(clientEmail, `Session Charged — ${serviceName}`, html, b.name);
}

export async function sendWeeklyReminderEmail(email: string, firstName: string, org?: OrgBranding) {
  const b = brand(org);
  const subject = `We miss you at ${b.name}! Time to schedule a session`;
  const html = emailShell("Time to Get Back in the Game!", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`It's been a while since your last visit to <strong>${b.name}</strong>. Consistency is the key to reaching your performance goals!`)}
    ${para("Here are a few ways to get back on track:")}
    <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
      <li>Book a 1:1 session with one of our expert coaches</li>
      <li>Join an open group session</li>
      <li>Check out new available time slots that fit your schedule</li>
    </ul>
    <p style="font-size: 12px; color: #666; margin-top: 16px;">You're receiving this because you have an account with ${b.name}. Sign in to your account to manage your email preferences.</p>
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendGroupSessionJoinConfirmation(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding
) {
  const b = brand(org);
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("You're Registered!", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("You've successfully joined a group training session! Here are the details:")}
    ${detailBox([
      line("Session", serviceName),
      line("Coach", coachName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("We look forward to seeing you there! If you need to make changes, you can manage your bookings from your account.")}
  `, org);
  await sendEmail(clientEmail, `You're In! — ${serviceName}`, html, b.name);
}

export async function sendGroupSessionJoinNotification(
  coachEmail: string,
  coachFirstName: string,
  participantName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding
) {
  const b = brand(org);
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("New Participant Joined", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para(`<strong>${participantName}</strong> has joined your upcoming group session:`)}
    ${detailBox([
      line("Session", serviceName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("You can view the full participant list from your coach dashboard.")}
  `, org);
  await sendEmail(coachEmail, `New Participant Joined — ${serviceName}`, html, b.name);
}

export async function sendTeamQuoteEmail(
  coachEmail: string,
  teamName: string,
  numberOfAthletes: number,
  costPerAthleteCents: number,
  trainingType: string,
  frequency: string,
  durationMonths: number,
  monthlyCents: number,
  invoiceUrl: string,
  currentMonth: number = 1,
  totalMonths: number = 1,
  org?: OrgBranding
) {
  const b = brand(org);
  const monthLabel = totalMonths > 1 ? ` (Month ${currentMonth} of ${totalMonths})` : '';
  const subject = `Team Training Invoice — ${teamName}${monthLabel}`;
  const costPerAthleteStr = `$${(costPerAthleteCents / 100).toFixed(2)}`;
  const monthlyStr = `$${(monthlyCents / 100).toFixed(2)}`;
  const programTotalStr = `$${((monthlyCents * totalMonths) / 100).toFixed(2)}`;
  const monthInfo = totalMonths > 1
    ? line("Billing Period", `Month ${currentMonth} of ${totalMonths}`)
    : '';
  const programTotalLine = totalMonths > 1
    ? `<p style="font-size: 14px; margin: 4px 0; color: #aaa;">Program Total (${totalMonths} months): ${programTotalStr}</p>`
    : '';

  const html = emailShell(`Team Training Invoice${monthLabel}`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hello,</p>
    ${para(currentMonth === 1 ? `A team training program has been set up for <strong>${teamName}</strong>.` : `The next monthly invoice for <strong>${teamName}</strong> is ready.`)}
    ${detailBox([
      line("Team", teamName),
      line("Athletes", String(numberOfAthletes)),
      line("Cost per Athlete", `${costPerAthleteStr}/session`),
      line("Training Type", trainingType),
      line("Frequency", frequency),
      line("Program Duration", `${durationMonths} months`),
      monthInfo,
      bigLine("Monthly Invoice", monthlyStr),
      programTotalLine,
    ], b.color, b.secondaryColor)}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${invoiceUrl}" style="display: inline-block; background: ${b.color}; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: 600;">View & Pay Invoice</a>
    </div>
    <p style="font-size: 14px; color: #888;">${totalMonths > 1 && currentMonth < totalMonths ? "Once paid, the next month's invoice will be sent automatically." : ""} This invoice was generated through Stripe.</p>
  `, org);
  await sendEmail(coachEmail, subject, html, b.name);
}

export async function sendTeamTrainingRequestEmail(
  data: {
    teamName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    location: string;
    sport: string;
    numberOfAthletes: number;
    goals: string;
    preferredSchedule: string;
    additionalNotes: string;
  },
  ownerEmail?: string,
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `New Team Training Request — ${data.teamName}`;
  const recipient = ownerEmail || 'bryan.jones@efficiencystrengthtraining.com';

  const html = emailShell("New Team Training Request", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">A new team training inquiry has been submitted:</p>
    ${detailBox([
      line("Team Name", data.teamName),
      line("Sport", data.sport),
      line("Number of Athletes", String(data.numberOfAthletes)),
      line("Location", data.location),
      line("Preferred Schedule", data.preferredSchedule || 'Not specified'),
    ], b.color, b.secondaryColor)}
    ${detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">CONTACT INFO</p>`,
      line("Name", data.contactName),
      line("Email", data.contactEmail),
      line("Phone", data.contactPhone || 'Not provided'),
    ], b.color, b.secondaryColor)}
    ${detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">TRAINING GOALS</p>`,
      `<p style="font-size: 15px; margin: 4px 0; white-space: pre-wrap;">${data.goals}</p>`,
    ], b.color, b.secondaryColor)}
    ${data.additionalNotes ? detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">ADDITIONAL NOTES</p>`,
      `<p style="font-size: 15px; margin: 4px 0; white-space: pre-wrap;">${data.additionalNotes}</p>`,
    ], b.color, b.secondaryColor) : ''}
  `, org);
  await sendEmail(recipient, subject, html, b.name);
}

export async function sendSubscriptionExpiredEmail(email: string, orgName: string, reason: "trial_ended" | "canceled" | "past_due") {
  const b = brand({ name: "Train Efficiency" });

  const reasonText = reason === "trial_ended"
    ? "Your 3-day free trial has ended."
    : reason === "past_due"
    ? "Your most recent payment failed."
    : "Your subscription has been canceled.";

  const actionText = reason === "past_due"
    ? "Please update your payment method to restore access to your platform."
    : "Resubscribe to restore access to your platform and keep your coaching business running.";

  const subject = reason === "past_due"
    ? `Action Required: Payment Failed for ${orgName}`
    : `Your ${orgName} Subscription Has Ended`;

  const html = emailShell(subject, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi there,</p>
    ${para(`${reasonText} Access to the <strong>${orgName}</strong> platform has been paused.`)}
    ${detailBox([
      line("Organization", orgName),
      line("Status", reason === "past_due" ? "Payment Failed" : "Subscription Ended"),
      line("Action Needed", actionText),
    ], b.color, b.secondaryColor)}
    ${para(actionText)}
    ${para('Log in to your admin dashboard and visit <strong>Configuration → Subscription</strong> to manage your plan.')}
  `);
  await sendEmail(email, subject, html, b.name);
}

export async function sendSubscriberSessionNotification(
  email: string,
  firstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  signUpUrl?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `A Session Has Been Scheduled for You — ${b.name}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const ctaUrl = signUpUrl || `https://trainefficiency.com`;
  const html = emailShell("Session Scheduled for You", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`Your coach has scheduled a training session for you with <strong>${b.name}</strong>. Here are the details:`)}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("Want to manage your bookings, view your schedule, and book more sessions?")}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${ctaUrl}" style="display: inline-block; background: ${b.color}; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Sign Up for ${b.name}</a>
    </div>
    ${para("Create an account to get the full experience — view upcoming sessions, book new ones, and stay connected with your coach.")}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendSubscriptionClaimEmail(
  email: string,
  firstName: string,
  planName: string,
  planPrice: string,
  claimUrl: string,
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `Complete Your ${planName} Account — ${b.name}`;
  const html = emailShell(`Connect Your Subscription — ${b.name}`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`You have an active <strong>${planName}</strong> subscription with <strong>${b.name}</strong>. Create your free platform account to manage your sessions, view your schedule, and connect with your coach.`)}
    ${detailBox([
      line("Plan", planName),
      line("Price", planPrice),
      line("Organization", b.name),
    ], b.color, b.secondaryColor)}
    ${para("Click below to create your account. Your existing subscription will be automatically linked — no new payment required.")}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${claimUrl}" style="display: inline-block; background: ${b.color}; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Create My Account</a>
    </div>
    ${para("Already have an account? Use the same link to log in and your subscription will connect automatically.")}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendClientInviteEmail(
  email: string,
  firstName: string,
  resetLink: string,
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `You're Invited to ${b.name}!`;
  const html = emailShell(`You're Invited!`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`You've been added to the <strong>${b.name}</strong> platform by your coach. To get started, create a password for your account.`)}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetLink}" style="display: inline-block; background: ${b.color}; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Create Your Password</a>
    </div>
    ${para("Once you set your password, you'll be able to:")}
    <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
      <li>Browse coaches and their specialties</li>
      <li>Book training sessions</li>
      <li>Join open group sessions</li>
    </ul>
    ${para("This link will expire in 7 days. If it expires, contact your coach to resend the invite.")}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendSchedulingInquiryEmail(
  toEmail: string,
  toName: string,
  userMessage: string,
  userName?: string,
  userEmail?: string,
  org?: OrgBranding
) {
  const b = brand(org);
  const subject = `New Scheduling Inquiry${userName ? ` — ${userName}` : ""}`;
  const fromLine = userName ? line("From", `${userName}${userEmail ? ` (${userEmail})` : ""}`) : (userEmail ? line("Email", userEmail) : "");

  const html = emailShell("New Scheduling Inquiry", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${toName},</p>
    ${para("A user has submitted a scheduling inquiry through the AI assistant:")}
    ${detailBox([
      fromLine,
      `<p style="font-size: 15px; margin: 8px 0 0;"><strong>Message:</strong></p>`,
      `<p style="font-size: 15px; margin: 4px 0; white-space: pre-wrap;">${userMessage}</p>`,
    ], b.color, b.secondaryColor)}
    ${para("Please follow up with this user at your earliest convenience to discuss available times and next steps.")}
  `, org);
  await sendEmail(toEmail, subject, html, b.name);
}

/**
 * Returns dynamic subject/body labels for session reminder emails based on the
 * session date relative to "now", both evaluated in the org/session timezone.
 *
 * - same calendar day  → "Session Today"  / "today"
 * - next calendar day  → "Session Tomorrow" / "tomorrow"
 * - anything else      → "Upcoming Session" / "soon"
 *
 * Dates are compared as YYYY-MM-DD strings in the given timezone so that UTC
 * midnight crossings never flip a same-day session to "tomorrow".
 */
export function getSessionReminderLabel(
  sessionStartTime: Date,
  timezone: string = "America/New_York"
): { subjectLabel: string; bodyLabel: string } {
  const toDateStr = (d: Date) =>
    toZonedTime(d, timezone).toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD

  const sessionDateStr = toDateStr(sessionStartTime);
  const nowDateStr = toDateStr(new Date());

  const sessionDay = new Date(sessionDateStr);
  const nowDay = new Date(nowDateStr);
  const diffDays = Math.round(
    (sessionDay.getTime() - nowDay.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return { subjectLabel: "Session Today", bodyLabel: "today" };
  if (diffDays === 1) return { subjectLabel: "Session Tomorrow", bodyLabel: "tomorrow" };
  return { subjectLabel: "Upcoming Session", bodyLabel: "soon" };
}

export async function sendUpcomingSessionReminderEmailToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const { subjectLabel, bodyLabel } = getSessionReminderLabel(startAt, timezone);
  const subject = `Reminder: ${subjectLabel} — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell(`${subjectLabel} — ${serviceName}`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para(`This is a friendly reminder that you have a training session on your schedule ${bodyLabel}:`)}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("We look forward to seeing you! If you need to make any changes, please log in to your account ahead of time.")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name, logCtx);
}

export async function sendUpcomingSessionReminderEmailToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const { subjectLabel, bodyLabel } = getSessionReminderLabel(startAt, timezone);
  const subject = `Reminder: ${subjectLabel} — ${clientName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell(`${subjectLabel} — ${clientName}`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para(`This is a reminder that you have a session on your schedule ${bodyLabel}:`)}
    ${detailBox([
      line("Client", clientName),
      line("Service", serviceName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("You can view your full schedule and manage sessions from your coach dashboard.")}
  `, org);
  await sendEmail(coachEmail, subject, html, b.name, logCtx);
}

export async function sendBookingCancellationEmailToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Session Cancelled — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Session Cancelled", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("Your upcoming training session has been cancelled. Here are the details of the cancelled session:")}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("If you'd like to rebook or have any questions, please log in to your account or reach out to your coach.")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name, logCtx);
}

export async function sendBookingCancellationEmailToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Session Cancelled — ${clientName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Session Cancelled", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para(`A session on your schedule has been cancelled:`)}
    ${detailBox([
      line("Client", clientName),
      line("Service", serviceName),
      line("Date", dateStr),
      line("Time", timeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("This time slot is now open on your calendar. You can manage your schedule from your coach dashboard.")}
  `, org);
  await sendEmail(coachEmail, subject, html, b.name, logCtx);
}

export async function sendBookingRescheduleEmailToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  oldStartAt: Date,
  oldEndAt: Date,
  newStartAt: Date,
  newEndAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Session Rescheduled — ${serviceName}`;
  const zonedOldStart = toZonedTime(oldStartAt, timezone);
  const zonedOldEnd = toZonedTime(oldEndAt, timezone);
  const zonedNewStart = toZonedTime(newStartAt, timezone);
  const zonedNewEnd = toZonedTime(newEndAt, timezone);
  const oldDateStr = format(zonedOldStart, "EEEE, MMMM d, yyyy");
  const oldTimeStr = `${format(zonedOldStart, "h:mm a")} — ${format(zonedOldEnd, "h:mm a")}`;
  const newDateStr = format(zonedNewStart, "EEEE, MMMM d, yyyy");
  const newTimeStr = `${format(zonedNewStart, "h:mm a")} — ${format(zonedNewEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Session Rescheduled", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para("Your training session has been rescheduled. Here are the updated details:")}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      `<p style="font-size: 14px; color: #888; margin: 8px 0 4px;">PREVIOUSLY</p>`,
      line("Date", oldDateStr),
      line("Time", oldTimeStr),
      `<p style="font-size: 14px; color: #888; margin: 8px 0 4px;">NEW TIME</p>`,
      line("Date", newDateStr),
      line("Time", newTimeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("If you have any questions about this change, please reach out to your coach or log in to your account.")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name, logCtx);
}

export async function sendBookingRescheduleEmailToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  oldStartAt: Date,
  oldEndAt: Date,
  newStartAt: Date,
  newEndAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Session Rescheduled — ${clientName}`;
  const zonedOldStart = toZonedTime(oldStartAt, timezone);
  const zonedOldEnd = toZonedTime(oldEndAt, timezone);
  const zonedNewStart = toZonedTime(newStartAt, timezone);
  const zonedNewEnd = toZonedTime(newEndAt, timezone);
  const oldDateStr = format(zonedOldStart, "EEEE, MMMM d, yyyy");
  const oldTimeStr = `${format(zonedOldStart, "h:mm a")} — ${format(zonedOldEnd, "h:mm a")}`;
  const newDateStr = format(zonedNewStart, "EEEE, MMMM d, yyyy");
  const newTimeStr = `${format(zonedNewStart, "h:mm a")} — ${format(zonedNewEnd, "h:mm a")}`;
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Session Rescheduled", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para(`A session on your schedule has been rescheduled:`)}
    ${detailBox([
      line("Client", clientName),
      line("Service", serviceName),
      `<p style="font-size: 14px; color: #888; margin: 8px 0 4px;">PREVIOUSLY</p>`,
      line("Date", oldDateStr),
      line("Time", oldTimeStr),
      `<p style="font-size: 14px; color: #888; margin: 8px 0 4px;">NEW TIME</p>`,
      line("Date", newDateStr),
      line("Time", newTimeStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("Your dashboard has been updated to reflect the new time.")}
  `, org);
  await sendEmail(coachEmail, subject, html, b.name, logCtx);
}

export async function sendRecurringSessionsCreatedEmailToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  sessionCount: number,
  firstSessionAt: Date,
  lastSessionAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Recurring Sessions Confirmed — ${serviceName}`;
  const zonedFirst = toZonedTime(firstSessionAt, timezone);
  const zonedLast = toZonedTime(lastSessionAt, timezone);
  const firstDateStr = format(zonedFirst, "EEEE, MMMM d, yyyy 'at' h:mm a");
  const lastDateStr = format(zonedLast, "EEEE, MMMM d, yyyy 'at' h:mm a");
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Recurring Sessions Confirmed", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    ${para(`Your coach has scheduled a recurring training program for you. Here's what's been booked:`)}
    ${detailBox([
      line("Service", serviceName),
      line("Coach", coachName),
      line("Sessions Booked", String(sessionCount)),
      line("First Session", firstDateStr),
      line("Last Session", lastDateStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("You can view all of your upcoming sessions by logging in to your account. See you on the schedule!")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name, logCtx);
}

export async function sendRecurringSessionsCreatedEmailToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  sessionCount: number,
  firstSessionAt: Date,
  lastSessionAt: Date,
  location?: string,
  timezone: string = "America/New_York",
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const subject = `Recurring Sessions Created — ${clientName}`;
  const zonedFirst = toZonedTime(firstSessionAt, timezone);
  const zonedLast = toZonedTime(lastSessionAt, timezone);
  const firstDateStr = format(zonedFirst, "EEEE, MMMM d, yyyy 'at' h:mm a");
  const lastDateStr = format(zonedLast, "EEEE, MMMM d, yyyy 'at' h:mm a");
  const locationLine = location ? line("Location", location) : '';

  const html = emailShell("Recurring Sessions Created", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
    ${para(`A recurring session program has been added to your schedule:`)}
    ${detailBox([
      line("Client", clientName),
      line("Service", serviceName),
      line("Sessions Created", String(sessionCount)),
      line("First Session", firstDateStr),
      line("Last Session", lastDateStr),
      locationLine,
    ], b.color, b.secondaryColor)}
    ${para("All sessions are now confirmed on your calendar. You can view and manage them from your coach dashboard.")}
  `, org);
  await sendEmail(coachEmail, subject, html, b.name, logCtx);
}

export async function sendAgentOutreachEmail(
  clientEmail: string,
  clientFirstName: string,
  emailSubject: string,
  emailBody: string,
  org?: OrgBranding,
  logCtx?: EmailLogContext
) {
  const b = brand(org);
  const html = emailShell(emailSubject, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
    <p style="font-size: 16px; line-height: 1.7; margin: 0 0 24px 0;">${emailBody.replace(/\n/g, "<br>")}</p>
  `, org);
  await sendEmail(clientEmail, emailSubject, html, b.name, logCtx);
}

function injectTrackingPixel(html: string, emailId: string, baseUrl: string): string {
  const pixelUrl = `${baseUrl}/api/email-agent/track-open/${emailId}`;
  const pixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;" />`;
  return html.replace(/<\/div>\s*$/, `${pixel}</div>`);
}

function wrapLinksForTracking(html: string, emailId: string, baseUrl: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
    const encoded = encodeURIComponent(url);
    return `href="${baseUrl}/api/email-agent/track-click/${emailId}?url=${encoded}"`;
  });
}

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  "https://trainefficiency.com";

export async function sendTeamTrainingOutreachEmail(
  toEmail: string,
  subject: string,
  body: string,
  org?: OrgBranding,
  emailId?: string,
  replyTo?: string,
) {
  const b = brand(org);
  let html = emailShell(subject, `
    <div style="font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${body.replace(/\n/g, "<br>")}</div>
  `, org);
  if (emailId) {
    html = injectTrackingPixel(html, emailId, APP_BASE_URL);
    html = wrapLinksForTracking(html, emailId, APP_BASE_URL);
  }
  await sendEmail(toEmail, subject, html, b.name, undefined, replyTo);
}

export async function sendPasswordResetEmail(toEmail: string, resetUrl: string) {
  const subject = "Reset your TrainEfficiency password";
  const html = emailShell("Reset Your Password", `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi,</p>
    ${para("We received a request to reset the password for your TrainEfficiency account. Click the button below to set a new password:")}
    <div style="text-align: center; margin: 32px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: #16a34a; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 600;">Reset Password</a>
    </div>
    ${para("Or copy and paste this link into your browser:")}
    <p style="font-size: 13px; color: #888; word-break: break-all; margin: 8px 0 16px;">${resetUrl}</p>
    ${para("This link will expire in <strong>1 hour</strong>.")}
    ${para("If you didn't request a password reset, you can safely ignore this email — your password will not be changed.")}
  `);
  await sendEmail(toEmail, subject, html, "Train Efficiency");
}

export async function sendOrgAthleteWelcomeEmail(
  email: string,
  name: string,
  org: OrgBranding,
  loginUrl?: string,
) {
  const b = brand(org);
  const firstName = name.split(" ")[0] || name;
  const subject = `Welcome to ${b.name}`;
  const ctaUrl = loginUrl || "https://trainefficiency.com";
  const html = emailShell(`Welcome to ${b.name}`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`You're officially part of <strong>${b.name}</strong>. Your athlete account is ready and your coaches are excited to have you.`)}
    ${detailBox([
      `<p style="font-size: 15px; margin: 6px 0;"><strong>What you now have access to:</strong></p>`,
      `<ul style="font-size: 14px; line-height: 1.9; padding-left: 18px; margin: 4px 0;">
        <li>PR Tracker — log and track every personal record</li>
        <li>Workout Builder — view and complete assigned workouts</li>
        <li>Team boards — see your team's progress and standings</li>
        <li>Coach communication — stay connected with your training staff</li>
      </ul>`,
    ], b.color, b.secondaryColor)}
    ${para("Access everything from your phone or desktop — no app download required.")}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${ctaUrl}" style="display: inline-block; background: ${b.color}; color: #fff; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px; text-decoration: none;">Start Tracking PRs</a>
    </div>
    ${para(`Your coaches at <strong>${b.name}</strong> are ready when you are. Log in, complete your profile, and start building your record.`)}
  `, org);
  await sendEmail(email, subject, html, b.name);
}

export async function sendOrgTeamCoachWelcomeEmail(
  email: string,
  name: string,
  org: OrgBranding,
  loginUrl?: string,
) {
  const b = brand(org);
  const firstName = name.split(" ")[0] || name;
  const subject = `You've been added as a coach — ${b.name}`;
  const ctaUrl = loginUrl || "https://trainefficiency.com";
  const html = emailShell(`You've been added as a coach`, `
    <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
    ${para(`Your coach account on <strong>${b.name}</strong> is ready. You can now manage your team, assign workouts, and track athlete progress directly from the platform.`)}
    ${detailBox([
      `<p style="font-size: 15px; margin: 6px 0;"><strong>Your coach tools include:</strong></p>`,
      `<ul style="font-size: 14px; line-height: 1.9; padding-left: 18px; margin: 4px 0;">
        <li>Workout Builder — create and assign custom programs to athletes</li>
        <li>PR Tracker management — monitor athlete performance records</li>
        <li>Team management — organize athletes, set goals, view leaderboards</li>
        <li>Athlete communication — send updates, notes, and feedback</li>
        <li>Session scheduling — plan and manage training schedules</li>
      </ul>`,
    ], b.color, b.secondaryColor)}
    ${para("Use your team join code to invite athletes to your roster. They'll connect directly to your team on signup.")}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${ctaUrl}" style="display: inline-block; background: ${b.color}; color: #fff; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px; text-decoration: none;">Open Coach Dashboard</a>
    </div>
    ${para(`Welcome to the ${b.name} coaching staff. Reach out to the organization admin if you need help getting started.`)}
  `, org);
  await sendEmail(email, subject, html, b.name);
}
