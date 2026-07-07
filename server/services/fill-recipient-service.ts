import { db } from "../db";
import { sql } from "drizzle-orm";

function getRows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

export interface RecipientCandidate {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  score: number;
  reasons: string[];
  excluded: boolean;
  exclusionReason?: string;
}

export interface SessionContext {
  coachId: string;
  coachUserId: string;
  coachFirstName: string;
  coachLastName: string;
  serviceId: string;
  serviceName: string;
  startAt: string;
  maxParticipants: number;
  dow: number;
  hour: number;
}

export interface RecipientResult {
  recipients: RecipientCandidate[];
  sessionContext: SessionContext | null;
  registeredCount: number;
  openSpots: number;
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function rankFillRecipients(
  bookingId: string,
  orgId: string
): Promise<RecipientResult> {

  // ── 1. Session context ─────────────────────────────────────────────────────
  const sessionRaw = await db.execute(sql`
    SELECT b.id, b.coach_id, b.service_id, b.start_at, b.max_participants,
           COUNT(bp.id)::int AS registered_count,
           s.name AS service_name,
           cp.user_id AS coach_user_id,
           u.first_name AS coach_first, u.last_name AS coach_last
    FROM bookings b
    LEFT JOIN services s ON b.service_id = s.id
    LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    LEFT JOIN booking_participants bp ON bp.booking_id = b.id
    WHERE b.id = ${bookingId} AND b.organization_id = ${orgId}
    GROUP BY b.id, s.name, cp.user_id, u.first_name, u.last_name
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  const sessions = getRows(sessionRaw);
  if (sessions.length === 0) {
    return { recipients: [], sessionContext: null, registeredCount: 0, openSpots: 0 };
  }

  const sess = sessions[0];
  const startAt = new Date(sess.start_at);
  const dow = startAt.getDay();
  const hour = startAt.getHours();
  const maxParticipants = parseInt(sess.max_participants || 6);
  const registeredCount = parseInt(sess.registered_count || 0);
  const openSpots = Math.max(0, maxParticipants - registeredCount);

  const sessionCtx: SessionContext = {
    coachId: sess.coach_id || "",
    coachUserId: sess.coach_user_id || "",
    coachFirstName: sess.coach_first || "",
    coachLastName: sess.coach_last || "",
    serviceId: sess.service_id || "",
    serviceName: sess.service_name || "",
    startAt: sess.start_at,
    maxParticipants,
    dow,
    hour,
  };

  // ── 2. Already registered for this booking ─────────────────────────────────
  const registeredRaw = await db.execute(sql`
    SELECT user_id FROM booking_participants WHERE booking_id = ${bookingId}
  `).catch(() => ({ rows: [] }));
  const registeredIds = new Set(getRows(registeredRaw).map((r: any) => r.user_id));

  // ── 3. All CLIENT users in this org ───────────────────────────────────────
  const candidatesRaw = await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM users u
    JOIN user_profiles up ON up.user_id = u.id
    WHERE up.organization_id = ${orgId}
      AND up.role = 'CLIENT'
    LIMIT 500
  `).catch(() => ({ rows: [] }));

  const allCandidates = getRows(candidatesRaw);
  const candidates = allCandidates.filter((c: any) => !registeredIds.has(c.id));

  if (candidates.length === 0) {
    return { recipients: [], sessionContext: sessionCtx, registeredCount, openSpots };
  }

  const candidateIdSet = new Set(candidates.map((c: any) => c.id as string));

  // ── 4. Batch signal queries (org-scoped, filter in JS) ─────────────────────
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const conflictStart = new Date(startAt.getTime() - 3600000).toISOString();
  const conflictEnd = new Date(startAt.getTime() + 3600000).toISOString();

  const [
    waitlistRaw,
    historyRaw,
    cancelledRaw,
    conflictRaw,
    athleteProfilesRaw,
  ] = await Promise.all([
    // Waitlist entries for this exact session
    db.execute(sql`
      SELECT user_id FROM session_waitlists
      WHERE booking_id = ${bookingId}
    `).catch(() => ({ rows: [] })),

    // Booking history for all org clients in last 6 months (not cancelled/no-show)
    db.execute(sql`
      SELECT bp.user_id, b.service_id, b.coach_id, b.start_at,
             EXTRACT(DOW FROM b.start_at)::int AS dow,
             EXTRACT(HOUR FROM b.start_at)::int AS hour
      FROM booking_participants bp
      JOIN bookings b ON bp.booking_id = b.id
      JOIN user_profiles up ON up.user_id = bp.user_id
      WHERE b.organization_id = ${orgId}
        AND up.organization_id = ${orgId}
        AND up.role = 'CLIENT'
        AND b.start_at >= ${sixMonthsAgo}
        AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
      ORDER BY b.start_at DESC
    `).catch(() => ({ rows: [] })),

    // Recent cancellations (last 30 days)
    db.execute(sql`
      SELECT bp.user_id
      FROM booking_participants bp
      JOIN bookings b ON bp.booking_id = b.id
      WHERE b.organization_id = ${orgId}
        AND b.status = 'CANCELLED'
        AND b.start_at >= ${thirtyDaysAgo}
    `).catch(() => ({ rows: [] })),

    // Confirmed booking conflict: same time window, different booking
    db.execute(sql`
      SELECT bp.user_id
      FROM booking_participants bp
      JOIN bookings b ON bp.booking_id = b.id
      WHERE b.organization_id = ${orgId}
        AND b.status = 'CONFIRMED'
        AND b.id != ${bookingId}
        AND b.start_at BETWEEN ${conflictStart} AND ${conflictEnd}
    `).catch(() => ({ rows: [] })),

    // Athlete scheduling profiles for sport-type matching
    db.execute(sql`
      SELECT asp.user_id, asp.sport, asp.training_level
      FROM athlete_scheduling_profiles asp
      JOIN user_profiles up ON up.user_id = asp.user_id
      WHERE up.organization_id = ${orgId}
        AND up.role = 'CLIENT'
    `).catch(() => ({ rows: [] })),
  ]);

  // ── 5. Build lookup structures ─────────────────────────────────────────────
  const waitlistIds = new Set(
    getRows(waitlistRaw)
      .filter((r: any) => candidateIdSet.has(r.user_id))
      .map((r: any) => r.user_id)
  );

  const conflictIds = new Set(
    getRows(conflictRaw)
      .filter((r: any) => candidateIdSet.has(r.user_id))
      .map((r: any) => r.user_id)
  );

  const cancelledIds = new Set(
    getRows(cancelledRaw)
      .filter((r: any) => candidateIdSet.has(r.user_id))
      .map((r: any) => r.user_id)
  );

  const historyByUser = new Map<string, any[]>();
  getRows(historyRaw).forEach((row: any) => {
    if (!candidateIdSet.has(row.user_id)) return;
    if (!historyByUser.has(row.user_id)) historyByUser.set(row.user_id, []);
    historyByUser.get(row.user_id)!.push(row);
  });

  const profileByUser = new Map<string, any>();
  getRows(athleteProfilesRaw).forEach((row: any) => {
    if (candidateIdSet.has(row.user_id)) profileByUser.set(row.user_id, row);
  });

  const serviceNameLower = sessionCtx.serviceName.toLowerCase();
  const coachLabel =
    `${sessionCtx.coachFirstName} ${sessionCtx.coachLastName}`.trim() || "this coach";

  // ── 6. Score each candidate ────────────────────────────────────────────────
  const scored: RecipientCandidate[] = candidates.map((c: any) => {
    const history = historyByUser.get(c.id) || [];
    const profile = profileByUser.get(c.id);

    // --- Compute days-since-last-booking ---
    const lastEntry = history[0]; // already DESC sorted
    const daysSinceLast = lastEntry
      ? Math.floor((Date.now() - new Date(lastEntry.start_at).getTime()) / 86400000)
      : 999;

    // --- Hard exclusions ---
    if (conflictIds.has(c.id)) {
      return {
        userId: c.id,
        firstName: c.first_name || "",
        lastName: c.last_name || "",
        email: c.email || "",
        score: 0,
        reasons: [],
        excluded: true,
        exclusionReason: "Already booked at this time",
      };
    }

    if (history.length === 0 && daysSinceLast > 90) {
      return {
        userId: c.id,
        firstName: c.first_name || "",
        lastName: c.last_name || "",
        email: c.email || "",
        score: 0,
        reasons: [],
        excluded: true,
        exclusionReason: "No recent activity (90+ days)",
      };
    }

    // --- Score accumulation ---
    let score = 0;
    const reasons: string[] = [];

    // Waitlisted for this session (+30)
    if (waitlistIds.has(c.id)) {
      score += 30;
      reasons.push("Waitlisted for this session");
    }

    // Previously attended same service + same coach (+20)
    const sameServiceCoach = history.filter(
      (h: any) => h.service_id === sessionCtx.serviceId && h.coach_id === sessionCtx.coachId
    );
    if (sameServiceCoach.length > 0) {
      score += 20;
      reasons.push(
        `Attended this session ${sameServiceCoach.length} time${sameServiceCoach.length !== 1 ? "s" : ""}`
      );
    }

    // Trains with this coach (any service) (+15, or +5 bonus if already counted above)
    const coachHistory = history.filter((h: any) => h.coach_id === sessionCtx.coachId);
    if (coachHistory.length > 0) {
      const bonus = sameServiceCoach.length > 0 ? 5 : 15;
      score += bonus;
      reasons.push(`Trains with Coach ${coachLabel}`);
    }

    // Usually attends same weekday (+10)
    const sameDow = history.filter((h: any) => parseInt(h.dow) === sessionCtx.dow);
    if (sameDow.length >= 2) {
      score += 10;
      reasons.push(`Usually attends on ${DOW_NAMES[sessionCtx.dow]}s`);
    }

    // Sport type match from athlete profile (+10)
    if (profile?.sport) {
      const sport = (profile.sport as string).toLowerCase();
      const keywords = sport.split(/[\s,]+/).filter((w: string) => w.length > 3);
      const matches = keywords.some((kw: string) => serviceNameLower.includes(kw));
      if (matches || serviceNameLower.includes(sport)) {
        score += 10;
        reasons.push(`${profile.sport} athlete — matches session type`);
      }
    }

    // Recent activity (<= 30 days) (+10)
    if (daysSinceLast <= 30) {
      score += 10;
      reasons.push("Active in the last 30 days");
    } else if (daysSinceLast <= 60) {
      score += 5;
      reasons.push("Active in the last 60 days");
    }

    // High attendance consistency (+5)
    const last90dCount = history.filter((h: any) => {
      const d = new Date(h.start_at);
      return Date.now() - d.getTime() <= 90 * 86400000;
    }).length;

    if (last90dCount >= 8) {
      score += 5;
      reasons.push(`High consistency — ${last90dCount} sessions in 90 days`);
    } else if (last90dCount >= 4) {
      score += 3;
      reasons.push(`${last90dCount} sessions in the past 90 days`);
    }

    // --- Negative signals ---
    if (cancelledIds.has(c.id)) {
      score = Math.max(0, score - 10);
      reasons.push("Recently cancelled a session");
    }

    if (daysSinceLast > 60 && daysSinceLast <= 90) {
      score = Math.max(0, score - 15);
      if (!reasons.some(r => r.includes("Active"))) {
        reasons.push("Inactive for 60+ days");
      }
    }

    // New client with no history
    if (history.length === 0) {
      score = Math.max(score, 5);
      reasons.push("New client");
    }

    return {
      userId: c.id,
      firstName: c.first_name || "",
      lastName: c.last_name || "",
      email: c.email || "",
      score: Math.min(100, score),
      reasons,
      excluded: false,
    };
  });

  // ── 7. Sort: recommended (score >= 10) by score desc; exclude the rest ─────
  const recipients = scored
    .filter((r) => !r.excluded && r.score >= 10)
    .sort((a, b) => b.score - a.score);

  return { recipients, sessionContext: sessionCtx, registeredCount, openSpots };
}
