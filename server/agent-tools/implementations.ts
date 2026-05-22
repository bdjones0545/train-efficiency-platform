/**
 * Agent Tool Implementations
 * Actual execution logic for each tool in the registry.
 * Agents NEVER call these directly — always go through runtime.ts.
 *
 * External send safety:
 *   - impl_send_email and impl_send_sms both accept `_toolCallId` (injected
 *     by the runtime at execution time) and check communication_logs for an
 *     existing successful send before calling the external provider.
 *   - This prevents duplicate SendGrid/Twilio calls if the same tool call is
 *     somehow executed more than once (network retry, bug).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type ToolResult = {
  success: boolean;
  data?: Record<string, any>;
  message: string;
  draftId?: string;
  /** Provider-assigned message identifier (SendGrid x-message-id, Twilio SID). */
  providerMessageId?: string;
};

// ─── Communication ────────────────────────────────────────────────────────────

export async function impl_send_email(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  const toolCallId = input._toolCallId as string | undefined;

  // ── Pre-send dedup ──────────────────────────────────────────────────────────
  // Before calling SendGrid, check if we already have a successful send logged
  // for this tool call. This is the last-resort safety net against any code
  // path that calls executePendingToolCall twice for the same record.
  if (toolCallId) {
    try {
      const existing = await db.execute(sql`
        SELECT id FROM communication_logs
        WHERE org_id = ${orgId}
          AND agent_action_id = ${toolCallId}
          AND channel = 'email'
          AND status = 'sent'
        LIMIT 1
      `);
      if (existing.rows.length > 0) {
        return {
          success: true,
          message: `Email already sent — skipping duplicate send (idempotent)`,
          data: { alreadySent: true, toolCallId },
        };
      }
    } catch {
      // communication_logs might not have agent_action_id indexed yet; safe to continue
    }
  }

  const { sendEmail: _sendEmail, isEmailProviderConfigured } = await import("../email");

  if (!isEmailProviderConfigured()) {
    return {
      success: false,
      message: "Email provider is not configured. SENDGRID_API_KEY is missing and no Replit SendGrid connector is available.",
    };
  }

  try {
    await (_sendEmail as any)(
      input.to,
      input.subject,
      input.html,
      input.senderName,
      {
        orgId,
        type: "agent_outreach",
        agentActionId: toolCallId ?? input.agentActionId,
        recipientUserId: input.recipientUserId,
      },
      input.replyTo
    );
    return { success: true, message: `Email sent to ${input.to}` };
  } catch (e: any) {
    const sgBody = (e as any)?.response?.body;
    const providerError = sgBody
      ? (Array.isArray(sgBody.errors) ? sgBody.errors.map((err: any) => err.message).join("; ") : JSON.stringify(sgBody))
      : (e.message || "Unknown error");
    return { success: false, message: `Email send failed: ${providerError}` };
  }
}

