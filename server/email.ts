import sgMail from '@sendgrid/mail';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

let connectionSettings: any;

export interface OrgBranding {
  name: string;
  accentColor?: string;
  ownerName?: string;
  ownerEmail?: string;
}

const DEFAULT_BRANDING: OrgBranding = {
  name: "Train Efficiency",
  accentColor: "#16a34a",
};

function brand(org?: OrgBranding) {
  const b = org || DEFAULT_BRANDING;
  return {
    name: b.name || DEFAULT_BRANDING.name!,
    color: b.accentColor || "#16a34a",
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

function detailBox(lines: string[], accentColor?: string) {
  const color = accentColor || "#16a34a";
  return `<div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 4px solid ${color};">${lines.join("")}</div>`;
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

async function sendEmail(to: string, subject: string, html: string, senderName?: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to,
      from: { email: fromEmail, name: senderName || 'Train Efficiency' },
      subject,
      html,
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (error: any) {
    console.error(`Failed to send email to ${to}:`, error?.response?.body || error.message);
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
  ], b.color) : '';
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
  org?: OrgBranding
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
    ], b.color)}
    ${para("See you there! If you need to make changes, you can manage your bookings from your account.")}
  `, org);
  await sendEmail(clientEmail, subject, html, b.name);
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
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
    ], b.color)}
    ${detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">CONTACT INFO</p>`,
      line("Name", data.contactName),
      line("Email", data.contactEmail),
      line("Phone", data.contactPhone || 'Not provided'),
    ], b.color)}
    ${detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">TRAINING GOALS</p>`,
      `<p style="font-size: 15px; margin: 4px 0; white-space: pre-wrap;">${data.goals}</p>`,
    ], b.color)}
    ${data.additionalNotes ? detailBox([
      `<p style="font-size: 14px; color: #aaa; margin: 0 0 8px;">ADDITIONAL NOTES</p>`,
      `<p style="font-size: 15px; margin: 4px 0; white-space: pre-wrap;">${data.additionalNotes}</p>`,
    ], b.color) : ''}
  `, org);
  await sendEmail(recipient, subject, html, b.name);
}
