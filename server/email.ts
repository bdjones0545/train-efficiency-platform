// SendGrid email integration for EST notifications
import sgMail from '@sendgrid/mail';
import { format } from 'date-fns';

let connectionSettings: any;

async function getCredentials() {
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
  location?: string
) {
  const subject = `Session Confirmed — ${serviceName}`;
  const dateStr = format(startAt, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(startAt, "h:mm a")} — ${format(endAt, "h:mm a")}`;
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

export async function sendBookingNotificationToCoach(
  coachEmail: string,
  coachFirstName: string,
  clientName: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  location?: string
) {
  const subject = `New Session Booked — ${clientName}`;
  const dateStr = format(startAt, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(startAt, "h:mm a")} — ${format(endAt, "h:mm a")}`;
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
