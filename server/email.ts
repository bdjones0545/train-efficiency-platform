// SendGrid email integration for EST notifications
import sgMail from '@sendgrid/mail';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

let connectionSettings: any;

async function getCredentials() {
  if (process.env.SENDGRID_API_KEY) {
    return {
      apiKey: process.env.SENDGRID_API_KEY,
      email: 'bryan.jones@efficiencystrengthtraining.com',
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return { client: sgMail, fromEmail: email };
}

async function sendEmail(to: string, subject: string, html: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to,
      from: { email: fromEmail, name: 'Efficiency Strength Training' },
      subject,
      html,
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (error: any) {
    console.error(`Failed to send email to ${to}:`, error?.response?.body || error.message);
  }
}

export async function sendWelcomeEmail(email: string, firstName: string) {
  const subject = 'Welcome to Efficiency Strength Training!';
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Welcome to EST!</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">Thanks for creating your account with <strong>Efficiency Strength Training</strong>! We're excited to help you reach your performance goals.</p>
        <p style="font-size: 16px; line-height: 1.6;">Here's what you can do:</p>
        <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
          <li>Browse our coaches and their specialties</li>
          <li>Book 1:1 or semi-private training sessions</li>
          <li>Claim your free 30-minute intro session</li>
          <li>Join open group sessions</li>
        </ul>
        <p style="font-size: 16px; line-height: 1.6;">Ready to get started? Log in and book your first session today!</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— The EST Team<br/>Bluffton / Hilton Head Island, SC</p>
      </div>
    </div>
  `;
  await sendEmail(email, subject, html);
}

export async function sendBookingConfirmationToClient(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York"
) {
  const subject = `Session Confirmed — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? `<p style="font-size: 15px; margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : '';

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Session Confirmed</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">Your training session has been confirmed! Here are the details:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 15px; margin: 4px 0;"><strong>Service:</strong> ${serviceName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Coach:</strong> ${coachName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Date:</strong> ${dateStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Time:</strong> ${timeStr}</p>
          ${locationLine}
        </div>
        <p style="font-size: 16px; line-height: 1.6;">See you there! If you need to make changes, you can manage your bookings from your account.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(clientEmail, subject, html);
}

export async function sendCashoutRequestEmail(
  ownerEmail: string,
  coachName: string,
  amountCents: number,
  cashoutId: string
) {
  const subject = `Cash Out Request — ${coachName}`;
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Cash Out Request</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi Bryan,</p>
        <p style="font-size: 16px; line-height: 1.6;"><strong>${coachName}</strong> has requested a cash out of their redeemed sessions.</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 18px; margin: 4px 0; font-weight: bold;">Amount: ${amountStr}</p>
          <p style="font-size: 14px; margin: 4px 0; color: #888;">Cashout ID: ${cashoutId}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Please process this payout at your earliest convenience. You can manage cashout requests from the admin dashboard.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(ownerEmail, subject, html);
}

export async function sendPaymentConfirmationEmail(
  clientEmail: string,
  clientFirstName: string,
  amountCents: number,
  description: string,
  newBalanceCents: number
) {
  const subject = `Payment Confirmation — Efficiency Strength Training`;
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;
  const balanceStr = newBalanceCents < 0
    ? `-$${(Math.abs(newBalanceCents) / 100).toFixed(2)}`
    : `$${(newBalanceCents / 100).toFixed(2)}`;

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Payment Confirmation</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">We've received your payment. Here are the details:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 18px; margin: 4px 0; font-weight: bold;">Amount: ${amountStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Description:</strong> ${description}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Updated Wallet Balance:</strong> ${balanceStr}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Thank you for your payment! You can view your full transaction history from your account.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(clientEmail, subject, html);
}

export async function sendSessionChargeEmail(
  clientEmail: string,
  clientFirstName: string,
  amountCents: number,
  serviceName: string,
  newBalanceCents: number
) {
  const subject = `Session Charged — ${serviceName}`;
  const amountStr = `$${(amountCents / 100).toFixed(2)}`;
  const balanceStr = newBalanceCents < 0
    ? `-$${(Math.abs(newBalanceCents) / 100).toFixed(2)}`
    : `$${(newBalanceCents / 100).toFixed(2)}`;

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Session Charged</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">Your completed session has been charged to your wallet:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 15px; margin: 4px 0;"><strong>Session:</strong> ${serviceName}</p>
          <p style="font-size: 18px; margin: 4px 0; font-weight: bold;">Amount Charged: ${amountStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Updated Wallet Balance:</strong> ${balanceStr}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">You can view your full transaction history from your account. If you have any questions, feel free to reach out.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(clientEmail, subject, html);
}

export async function sendWeeklyReminderEmail(email: string, firstName: string) {
  const subject = "We miss you at EST! Time to schedule a session";
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">Time to Get Back in the Game!</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${firstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">It's been a while since your last visit to <strong>Efficiency Strength Training</strong>. Consistency is the key to reaching your performance goals!</p>
        <p style="font-size: 16px; line-height: 1.6;">Here are a few ways to get back on track:</p>
        <ul style="font-size: 15px; line-height: 1.8; padding-left: 20px;">
          <li>Book a 1:1 session with one of our expert coaches</li>
          <li>Join an open semi-private group session</li>
          <li>Check out new available time slots that fit your schedule</li>
        </ul>
        <div style="text-align: center; margin: 24px 0;">
          <a href="https://efficiencystrengthtraining.com" style="display: inline-block; background: #16a34a; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">Schedule a Session</a>
        </div>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— The EST Team<br/>Bluffton / Hilton Head Island, SC</p>
        <p style="font-size: 12px; color: #666; margin-top: 16px;">You're receiving this because you have an account with Efficiency Strength Training. Sign in to your account to manage your email preferences.</p>
      </div>
    </div>
  `;
  await sendEmail(email, subject, html);
}

export async function sendGroupSessionJoinConfirmation(
  clientEmail: string,
  clientFirstName: string,
  coachName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York"
) {
  const subject = `You're In! — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? `<p style="font-size: 15px; margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : '';

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">You're Registered!</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${clientFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">You've successfully joined a group training session! Here are the details:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 15px; margin: 4px 0;"><strong>Session:</strong> ${serviceName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Coach:</strong> ${coachName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Date:</strong> ${dateStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Time:</strong> ${timeStr}</p>
          ${locationLine}
        </div>
        <p style="font-size: 16px; line-height: 1.6;">We look forward to seeing you there! If you need to make changes, you can manage your bookings from your account.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(clientEmail, subject, html);
}

export async function sendGroupSessionJoinNotification(
  coachEmail: string,
  coachFirstName: string,
  participantName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York"
) {
  const subject = `New Participant Joined — ${serviceName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? `<p style="font-size: 15px; margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : '';

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">New Participant Joined</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;"><strong>${participantName}</strong> has joined your upcoming group session:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 15px; margin: 4px 0;"><strong>Session:</strong> ${serviceName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Date:</strong> ${dateStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Time:</strong> ${timeStr}</p>
          ${locationLine}
        </div>
        <p style="font-size: 16px; line-height: 1.6;">You can view the full participant list from your coach dashboard.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(coachEmail, subject, html);
}

export async function sendBookingNotificationToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string,
  timezone: string = "America/New_York"
) {
  const subject = `New Session Booked — ${clientName}`;
  const zonedStart = toZonedTime(startAt, timezone);
  const zonedEnd = toZonedTime(endAt, timezone);
  const dateStr = format(zonedStart, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(zonedStart, "h:mm a")} — ${format(zonedEnd, "h:mm a")}`;
  const locationLine = location ? `<p style="font-size: 15px; margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : '';

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
      <div style="background: #16a34a; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 24px; color: #fff;">New Session Booked</h1>
      </div>
      <div style="padding: 32px;">
        <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Hi ${coachFirstName},</p>
        <p style="font-size: 16px; line-height: 1.6;">A new session has been booked on your schedule:</p>
        <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid #16a34a;">
          <p style="font-size: 15px; margin: 4px 0;"><strong>Client:</strong> ${clientName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Service:</strong> ${serviceName}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Date:</strong> ${dateStr}</p>
          <p style="font-size: 15px; margin: 4px 0;"><strong>Time:</strong> ${timeStr}</p>
          ${locationLine}
        </div>
        <p style="font-size: 16px; line-height: 1.6;">You can view and manage this session from your coach dashboard.</p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">— Efficiency Strength Training</p>
      </div>
    </div>
  `;
  await sendEmail(coachEmail, subject, html);
}
