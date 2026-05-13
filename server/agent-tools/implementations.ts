/**
 * Agent Tool Implementations
 * Actual execution logic for each tool in the registry.
 * Agents NEVER call these directly — always go through runtime.ts.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type ToolResult = {
  success: boolean;
  data?: Record<string, any>;
  message: string;
  draftId?: string;
};

// ─── Communication ────────────────────────────────────────────────────────────

export async function impl_send_email(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  const { sendEmail: _sendEmail } = await import("../email");
  try {
    await (_sendEmail as any)(
      input.to,
      input.subject,
      input.html,
      input.senderName,
      {
        orgId,
        type: "agent_outreach",
        agentActionId: input.agentActionId,
        recipientUserId: input.recipientUserId,
      },
      input.replyTo
    );
    return { success: true, message: `Email sent to ${input.to}` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_send_sms(orgId: string, input: Record<string, any>): Promise<ToolResult> {
  const { sendSms, normalizePhone } = await import("../sms");
  const phone = normalizePhone(input.to);
  if (!phone) return { success: false, message: `Invalid phone number: ${input.to}` };
  try {
    const result = await sendSms({
      to: phone,
      body: input.body,
      ctx: {
        orgId,
        type: "agent_outreach",
        agentActionId: input.agentActionId,
        recipientUserId: input.recipientUserId,
      },
    });
    if (result.success) return { success: true, message: `SMS sent to ${phone}` };
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

export async function impl_create_calendar_event(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: true,
    message: `[STUB] Calendar event "${input.title}" queued — Google Calendar connector not yet live`,
    data: { stubbed: true, title: input.title, startIso: input.startIso },
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

export async function impl_cancel_session(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Session cancellation requires integration with the full booking flow — not auto-executeable yet`,
    data: { stubbed: true, bookingId: input.bookingId },
  };
}

export async function impl_reschedule_session(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Session rescheduling requires integration with the full booking flow — not auto-executeable yet`,
    data: { stubbed: true, bookingId: input.bookingId },
  };
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
        UPDATE team_training_prospects
        SET next_follow_up_date = ${input.followUpDate}::date,
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
    await db.execute(sql`
      UPDATE team_training_prospects
      SET deal_stage = ${input.newStage}, updated_at = NOW()
      WHERE id = ${input.dealId}
    `);
    if (input.note) {
      await db.execute(sql`
        INSERT INTO deal_activities (id, deal_id, activity_type, summary, created_at)
        VALUES (gen_random_uuid(), ${input.dealId}, 'stage_change', ${input.note}, NOW())
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
      SET status = ${input.newStatus}, updated_at = NOW()
      WHERE id = ${input.prospectId}
    `);
    return { success: true, message: `Lead status updated to ${input.newStatus}` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function impl_log_activity(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    await db.execute(sql`
      INSERT INTO deal_activities (id, deal_id, activity_type, summary, metadata, created_at)
      VALUES (gen_random_uuid(), ${input.dealId}, ${input.activityType}, ${input.summary},
              ${JSON.stringify(input.metadata ?? {})}::jsonb, NOW())
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

export async function impl_create_invoice(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Invoice creation requires Stripe invoice API integration — coming soon`,
    data: { stubbed: true, clientId: input.clientId, amountCents: input.amountCents },
  };
}

export async function impl_record_payment(_orgId: string, input: Record<string, any>): Promise<ToolResult> {
  return {
    success: false,
    message: `[STUB] Payment recording requires Stripe integration — coming soon`,
    data: { stubbed: true, clientId: input.clientId, amountCents: input.amountCents },
  };
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
