/**
 * Fill Monitoring Service — Phase 5: Autonomous Revenue Operations
 * Continuously scans for session fill opportunities, scores them, and
 * pre-generates campaign drafts when auto_draft_generation is enabled.
 * Human approval remains mandatory — this service NEVER sends.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import { rankFillRecipients } from "./fill-recipient-service";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getRows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

// ── Policy defaults ────────────────────────────────────────────────────────────

export const DEFAULT_POLICY = {
  min_fill_threshold_pct: 70,
  min_revenue_cents: 5000,
  campaign_lead_time_hours: 72,
  auto_draft_generation: false,
  approval_required: true,
  waitlist_priority: true,
  enabled: true,
};

// ── Opportunity scoring ────────────────────────────────────────────────────────

function scoreRevenue(openSpots: number, priceCents: number): { label: string; score: number } {
  const value = openSpots * priceCents;
  if (value >= 20000) return { label: "High",   score: 100 };
  if (value >= 10000) return { label: "Medium",  score: 60 };
  return                      { label: "Low",    score: 25 };
}

function scoreUrgency(hoursUntilSession: number): { label: string; score: number } {
  if (hoursUntilSession <= 24)  return { label: "Critical", score: 100 };
  if (hoursUntilSession <= 48)  return { label: "High",     score: 75 };
  if (hoursUntilSession <= 72)  return { label: "Medium",   score: 50 };
  return                                { label: "Low",      score: 20 };
}

function estimateFillProbability(
  utilizationPct: number,
  hasWaitlist: boolean,
  hoursUntilSession: number,
  historicalFillRate?: number
): number {
  let base = historicalFillRate ?? 50;
  if (utilizationPct >= 50) base += 15;  // already half-full
  if (hasWaitlist) base += 20;
  if (hoursUntilSession > 48) base += 10; // enough time to fill
  if (hoursUntilSession <= 12) base -= 20; // too late
  return Math.min(98, Math.max(5, Math.round(base)));
}

function overallPriority(revenueScore: number, urgencyScore: number, fillProb: number): number {
  return Math.round(revenueScore * 0.4 + urgencyScore * 0.3 + fillProb * 0.3);
}

// ── Detection triggers ─────────────────────────────────────────────────────────

function detectTriggers(
  utilizationPct: number,
  openSpots: number,
  priceCents: number,
  hoursUntilSession: number,
  hasWaitlist: boolean,
  threshold: number
): string[] {
  const triggers: string[] = [];
  if (utilizationPct < threshold) triggers.push(`Below ${threshold}% utilization threshold (${utilizationPct}% filled)`);
  if (priceCents >= 15000 && openSpots >= 2) triggers.push("High-value session with open spots");
  if (hoursUntilSession <= 72) triggers.push(`Session in ${Math.round(hoursUntilSession)}h — time-sensitive`);
  if (hasWaitlist) triggers.push("Waitlist athletes ready to fill");
  if (openSpots >= 5) triggers.push(`${openSpots} spots still available`);
  return triggers;
}

// ── Multi-strategy recommendations ────────────────────────────────────────────

function generateRecommendations(
  openSpots: number,
  hasWaitlist: boolean,
  hoursUntilSession: number,
  utilizationPct: number
): Array<{ strategy: string; description: string; priority: "primary" | "secondary" | "tertiary" }> {
  const recs: Array<{ strategy: string; description: string; priority: "primary" | "secondary" | "tertiary" }> = [];

  // Primary: Fill Campaign (always recommended)
  recs.push({
    strategy: "Fill Campaign",
    description: `Send targeted outreach to ${Math.min(openSpots * 3, 20)} scored recipients`,
    priority: "primary",
  });

  // Waitlist promotion
  if (hasWaitlist) {
    recs.push({
      strategy: "Waitlist Promotion",
      description: "Promote waitlisted athletes directly — highest conversion probability",
      priority: "primary",
    });
  }

  // Discount offer for high-urgency low-utilization
  if (hoursUntilSession <= 48 && utilizationPct < 50) {
    recs.push({
      strategy: "Offer Discount",
      description: "Time-limited early-fill discount may accelerate bookings",
      priority: "secondary",
    });
  }

  // Merge sessions when very few bookings
  if (utilizationPct < 30 && openSpots >= 5) {
    recs.push({
      strategy: "Merge Sessions",
      description: "Consider consolidating with a parallel session to maximize coach utilization",
      priority: "secondary",
    });
  }

  // Move athletes
  if (utilizationPct >= 60 && openSpots <= 3) {
    recs.push({
      strategy: "Move Athletes",
      description: "Shift 1-2 athletes from an overfull session to this one",
      priority: "secondary",
    });
  }

  // Manual outreach for high-value
  if (openSpots <= 2) {
    recs.push({
      strategy: "Manual Outreach",
      description: "Personal coach outreach for the final spot(s) — high conversion for known athletes",
      priority: "tertiary",
    });
  }

  // Coach schedule adjustment
  if (hoursUntilSession > 72 && utilizationPct < 40) {
    recs.push({
      strategy: "Coach Schedule Adjustment",
      description: "Evaluate whether this time slot should be rescheduled for better demand fit",
      priority: "tertiary",
    });
  }

  return recs;
}

// ── Auto-draft generation ──────────────────────────────────────────────────────

async function autoGenerateDraft(
  opportunityId: string,
  bookingId: string,
  orgId: string,
  sessionName: string,
  coachName: string,
  openSpots: number,
  priceCents: number,
  hoursUntilSession: number
): Promise<string | null> {
  try {
    // Mark as generating
    await db.execute(sql`
      UPDATE fill_opportunity_scores SET auto_draft_status = 'generating' WHERE id = ${opportunityId}
    `).catch(() => {});

    // Run recipient intelligence
    const recipientResult = await rankFillRecipients(bookingId, orgId);
    const topRecipients = recipientResult.recipients.filter((r) => !r.excluded).slice(0, 15);

    if (topRecipients.length === 0) {
      await db.execute(sql`UPDATE fill_opportunity_scores SET auto_draft_status = 'no_recipients' WHERE id = ${opportunityId}`).catch(() => {});
      return null;
    }

    const urgencyLabel = hoursUntilSession <= 24 ? "critical urgency" : hoursUntilSession <= 48 ? "high urgency" : "moderate urgency";
    const estimatedRevenue = Math.round((openSpots * priceCents) / 100);
    const recipientSummary = topRecipients.slice(0, 5).map((r) => `${r.firstName} ${r.lastName} (${r.score}% match)`).join(", ");

    const prompt = `Generate a fill campaign for an underfilled session.

Session: ${sessionName}
Coach: ${coachName}
Open spots: ${openSpots}
Hours until session: ${Math.round(hoursUntilSession)}
Urgency: ${urgencyLabel}
Estimated revenue recovery: $${estimatedRevenue}
Top recipients: ${recipientSummary}

Generate a JSON object with:
- subject: compelling email subject line (urgency appropriate)
- previewText: 80-char email preview
- emailBody: full email body (2-3 paragraphs, personal and direct, no placeholders)
- smsBody: SMS version under 160 chars
- pushBody: push notification under 100 chars
- socialCaption: brief social post

Tone: friendly, direct, not spammy. Use ${urgencyLabel} cues appropriately.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a sports business marketing assistant. Generate targeted fill campaigns. Return valid JSON only." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const generated = JSON.parse(completion.choices[0].message.content || "{}");
    const draftId = crypto.randomUUID();
    const recipientIds = topRecipients.map((r) => r.userId);

    await db.execute(sql`
      INSERT INTO fill_campaign_drafts
        (id, org_id, booking_id, subject, preview_text, email_body, sms_body, push_body, social_caption,
         selected_recipient_count, recipient_ids, recipient_summary, format, tone, urgency_level,
         generation_context, created_at)
      VALUES
        (${draftId}, ${orgId}, ${bookingId},
         ${generated.subject ?? ""},
         ${generated.previewText ?? ""},
         ${generated.emailBody ?? ""},
         ${generated.smsBody ?? ""},
         ${generated.pushBody ?? ""},
         ${generated.socialCaption ?? ""},
         ${topRecipients.length},
         ${JSON.stringify(recipientIds)},
         ${JSON.stringify({ topReasons: ["auto_monitoring"], avgScore: Math.round(topRecipients.reduce((s, r) => s + r.score, 0) / topRecipients.length) })},
         'email', 'professional', ${urgencyLabel},
         ${JSON.stringify({ auto: true, opportunityId, hoursUntilSession, openSpots })},
         NOW())
    `).catch(() => {});

    await db.execute(sql`
      UPDATE fill_opportunity_scores
      SET auto_draft_id = ${draftId}, auto_draft_status = 'ready', last_scanned_at = NOW()
      WHERE id = ${opportunityId}
    `).catch(() => {});

    return draftId;
  } catch (e) {
    await db.execute(sql`UPDATE fill_opportunity_scores SET auto_draft_status = 'error' WHERE id = ${opportunityId}`).catch(() => {});
    return null;
  }
}

// ── Main scan function ─────────────────────────────────────────────────────────

export async function scanOpportunitiesForOrg(orgId: string): Promise<number> {
  try {
    // Load org policy
    const policyRows = getRows(await db.execute(sql`
      SELECT * FROM fill_revenue_policies WHERE org_id = ${orgId} LIMIT 1
    `).catch(() => ({ rows: [] })));
    const policy = { ...DEFAULT_POLICY, ...(policyRows[0] ?? {}) };
    if (!policy.enabled) return 0;

    const leadTimeHours = policy.campaign_lead_time_hours ?? 72;

    // Find bookings within lead time window with open spots
    const bookingRows = getRows(await db.execute(sql`
      SELECT
        b.id, b.start_at, b.max_participants, b.service_id, b.coach_id,
        b.organization_id AS org_id,
        s.name AS service_name,
        s.price_cents,
        u.first_name AS coach_first, u.last_name AS coach_last,
        COUNT(bp.id)::int AS registered_count,
        EXTRACT(EPOCH FROM (b.start_at - NOW())) / 3600.0 AS hours_until,
        EXISTS(
          SELECT 1 FROM session_waitlists sw
          WHERE sw.booking_id = b.id
          LIMIT 1
        ) AS has_waitlist
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN coach_profiles cp ON b.coach_id = cp.id
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN booking_participants bp ON bp.booking_id = b.id
      WHERE b.organization_id = ${orgId}
        AND b.start_at > NOW()
        AND b.start_at <= NOW() + (${leadTimeHours} || ' hours')::interval
        AND b.max_participants > 0
      GROUP BY b.id, s.name, s.price_cents, u.first_name, u.last_name, cp.user_id
      HAVING COUNT(bp.id) < b.max_participants
    `).catch(() => ({ rows: [] })));

    // Historical fill rate per coach (from attributions)
    const fillRateRows = getRows(await db.execute(sql`
      SELECT
        s.coach_name,
        ROUND(AVG(CASE WHEN s.open_spots > 0 THEN
          (SELECT COUNT(*) FROM fill_campaign_attributions a WHERE a.campaign_submission_id = s.id)::numeric / s.open_spots * 100
        END)) AS avg_fill_rate
      FROM fill_campaign_submissions s
      WHERE s.org_id = ${orgId} AND s.status = 'completed'
      GROUP BY s.coach_name
    `).catch(() => ({ rows: [] })));
    const coachFillRates: Record<string, number> = {};
    for (const r of fillRateRows) {
      if (r.coach_name) coachFillRates[r.coach_name] = parseInt(String(r.avg_fill_rate ?? 50));
    }

    let newCount = 0;

    for (const booking of bookingRows) {
      const registered = parseInt(String(booking.registered_count ?? 0));
      const max = parseInt(String(booking.max_participants ?? 0));
      const openSpots = max - registered;
      const utilizationPct = max > 0 ? Math.round((registered / max) * 100) : 0;
      const priceCents = parseInt(String(booking.price_cents ?? 0));
      const hoursUntil = parseFloat(String(booking.hours_until ?? 999));
      const hasWaitlist = booking.has_waitlist === true || booking.has_waitlist === "t";
      const coachName = `${booking.coach_first ?? ""} ${booking.coach_last ?? ""}`.trim();

      // Apply policy filters
      if (utilizationPct >= (policy.min_fill_threshold_pct ?? 70)) continue; // already filled enough
      if ((openSpots * priceCents) < (policy.min_revenue_cents ?? 0)) continue; // too small
      if (hoursUntil <= 0) continue; // already started

      const detectionTriggers = detectTriggers(utilizationPct, openSpots, priceCents, hoursUntil, hasWaitlist, policy.min_fill_threshold_pct ?? 70);
      if (detectionTriggers.length === 0) continue; // no triggers

      const revenueScore = scoreRevenue(openSpots, priceCents);
      const urgencyScore = scoreUrgency(hoursUntil);
      const fillProb = estimateFillProbability(utilizationPct, hasWaitlist, hoursUntil, coachFillRates[coachName]);
      const priority = overallPriority(revenueScore.score, urgencyScore.score, fillProb);
      const recommendations = generateRecommendations(openSpots, hasWaitlist, hoursUntil, utilizationPct);
      const sessionName = String(booking.service_name ?? "Session");

      // Upsert opportunity score
      await db.execute(sql`
        INSERT INTO fill_opportunity_scores
          (org_id, booking_id, session_name, coach_name, session_start, open_spots,
           total_spots, session_price_cents, utilization_pct,
           revenue_impact, urgency, fill_probability, overall_priority,
           detection_triggers, recommendations, auto_draft_status, status,
           detected_at, last_scanned_at)
        VALUES
          (${orgId}, ${booking.id}, ${sessionName}, ${coachName},
           ${booking.start_at}, ${openSpots}, ${max}, ${priceCents}, ${utilizationPct},
           ${revenueScore.label}, ${urgencyScore.label}, ${fillProb}, ${priority},
           ${JSON.stringify(detectionTriggers)}, ${JSON.stringify(recommendations)},
           'not_generated', 'active', NOW(), NOW())
        ON CONFLICT (org_id, booking_id) DO UPDATE SET
          open_spots = EXCLUDED.open_spots,
          utilization_pct = EXCLUDED.utilization_pct,
          revenue_impact = EXCLUDED.revenue_impact,
          urgency = EXCLUDED.urgency,
          fill_probability = EXCLUDED.fill_probability,
          overall_priority = EXCLUDED.overall_priority,
          detection_triggers = EXCLUDED.detection_triggers,
          recommendations = EXCLUDED.recommendations,
          last_scanned_at = NOW(),
          status = 'active'
      `).catch(() => {});

      newCount++;

      // Auto-generate draft if policy allows and not yet generated
      if (policy.auto_draft_generation) {
        const existing = getRows(await db.execute(sql`
          SELECT auto_draft_status, id FROM fill_opportunity_scores
          WHERE org_id = ${orgId} AND booking_id = ${booking.id} LIMIT 1
        `).catch(() => ({ rows: [] })));
        const opp = existing[0];
        if (opp && opp.auto_draft_status === 'not_generated') {
          // Fire-and-forget auto-draft generation (non-blocking)
          autoGenerateDraft(
            opp.id, booking.id, orgId, sessionName, coachName,
            openSpots, priceCents, hoursUntil
          ).catch(() => {});
        }
      }
    }

    // Mark expired opportunities (session already started or session fully filled)
    await db.execute(sql`
      UPDATE fill_opportunity_scores
      SET status = 'expired'
      WHERE org_id = ${orgId}
        AND status = 'active'
        AND (
          session_start <= NOW()
          OR booking_id NOT IN (
            SELECT id FROM bookings
            WHERE organization_id = ${orgId}
              AND start_at > NOW()
              AND id IN (
                SELECT booking_id FROM fill_opportunity_scores
                WHERE org_id = ${orgId} AND status = 'active'
              )
          )
        )
    `).catch(() => {});

    return newCount;
  } catch { return 0; }
}

// ── Scan all orgs ─────────────────────────────────────────────────────────────

async function scanAllOrgs(): Promise<void> {
  try {
    const orgRows = getRows(await db.execute(sql`
      SELECT DISTINCT org_id FROM fill_revenue_policies WHERE enabled = true
      UNION
      SELECT DISTINCT org_id FROM fill_campaign_drafts
      UNION
      SELECT DISTINCT org_id FROM fill_campaign_submissions
    `).catch(() => ({ rows: [] })));

    for (const row of orgRows) {
      if (row.org_id) {
        await scanOpportunitiesForOrg(row.org_id).catch(() => {});
      }
    }
  } catch {}
}

// ── Start background monitoring ───────────────────────────────────────────────

export function startFillMonitoring(): void {
  // Initial scan after 5s startup delay
  setTimeout(() => scanAllOrgs().catch(() => {}), 5000);
  // Periodic scan every 30 minutes
  setInterval(() => scanAllOrgs().catch(() => {}), 30 * 60 * 1000);
}

export { autoGenerateDraft };
