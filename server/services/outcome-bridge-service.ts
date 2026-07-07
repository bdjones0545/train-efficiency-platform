/**
 * Outcome Bridge Service
 * Automatically links business events (replies, bookings, deal changes,
 * employment stage changes) back to the originating communication outcome row.
 * Completes the feedback loop: send → reply → book → convert → revenue.
 */

import { db } from "../db";
import { eq, and, or, desc, isNotNull } from "drizzle-orm";
import {
  agentCommunicationOutcomes,
  gmailAgentActions,
  employmentApplicants,
} from "@shared/schema";
import { writeTimeline } from "./ceo-heartbeat-service";

// ─── Reply detected bridge ────────────────────────────────────────────────────
// Call this when an inbound reply is classified and linked to a gmail action.

export async function bridgeReplyDetected(opts: {
  orgId: string;
  gmailActionId?: string;
  recipientEmail?: string;
  leadId?: string;
  prospectId?: string;
  replyText?: string;
}): Promise<void> {
  try {
    // Find the most recent outcome row for this action or recipient
    const clauses: any[] = [eq(agentCommunicationOutcomes.orgId, opts.orgId)];
    if (opts.gmailActionId) {
      clauses.push(eq(agentCommunicationOutcomes.gmailActionId, opts.gmailActionId));
    } else if (opts.recipientEmail) {
      clauses.push(eq(agentCommunicationOutcomes.recipientEmail, opts.recipientEmail));
    } else if (opts.leadId) {
      clauses.push(eq(agentCommunicationOutcomes.leadId, opts.leadId));
    } else if (opts.prospectId) {
      clauses.push(eq(agentCommunicationOutcomes.prospectId, opts.prospectId));
    } else {
      return; // No identifier to match on
    }

    const [outcome] = await db.select()
      .from(agentCommunicationOutcomes)
      .where(and(...clauses))
      .orderBy(desc(agentCommunicationOutcomes.createdAt))
      .limit(1);

    if (!outcome) return;

    // Only update if still in "sent" state (don't regress)
    if (!["sent", "opened"].includes(outcome.outcomeStatus)) return;

    await db.update(agentCommunicationOutcomes)
      .set({
        outcomeStatus: "replied",
        repliedAt: new Date(),
        outcomeSource: "auto_reply_detection",
        updatedAt: new Date(),
      })
      .where(eq(agentCommunicationOutcomes.id, outcome.id));

    await writeTimeline({
      orgId: opts.orgId,
      agentName: "outcome_bridge",
      systemName: "Outcome Bridge Service",
      actionType: "reply_detected",
      actionStatus: "completed",
      relatedEntityType: "outcome",
      relatedEntityId: outcome.id,
      communicationDomain: outcome.communicationDomain,
      summary: `Reply detected — outcome ${outcome.id} updated to 'replied'`,
      outcomeStatus: "replied",
      metadata: { gmailActionId: opts.gmailActionId, recipientEmail: opts.recipientEmail },
    });
  } catch (err: any) {
    console.error("[OutcomeBridge] bridgeReplyDetected error:", err.message);
  }
}

// ─── Booking created bridge ───────────────────────────────────────────────────
// Call this when a session booking is confirmed for a lead.

export async function bridgeBookingCreated(opts: {
  orgId: string;
  leadId?: string;
  prospectId?: string;
  recipientEmail?: string;
  revenueCents?: number;
}): Promise<void> {
  try {
    const clauses: any[] = [eq(agentCommunicationOutcomes.orgId, opts.orgId)];
    if (opts.leadId) clauses.push(eq(agentCommunicationOutcomes.leadId, opts.leadId));
    else if (opts.prospectId) clauses.push(eq(agentCommunicationOutcomes.prospectId, opts.prospectId));
    else if (opts.recipientEmail) clauses.push(eq(agentCommunicationOutcomes.recipientEmail, opts.recipientEmail));
    else return;

    const [outcome] = await db.select()
      .from(agentCommunicationOutcomes)
      .where(and(...clauses))
      .orderBy(desc(agentCommunicationOutcomes.createdAt))
      .limit(1);

    if (!outcome) return;

    const alreadyBooked = ["booked_session", "converted", "contract_signed", "hired"].includes(outcome.outcomeStatus);
    if (alreadyBooked) return;

    await db.update(agentCommunicationOutcomes)
      .set({
        outcomeStatus: "booked_session",
        bookedSessionAt: new Date(),
        revenueCents: opts.revenueCents ?? outcome.revenueCents ?? 0,
        outcomeSource: "auto_booking_bridge",
        updatedAt: new Date(),
      })
      .where(eq(agentCommunicationOutcomes.id, outcome.id));

    await writeTimeline({
      orgId: opts.orgId,
      agentName: "outcome_bridge",
      systemName: "Outcome Bridge Service",
      actionType: "booking_created",
      actionStatus: "completed",
      relatedEntityType: "outcome",
      relatedEntityId: outcome.id,
      communicationDomain: outcome.communicationDomain,
      summary: `Booking confirmed — outcome updated to 'booked_session'`,
      outcomeStatus: "booked_session",
      metadata: { revenueCents: opts.revenueCents },
    });
  } catch (err: any) {
    console.error("[OutcomeBridge] bridgeBookingCreated error:", err.message);
  }
}