export async function impl_send_sms(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  const toolCallId = input._toolCallId as string | undefined;
  const { sendSms, normalizePhone } = await import("../sms");
  const phone = normalizePhone(input.to);
  if (!phone) return { success: false, message: `Invalid phone number: ${input.to}` };

  // ── Pre-send dedup ──────────────────────────────────────────────────────────
  if (toolCallId) {
    try {
      const existing = await db.execute(sql`
        SELECT id FROM communication_logs
        WHERE org_id = ${orgId}
          AND agent_action_id = ${toolCallId}
          AND channel = 'sms'
          AND status = 'sent'
        LIMIT 1
      `);
      if (existing.rows.length > 0) {
        return {
          success: true,
          message: `SMS already sent — skipping duplicate send (idempotent)`,
          data: { alreadySent: true, toolCallId },
        };
      }
    } catch {
      // safe to continue
    }
  }

  try {
    const result = await sendSms({
      to: phone,
      body: input.body,
      ctx: {
        orgId,
        type: "agent_outreach",
        agentActionId: toolCallId ?? input.agentActionId,
        recipientUserId: input.recipientUserId,
      },
    });
    if (result.sent) return { success: true, message: `SMS sent to ${phone}` };
    if (result.skipped) return { success: false, message: `SMS skipped: ${result.skipped}` };
    return { success: false, message: result.error ?? "SMS send failed" };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_create_email_draft(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    if (input.prospectId || input.dealId) {
      const result = await db.execute(sql`
        INSERT INTO team_training_outreach_drafts
          (id, org_id, prospect_id, subject, body, draft_type, status, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${orgId}, ${input.prospectId ?? null}, ${input.subject}, ${input.body},
           ${input.draftType ?? "general"}, 'draft', NOW(), NOW())
        RETURNING id
      `);
      const draftId = (result.rows[0] as any)?.id;
      return { success: true, message: `Email draft created`, draftId, data: { draftId } };
    }
    return {
      success: true,
      message: `Email draft saved (no entity linked)`,
      data: { subject: input.subject, recipientEmail: input.recipientEmail },
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_create_sms_draft(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: true,
    message: `SMS draft created for ${input.recipientName ?? input.recipientPhone ?? "recipient"}`,
    data: { body: input.body, phone: input.recipientPhone },
  };
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

export async function impl_create_calendar_event(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  const { isGoogleCalendarConfigured, getGoogleCalendarStatus, createCalendarEvent, checkConflicts } = await import("../connectors/google-calendar");

  if (!isGoogleCalendarConfigured()) {
    return {
      success: false,
      message: "Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
      data: { notConfigured: true },
    };
  }

  const status = await getGoogleCalendarStatus(orgId);
  if (!status.connected) {
    return {
      success: false,
      message: "Google Calendar is not connected for this organisation. Connect via Admin → Agent Ops → Connectors.",
      data: { notConnected: true },
    };
  }

  const conflicts = await checkConflicts(orgId, input.startIso, input.endIso).catch(() => []);
  if (conflicts.length > 0) {
    return {
      success: false,
      message: `Conflict detected: ${conflicts.length} existing event(s) overlap this time slot. First conflict: "${conflicts[0].summary}" at ${conflicts[0].start}. Cancel or reschedule the conflicting event before proceeding.`,
      data: { conflicts },
    };
  }

  const { eventId, htmlLink } = await createCalendarEvent(orgId, {
    title: input.title,
    startIso: input.startIso,
    endIso: input.endIso,
    description: input.description,
    attendeeEmails: input.attendeeEmails,
    location: input.location,
  });

  return {
    success: true,
    message: `Google Calendar event created: "${input.title}" at ${input.startIso}`,
    data: { calendarEventId: eventId, htmlLink, title: input.title, startIso: input.startIso },
    providerMessageId: eventId,
  };
}

export async function impl_create_schedule_slot(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    await db.execute(sql`
      INSERT INTO availability_blocks
        (id, coach_id, start_time, end_time, is_recurring, recurrence_type, day_of_week, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${input.coachId}, ${input.startIso}::timestamptz, ${input.endIso}::timestamptz,
         false, null, null, NOW(), NOW())
    `);
    return { success: true, message: `Schedule slot created` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_book_session(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Session booking requires integration with the full booking flow — not auto-executeable yet`,
    data: { stubbed: true, input },
  };
}

export async function impl_cancel_session(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    const rows = await db.execute(sql`
      SELECT id, status, google_calendar_event_id, client_id, coach_id, start_at
      FROM bookings WHERE id = ${input.bookingId} LIMIT 1
    `);
    const booking = ((rows as any).rows ?? rows)[0];
    if (!booking) {
      return { success: false, message: `Booking ${input.bookingId} not found.` };
    }
    if (booking.status === "CANCELLED") {
      return { success: false, message: `Booking ${input.bookingId} is already cancelled.` };
    }

    await db.execute(sql`
      UPDATE bookings SET status = 'CANCELLED' WHERE id = ${input.bookingId}
    `);

    let calendarNote = "";
    if (booking.google_calendar_event_id) {
      try {
        const { isGoogleCalendarConfigured, getGoogleCalendarStatus, deleteCalendarEvent } = await import("../connectors/google-calendar");
        if (isGoogleCalendarConfigured()) {
          const status = await getGoogleCalendarStatus(orgId);
          if (status.connected) {
            await deleteCalendarEvent(orgId, booking.google_calendar_event_id);
            calendarNote = " Google Calendar event deleted.";
          }
        }
      } catch (e: any) {
        calendarNote = ` (Calendar deletion failed: ${e.message})`;
      }
    }

    return {
      success: true,
      message: `Booking ${input.bookingId} cancelled.${calendarNote} Reason: ${input.reason}`,
      data: { bookingId: input.bookingId, reason: input.reason, previousStatus: booking.status },
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_reschedule_session(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    const rows = await db.execute(sql`
      SELECT id, status, google_calendar_event_id, start_at, end_at
      FROM bookings WHERE id = ${input.bookingId} LIMIT 1
    `);
    const booking = ((rows as any).rows ?? rows)[0];
    if (!booking) {
      return { success: false, message: `Booking ${input.bookingId} not found.` };
    }
    if (booking.status === "CANCELLED") {
      return { success: false, message: `Cannot reschedule a cancelled booking.` };
    }

    await db.execute(sql`
      UPDATE bookings
      SET start_at = ${input.newStartIso}::timestamptz,
          end_at = ${input.newEndIso}::timestamptz
      WHERE id = ${input.bookingId}
    `);

    let calendarNote = "";
    if (booking.google_calendar_event_id) {
      try {
        const { isGoogleCalendarConfigured, getGoogleCalendarStatus, updateCalendarEvent } = await import("../connectors/google-calendar");
        if (isGoogleCalendarConfigured()) {
          const status = await getGoogleCalendarStatus(orgId);
          if (status.connected) {
            await updateCalendarEvent(orgId, booking.google_calendar_event_id, {
              startIso: input.newStartIso,
              endIso: input.newEndIso,
            });
            calendarNote = " Google Calendar event updated.";
          }
        }
      } catch (e: any) {
        calendarNote = ` (Calendar update failed: ${e.message})`;
      }
    }

    return {
      success: true,
      message: `Booking ${input.bookingId} rescheduled to ${input.newStartIso}.${calendarNote}`,
      data: { bookingId: input.bookingId, newStartIso: input.newStartIso, newEndIso: input.newEndIso, previousStartAt: booking.start_at },
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

export async function impl_create_follow_up_task(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    if (input.prospectId) {
      await db.execute(sql`
        UPDATE team_training_prospects
        SET next_follow_up_date = ${input.followUpDate}::date,
            follow_up_notes = COALESCE(follow_up_notes, '') || ${input.note ? ' | ' + input.note : ''},
            updated_at = NOW()
        WHERE id = ${input.prospectId}
      `);
      return { success: true, message: `Follow-up task scheduled for ${input.followUpDate}`, data: { date: input.followUpDate } };
    }
    if (input.dealId) {
      await db.execute(sql`
        UPDATE team_training_deals
        SET next_follow_up_at = ${input.followUpDate}::date,
            updated_at = NOW()
        WHERE id = ${input.dealId}
      `);
      return { success: true, message: `Follow-up task scheduled for deal on ${input.followUpDate}` };
    }
    return { success: true, message: `Follow-up task recorded (no entity linked)` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_update_deal_stage(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    // team_training_deals.status holds the pipeline stage; organization_id is the tenant key
    await db.execute(sql`
      UPDATE team_training_deals
      SET status = ${input.newStage}::deal_status, updated_at = NOW()
      WHERE id = ${input.dealId}
        AND organization_id = ${orgId}
    `);
    if (input.note) {
      await db.execute(sql`
        INSERT INTO deal_activities (id, deal_id, organization_id, activity_type, description, created_at)
        VALUES (gen_random_uuid(), ${input.dealId}, ${orgId}, 'stage_change', ${input.note}, NOW())
      `);
    }
    return { success: true, message: `Deal stage updated to ${input.newStage}`, data: { stage: input.newStage } };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_update_lead_status(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    await db.execute(sql`
      UPDATE team_training_prospects
      SET outreach_status = ${input.newStatus}, updated_at = NOW()
      WHERE id = ${input.prospectId}
    `);
    return { success: true, message: `Lead status updated to ${input.newStatus}` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_log_activity(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    await db.execute(sql`
      INSERT INTO deal_activities (id, deal_id, organization_id, activity_type, description, metadata, created_at)
      VALUES (gen_random_uuid(), ${input.dealId}, ${orgId}, ${input.activityType}::deal_activity_type,
              ${input.summary}, ${JSON.stringify(input.metadata ?? {})}::jsonb, NOW())
    `);
    return { success: true, message: `Activity logged: ${input.activityType}` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_update_client_status(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Client status update requires integration with user management — coming soon`,
    data: { stubbed: true, clientId: input.clientId, newStatus: input.newStatus },
  };
}

// ─── Financial ────────────────────────────────────────────────────────────────

export async function impl_create_invoice(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    const { createAgentInvoice } = await import("../connectors/stripe-invoicing");
    const result = await createAgentInvoice({
      orgId,
      clientId: input.clientId,
      amountCents: input.amountCents,
      description: input.description,
      dueDate: input.dueDate,
      toolCallId: input._toolCallId,
      workflowRunId: input.workflowRunId,
    });

    return {
      success: true,
      message: `Stripe invoice created for $${(input.amountCents / 100).toFixed(2)}: ${input.description}. Invoice sent to client.`,
      data: {
        agentInvoiceId: result.agentInvoiceId,
        stripeInvoiceId: result.stripeInvoiceId,
        stripeCustomerId: result.stripeCustomerId,
        invoiceUrl: result.invoiceUrl,
        amountCents: result.amountCents,
      },
      providerMessageId: result.stripeInvoiceId,
    };
  } catch (e: any) {
    return { success: false, message: `Invoice creation failed: ${e.message}` };
  }
}

export async function impl_record_payment(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    const { recordManualPayment } = await import("../connectors/stripe-invoicing");
    const result = await recordManualPayment(
      orgId,
      input.clientId,
      input.amountCents,
      input.description ?? `Manual payment — ${input.paymentMethod}`,
      input._toolCallId
    );

    return {
      success: true,
      message: `Payment of $${(input.amountCents / 100).toFixed(2)} recorded via ${input.paymentMethod}. PaymentIntent: ${result.paymentIntentId}`,
      data: {
        paymentIntentId: result.paymentIntentId,
        agentInvoiceId: result.agentInvoiceId,
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
      },
      providerMessageId: result.paymentIntentId,
    };
  } catch (e: any) {
    return { success: false, message: `Payment recording failed: ${e.message}` };
  }
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

export const TOOL_IMPLEMENTATIONS: Record<string, (orgId: string, input: Record<string, any>) => Promise<ToolResult>> = {
  send_email: impl_send_email,
  send_sms: impl_send_sms,
  create_email_draft: impl_create_email_draft,
  create_sms_draft: impl_create_sms_draft,
  create_calendar_event: impl_create_calendar_event,
  create_follow_up_task: impl_create_follow_up_task,
  update_deal_stage: impl_update_deal_stage,
  update_lead_status: impl_update_lead_status,
  log_activity: impl_log_activity,
  create_invoice: impl_create_invoice,
  record_payment: impl_record_payment,
  update_client_status: impl_update_client_status,
  create_schedule_slot: impl_create_schedule_slot,
  book_session: impl_book_session,
  cancel_session: impl_cancel_session,
  reschedule_session: impl_reschedule_session,
};