// ─── Deal stage changed bridge ────────────────────────────────────────────────
// Maps deal stages to outcome statuses and updates the linked outcome row.

const DEAL_STAGE_TO_OUTCOME: Record<string, string> = {
  proposal_requested: "proposal_requested",
  proposal_sent: "proposal_sent",
  proposal_accepted: "proposal_accepted",
  contract_signed: "contract_signed",
  won: "converted",
  converted: "converted",
  lost: "lost",
  closed_won: "converted",
  closed_lost: "lost",
};

const DEAL_STAGE_TIMESTAMP: Record<string, string> = {
  proposal_requested: "proposalRequestedAt",
  proposal_sent: "proposalSentAt",
  proposal_accepted: "proposalAcceptedAt",
  contract_signed: "contractSignedAt",
  converted: "convertedAt",
  won: "convertedAt",
  closed_won: "convertedAt",
  lost: "lostAt",
  closed_lost: "lostAt",
};

export async function bridgeDealStageChanged(opts: {
  orgId: string;
  dealId: string;
  newStage: string;
  revenueCents?: number;
}): Promise<void> {
  try {
    const outcomeStatus = DEAL_STAGE_TO_OUTCOME[opts.newStage.toLowerCase()];
    if (!outcomeStatus) return;

    const [outcome] = await db.select()
      .from(agentCommunicationOutcomes)
      .where(and(
        eq(agentCommunicationOutcomes.orgId, opts.orgId),
        eq(agentCommunicationOutcomes.dealId, opts.dealId),
      ))
      .orderBy(desc(agentCommunicationOutcomes.createdAt))
      .limit(1);

    if (!outcome) return;

    const updates: Record<string, any> = {
      outcomeStatus,
      outcomeSource: "auto_deal_bridge",
      updatedAt: new Date(),
    };
    const tsField = DEAL_STAGE_TIMESTAMP[outcomeStatus];
    if (tsField) updates[tsField.replace(/([A-Z])/g, "_$1").toLowerCase()] = new Date();
    if (opts.revenueCents !== undefined) updates.revenueCents = opts.revenueCents;

    await db.update(agentCommunicationOutcomes)
      .set(updates)
      .where(eq(agentCommunicationOutcomes.id, outcome.id));

    await writeTimeline({
      orgId: opts.orgId,
      agentName: "outcome_bridge",
      systemName: "Outcome Bridge Service",
      actionType: "revenue_outcome",
      actionStatus: "completed",
      relatedEntityType: "deal",
      relatedEntityId: opts.dealId,
      communicationDomain: outcome.communicationDomain,
      summary: `Deal stage → '${opts.newStage}' — outcome updated to '${outcomeStatus}'`,
      outcomeStatus,
      metadata: { dealId: opts.dealId, newStage: opts.newStage, revenueCents: opts.revenueCents },
    });
  } catch (err: any) {
    console.error("[OutcomeBridge] bridgeDealStageChanged error:", err.message);
  }
}

// ─── Employment applicant stage changed bridge ────────────────────────────────

const APPLICANT_STAGE_TO_OUTCOME: Record<string, string> = {
  interview_requested: "meeting_booked",
  interviewed: "replied",
  offer_sent: "proposal_sent",
  hired: "hired",
  rejected: "lost",
};

const APPLICANT_STAGE_TIMESTAMP: Record<string, string> = {
  hired: "hiredAt",
};

export async function bridgeApplicantStageChanged(opts: {
  orgId: string;
  applicantId: string;
  newStage: string;
}): Promise<void> {
  try {
    const outcomeStatus = APPLICANT_STAGE_TO_OUTCOME[opts.newStage.toLowerCase()];
    if (!outcomeStatus) return;

    const [outcome] = await db.select()
      .from(agentCommunicationOutcomes)
      .where(and(
        eq(agentCommunicationOutcomes.orgId, opts.orgId),
        eq(agentCommunicationOutcomes.applicantId, opts.applicantId),
      ))
      .orderBy(desc(agentCommunicationOutcomes.createdAt))
      .limit(1);

    if (!outcome) return;

    const updates: Record<string, any> = {
      outcomeStatus,
      outcomeSource: "auto_applicant_bridge",
      updatedAt: new Date(),
    };
    const tsField = APPLICANT_STAGE_TIMESTAMP[opts.newStage.toLowerCase()];
    if (tsField) updates[tsField.replace(/([A-Z])/g, "_$1").toLowerCase()] = new Date();

    await db.update(agentCommunicationOutcomes)
      .set(updates)
      .where(eq(agentCommunicationOutcomes.id, outcome.id));

    await writeTimeline({
      orgId: opts.orgId,
      agentName: "outcome_bridge",
      systemName: "Outcome Bridge Service",
      actionType: "revenue_outcome",
      actionStatus: "completed",
      relatedEntityType: "applicant",
      relatedEntityId: opts.applicantId,
      communicationDomain: "employment_opportunity",
      summary: `Applicant stage → '${opts.newStage}' — outcome updated to '${outcomeStatus}'`,
      outcomeStatus,
      metadata: { applicantId: opts.applicantId, newStage: opts.newStage },
    });
  } catch (err: any) {
    console.error("[OutcomeBridge] bridgeApplicantStageChanged error:", err.message);
  }
}
