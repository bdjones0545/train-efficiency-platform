import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import { rankFillRecipients } from "./services/fill-recipient-service";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getRows(result: any): any[] {
  return Array.isArray(result) ? result : ((result as any)?.rows ?? []);
}

/**
 * Resolve userId and org/role profile for both auth paths:
 *  - Replit OIDC  → req.user.claims.sub
 *  - Custom email/password → req.user.id
 * Role and organizationId live in user_profiles, never on req.user directly.
 */
async function resolveAuthProfile(req: any): Promise<{ userId: string; orgId: string; role: string } | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const raw = await db.execute(sql`
    SELECT role, organization_id FROM user_profiles WHERE user_id = ${userId} LIMIT 1
  `).catch(() => ({ rows: [] }));
  const profile = (Array.isArray(raw) ? raw : (raw as any)?.rows ?? [])[0];
  if (!profile?.organization_id) return null;
  return { userId, orgId: profile.organization_id, role: profile.role ?? "CLIENT" };
}

export async function registerSchedulingIntelligenceRoutes(
  app: Express,
  isAuthenticated: any
) {
  // Inline role guard: admin/coach/staff-only intelligence endpoints.
  // Must be async — role and organizationId live in user_profiles, never on req.user directly.
  // Also caches the resolved profile on req._authProfile so handlers need not re-query.
  const privilegedOnly = async (req: Request, res: Response, next: Function) => {
    const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const raw = await db.execute(sql`
      SELECT role, organization_id FROM user_profiles WHERE user_id = ${userId} LIMIT 1
    `).catch(() => ({ rows: [] }));
    const profile = (Array.isArray(raw) ? raw : (raw as any)?.rows ?? [])[0];
    const role = profile?.role;
    if (!["ADMIN", "COACH", "STAFF"].includes(role)) {
      return res.status(403).json({ message: "Insufficient permissions — requires admin, coach, or staff role" });
    }
    (req as any)._authProfile = { userId, orgId: profile.organization_id, role };
    next();
  };
  // ─── Ensure tables exist ──────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scheduling_health_snapshots (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      utilization_score INTEGER NOT NULL DEFAULT 0,
      revenue_score INTEGER NOT NULL DEFAULT 0,
      attendance_score INTEGER NOT NULL DEFAULT 0,
      retention_score INTEGER NOT NULL DEFAULT 0,
      waitlist_score INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT 'Moderate',
      summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_performance_scores (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      utilization_factor INTEGER NOT NULL DEFAULT 0,
      revenue_factor INTEGER NOT NULL DEFAULT 0,
      attendance_factor INTEGER NOT NULL DEFAULT 0,
      waitlist_factor INTEGER NOT NULL DEFAULT 0,
      velocity_factor INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT 'Moderate',
      computed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scheduling_opportunities (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      description TEXT,
      estimated_value_cents INTEGER DEFAULT 0,
      action_label TEXT,
      action_data JSONB,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS retention_risk_scores (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id TEXT NOT NULL,
      client_user_id TEXT NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'low',
      days_since_last_booking INTEGER DEFAULT 0,
      booking_frequency_drop INTEGER DEFAULT 0,
      cancellation_rate INTEGER DEFAULT 0,
      computed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fill_campaign_drafts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      target_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Extend fill_campaign_drafts with Phase 2 metadata columns
  for (const stmt of [
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS preview_text TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS sms_body TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS push_body TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS social_caption TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS selected_recipient_count INTEGER DEFAULT 0`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS recipient_ids JSONB`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS recipient_summary JSONB`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS model_used TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS generation_version TEXT`,
    `ALTER TABLE fill_campaign_drafts ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ`,
  ]) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }

  // ─── Health Score ─────────────────────────────────────────────────────────
  app.get("/api/scheduling-intelligence/health-score", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);

      // Gather metrics in parallel
      const [bookingsRaw, attendanceRaw, waitlistRaw, coachCountRaw] = await Promise.all([
        db.execute(sql`
          SELECT b.id, b.status, b.start_at, b.end_at,
                 b.coach_id, s.price_cents, b.max_participants,
                 COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.start_at >= ${weekStart.toISOString()}
            AND b.start_at <= ${weekEnd.toISOString()}
          GROUP BY b.id, s.price_cents
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT status FROM session_attendance
          WHERE org_id = ${orgId}
            AND marked_at >= ${thirtyDaysAgo.toISOString()}
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT id FROM waitlist_holds
          WHERE organization_id = ${orgId} AND status = 'waiting'
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT COUNT(*) as cnt FROM coach_profiles WHERE organization_id = ${orgId}
        `).catch(() => ({ rows: [{ cnt: 0 }] })),
      ]);

      const bookings = getRows(bookingsRaw);
      const attendance = getRows(attendanceRaw);
      const waitlist = getRows(waitlistRaw);

      const activeBookings = bookings.filter((b: any) => b.status !== "CANCELLED" && b.status !== "NO_SHOW");
      const totalCapacity = activeBookings.reduce((s: number, b: any) => s + parseInt(b.max_participants || 6), 0);
      const totalRegistered = activeBookings.reduce((s: number, b: any) => s + parseInt(b.registered_count || 0), 0);
      const avgUtil = totalCapacity > 0 ? Math.round((totalRegistered / totalCapacity) * 100) : 0;

      // revenueCapture / revenueScore / revenueFactor are SCHEDULING CAPACITY metrics:
      // they measure what % of maximum possible capacity revenue was filled via registrations.
      // These are intentionally booking-based fill-rate estimates, NOT accounting revenue.
      // Accounting revenue (ledger-based) lives in financial-metrics.ts.
      const maxRevenue = activeBookings.reduce((s: number, b: any) =>
        s + parseInt(b.max_participants || 6) * parseInt(b.price_cents || 0), 0);
      const actualRevenue = activeBookings.reduce((s: number, b: any) =>
        s + parseInt(b.registered_count || 0) * parseInt(b.price_cents || 0), 0);
      const revenueCapture = maxRevenue > 0 ? Math.round((actualRevenue / maxRevenue) * 100) : 0;

      const presentCount = attendance.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length;
      const attendanceScore = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 70;

      const waitlistCount = waitlist.length;
      const waitlistScore = Math.min(100, 50 + waitlistCount * 5);

      const cancelRate = bookings.length > 0
        ? Math.round((bookings.filter((b: any) => b.status === "CANCELLED").length / bookings.length) * 100)
        : 0;
      const retentionScore = Math.max(0, 100 - cancelRate * 2);

      const utilizationScore = Math.min(100, avgUtil);
      const revenueScore = Math.min(100, revenueCapture);

      const overallScore = Math.round(
        utilizationScore * 0.30 +
        revenueScore * 0.25 +
        attendanceScore * 0.20 +
        retentionScore * 0.15 +
        waitlistScore * 0.10
      );

      const label = overallScore >= 90 ? "Excellent" :
                    overallScore >= 75 ? "Healthy" :
                    overallScore >= 60 ? "Needs Attention" : "Critical";

      const summary = overallScore >= 90
        ? "Your scheduling operation is running at peak performance."
        : overallScore >= 75
        ? "Healthy performance with minor opportunities to optimize."
        : overallScore >= 60
        ? "Needs attention — several opportunities to improve fill rates and revenue."
        : "Critical — low utilization and significant revenue gaps detected. Immediate action recommended.";

      res.json({
        score: overallScore,
        label,
        summary,
        breakdown: {
          utilization: utilizationScore,
          revenue: revenueScore,
          attendance: attendanceScore,
          retention: retentionScore,
          waitlist: waitlistScore,
        },
        metrics: {
          avgUtilization: avgUtil,
          revenueCapturePct: revenueCapture,
          attendanceRate: attendanceScore,
          cancelRate,
          waitlistCount,
          activeSessionsThisWeek: activeBookings.length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute health score", error: e.message });
    }
  });

  // ─── Session Performance Score ────────────────────────────────────────────
  app.get("/api/scheduling-intelligence/session-performance/:bookingId", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      const { bookingId } = req.params;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const [bookingRaw, attendanceRaw, waitlistRaw] = await Promise.all([
        db.execute(sql`
          SELECT b.id, b.status, b.start_at, b.max_participants, s.price_cents,
                 COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.id = ${bookingId} AND b.organization_id = ${orgId}
          GROUP BY b.id, s.price_cents
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT status FROM session_attendance WHERE booking_id = ${bookingId}
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT id FROM waitlist_holds WHERE booking_id = ${bookingId} AND status = 'waiting'
        `).catch(() => ({ rows: [] })),
      ]);

      const booking = getRows(bookingRaw)[0];
      if (!booking) return res.status(404).json({ message: "Session not found" });

      const attendance = getRows(attendanceRaw);
      const waitlist = getRows(waitlistRaw);

      const maxP = parseInt(booking.max_participants || 6);
      const reg = parseInt(booking.registered_count || 0);
      const price = parseInt(booking.price_cents || 0);

      const utilizationFactor = maxP > 0 ? Math.min(100, Math.round((reg / maxP) * 100)) : 0;
      const revenueFactor = price > 0 ? Math.min(100, Math.round((reg * price) / (maxP * price) * 100)) : utilizationFactor;
      const presentCount = attendance.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length;
      const attendanceFactor = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 75;
      const waitlistFactor = Math.min(100, waitlist.length * 20);
      const velocityFactor = reg >= maxP * 0.8 ? 100 : reg >= maxP * 0.5 ? 70 : reg >= maxP * 0.3 ? 50 : 30;

      const score = Math.round(
        utilizationFactor * 0.35 +
        revenueFactor * 0.25 +
        attendanceFactor * 0.20 +
        waitlistFactor * 0.10 +
        velocityFactor * 0.10
      );

      const label = score >= 90 ? "Excellent" : score >= 75 ? "Healthy" : score >= 60 ? "Needs Attention" : "Critical";
      const labelColor = score >= 90 ? "green" : score >= 75 ? "blue" : score >= 60 ? "yellow" : "red";

      res.json({
        bookingId,
        score,
        label,
        labelColor,
        factors: {
          utilization: utilizationFactor,
          revenue: revenueFactor,
          attendance: attendanceFactor,
          waitlist: waitlistFactor,
          velocity: velocityFactor,
        },
        meta: {
          registered: reg,
          capacity: maxP,
          waitlistCount: waitlist.length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute performance score", error: e.message });
    }
  });

  // ─── Opportunity Inbox ────────────────────────────────────────────────────
  app.get("/api/scheduling-intelligence/opportunities", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + 14);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const [lowFillRaw, cancelledRaw, waitlistRaw, inactiveRaw] = await Promise.all([
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                 s.price_cents, u.first_name as coach_first, u.last_name as coach_last,
                 COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${nextWeek.toISOString()}
          GROUP BY b.id, s.name, s.price_cents, u.first_name, u.last_name
          HAVING COUNT(bp.id)::float / NULLIF(b.max_participants, 0) < 0.5
          ORDER BY b.start_at ASC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT b.id, b.start_at, s.name as service_name, s.price_cents,
                 u.first_name as coach_first, u.last_name as coach_last,
                 COUNT(bp.id) as registered_count, b.max_participants
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CANCELLED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${nextWeek.toISOString()}
          GROUP BY b.id, s.name, s.price_cents, u.first_name, u.last_name
          ORDER BY b.start_at ASC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT wh.booking_id, COUNT(*) as waitlist_count,
                 b.start_at, s.name as service_name, b.max_participants,
                 COUNT(bp.id) as registered_count
          FROM waitlist_holds wh
          JOIN bookings b ON wh.booking_id = b.id
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId} AND wh.status = 'waiting'
            AND b.start_at > ${now.toISOString()}
          GROUP BY wh.booking_id, b.start_at, s.name, b.max_participants
          HAVING COUNT(*) > 0
          ORDER BY COUNT(*) DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT u.id, u.first_name, u.last_name,
                 MAX(b.start_at) as last_booking,
                 COUNT(b.id) as total_bookings
          FROM users u
          JOIN booking_participants bp ON bp.user_id = u.id
          JOIN bookings b ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND u.organization_id = ${orgId}
          GROUP BY u.id, u.first_name, u.last_name
          HAVING MAX(b.start_at) < ${thirtyDaysAgo.toISOString()}
          ORDER BY MAX(b.start_at) ASC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
      ]);

      const lowFill = getRows(lowFillRaw);
      const cancelled = getRows(cancelledRaw);
      const waitlistSessions = getRows(waitlistRaw);
      const inactive = getRows(inactiveRaw);

      const opportunities: any[] = [];

      // ── Revenue category: fill sessions & recover cancellations ──
      lowFill.forEach((s: any) => {
        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        const price = parseInt(s.price_cents || 0);
        const openSpots = max - reg;
        const estimatedValue = openSpots * price;
        const start = new Date(s.start_at);
        const hoursUntil = (start.getTime() - now.getTime()) / 3600000;
        const daysUntil = Math.ceil(hoursUntil / 24);
        const fillPct = max > 0 ? (reg / max) : 0;
        // Critical: < 24h away AND under 20% fill
        const isCritical = hoursUntil <= 24 && fillPct < 0.2;
        const priority = isCritical ? "critical" : hoursUntil <= 48 ? "high" : daysUntil <= 5 ? "medium" : "low";
        opportunities.push({
          id: `fill-${s.id}`,
          type: "fill_session",
          category: "revenue",
          priority,
          title: `Fill ${openSpots} open spot${openSpots !== 1 ? "s" : ""} in ${s.service_name || "session"}`,
          description: `${reg}/${max} registered · ${daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `in ${daysUntil} days`} · Coach ${s.coach_first || ""} ${s.coach_last || ""}`,
          estimatedValueCents: estimatedValue,
          actionLabel: "Create Fill Campaign",
          sessionId: s.id,
          sessionStart: s.start_at,
          openSpots,
          registered: reg,
          capacity: max,
        });
      });

      cancelled.forEach((s: any) => {
        const max = parseInt(s.max_participants || 6);
        const price = parseInt(s.price_cents || 0);
        const start = new Date(s.start_at);
        const hoursUntil = (start.getTime() - now.getTime()) / 3600000;
        const daysUntil = Math.ceil(hoursUntil / 24);
        const isCritical = hoursUntil <= 24;
        opportunities.push({
          id: `cancel-${s.id}`,
          type: "recover_cancellation",
          category: "revenue",
          priority: isCritical ? "critical" : "high",
          title: `Recover cancelled ${s.service_name || "session"}`,
          description: `Slot opened up ${daysUntil === 0 ? "today" : `in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`} — backfill from waitlist or inactive clients`,
          estimatedValueCents: max * price,
          actionLabel: "Find Replacement",
          sessionId: s.id,
          sessionStart: s.start_at,
        });
      });

      // ── Capacity category: waitlist demand ──
      waitlistSessions.forEach((s: any) => {
        const wCount = parseInt(s.waitlist_count || 0);
        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        opportunities.push({
          id: `waitlist-${s.booking_id}`,
          type: "waitlist_demand",
          category: "capacity",
          priority: wCount >= 5 ? "critical" : wCount >= 3 ? "high" : "medium",
          title: `${wCount} athlete${wCount !== 1 ? "s" : ""} waiting for ${s.service_name || "session"}`,
          description: `Session is at ${reg}/${max} capacity with active demand — consider adding another session`,
          estimatedValueCents: 0,
          actionLabel: "Add Session",
          sessionId: s.booking_id,
          waitlistCount: wCount,
        });
      });

      // ── Retention category: inactive clients ──
      inactive.forEach((client: any) => {
        const lastBooking = new Date(client.last_booking);
        const daysInactive = Math.floor((now.getTime() - lastBooking.getTime()) / 86400000);
        opportunities.push({
          id: `reactivate-${client.id}`,
          type: "reactivation",
          category: "retention",
          priority: daysInactive >= 90 ? "critical" : daysInactive >= 60 ? "high" : "medium",
          title: `Reactivate ${client.first_name || ""} ${client.last_name || ""}`,
          description: `${daysInactive} days since last booking · ${client.total_bookings} total sessions`,
          estimatedValueCents: 7000,
          actionLabel: "Send Outreach",
          clientId: client.id,
          daysInactive,
        });
      });

      // ── Coach category: utilization-derived opportunities (from utilization-intelligence data) ──
      try {
        const coachUtilRaw = await db.execute(sql`
          SELECT cp.id, cp.user_id, u.first_name, u.last_name,
                 COUNT(DISTINCT b.id) as session_count_week
          FROM coach_profiles cp
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN bookings b ON b.coach_id = cp.id
            AND b.start_at >= ${new Date(now.getTime() - 7 * 86400000).toISOString()}
            AND b.start_at <= ${new Date(now.getTime() + 7 * 86400000).toISOString()}
            AND b.status IN ('CONFIRMED', 'COMPLETED')
          WHERE cp.organization_id = ${orgId}
          GROUP BY cp.id, cp.user_id, u.first_name, u.last_name
        `).catch(() => ({ rows: [] }));

        const coachUtil = getRows(coachUtilRaw);
        coachUtil.forEach((c: any) => {
          const sessions = parseInt(c.session_count_week || 0);
          const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Coach";
          if (sessions === 0) {
            opportunities.push({
              id: `coach-inactive-${c.id}`,
              type: "coach_underutilized",
              category: "coach",
              priority: "high",
              title: `Coach ${name} has no sessions this week`,
              description: "Inactive coach — consider scheduling sessions to maximize revenue capacity",
              estimatedValueCents: 0,
              actionLabel: "Schedule Sessions",
              coachId: c.id,
            });
          } else if (sessions <= 10) {
            opportunities.push({
              id: `coach-low-${c.id}`,
              type: "coach_underutilized",
              category: "coach",
              priority: "medium",
              title: `Coach ${name} is underutilized (${sessions} session${sessions !== 1 ? "s" : ""}/week)`,
              description: "Low session count — a healthy full-time coaching load is 11–20 sessions/week. Consider filling open slots.",
              estimatedValueCents: 0,
              actionLabel: "Add Sessions",
              coachId: c.id,
            });
          } else if (sessions >= 41) {
            opportunities.push({
              id: `coach-overloaded-${c.id}`,
              type: "coach_overloaded",
              category: "coach",
              priority: "high",
              title: `Coach ${name} is overloaded (${sessions} sessions/week)`,
              description: "Session count exceeds full-time capacity (40/wk). Redistribute clients to prevent burnout and quality decline.",
              estimatedValueCents: 0,
              actionLabel: "Review Schedule",
              coachId: c.id,
            });
          } else if (sessions >= 31) {
            opportunities.push({
              id: `coach-near-capacity-${c.id}`,
              type: "coach_overloaded",
              category: "coach",
              priority: "medium",
              title: `Coach ${name} is near capacity (${sessions} sessions/week)`,
              description: "Approaching full load (30/wk). Accept new bookings cautiously and monitor for fatigue.",
              estimatedValueCents: 0,
              actionLabel: "Review Schedule",
              coachId: c.id,
            });
          }
        });
      } catch { /* non-critical */ }

      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      opportunities.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

      // Persist top opportunities as a snapshot
      await Promise.all(
        opportunities.slice(0, 10).map(o =>
          db.execute(sql`
            INSERT INTO scheduling_opportunities (org_id, type, priority, title, description, estimated_value_cents, action_label, action_data, status)
            VALUES (${orgId}, ${o.type}, ${o.priority}, ${o.title}, ${o.description || ""}, ${o.estimatedValueCents || 0}, ${o.actionLabel || ""}, ${JSON.stringify({ sessionId: o.sessionId, clientId: o.clientId })}, 'open')
            ON CONFLICT DO NOTHING
          `).catch(() => {})
        )
      );

      res.json({
        opportunities,
        counts: {
          total: opportunities.length,
          critical: opportunities.filter(o => o.priority === "critical").length,
          high: opportunities.filter(o => o.priority === "high").length,
          medium: opportunities.filter(o => o.priority === "medium").length,
          low: opportunities.filter(o => o.priority === "low").length,
          byCategory: {
            revenue: opportunities.filter(o => o.category === "revenue").length,
            capacity: opportunities.filter(o => o.category === "capacity").length,
            retention: opportunities.filter(o => o.category === "retention").length,
            coach: opportunities.filter(o => o.category === "coach").length,
          },
        },
        estimatedTotalValueCents: opportunities.reduce((s, o) => s + (o.estimatedValueCents || 0), 0),
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch opportunities", error: e.message });
    }
  });

  // ─── Revenue Recovery (72h focus + AI recommendations) ────────────────────
  app.get("/api/scheduling-intelligence/revenue-recovery", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const next72h = new Date(now.getTime() + 72 * 3600000);
      const next30d = new Date(now);
      next30d.setDate(now.getDate() + 30);

      const [urgentRaw, sessionsRaw, cancelledRaw, orgRaw] = await Promise.all([
        // Critical: sessions under 50% in next 72h
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                 s.price_cents, COUNT(bp.id) as registered_count,
                 u.first_name as coach_first, u.last_name as coach_last
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${next72h.toISOString()}
          GROUP BY b.id, s.name, s.price_cents, u.first_name, u.last_name
          HAVING COUNT(bp.id)::float / NULLIF(b.max_participants, 0) < 0.5
          ORDER BY b.start_at ASC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // All upcoming sessions with gaps
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                 s.price_cents, COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${next30d.toISOString()}
          GROUP BY b.id, s.name, s.price_cents
          ORDER BY b.start_at ASC
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name, s.price_cents
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CANCELLED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${next30d.toISOString()}
          ORDER BY b.start_at ASC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT name FROM organizations WHERE id = ${orgId} LIMIT 1
        `).catch(() => ({ rows: [] })),
      ]);

      const urgent = getRows(urgentRaw);
      const sessions = getRows(sessionsRaw);
      const cancelled = getRows(cancelledRaw);
      const orgName = getRows(orgRaw)[0]?.name || "your studio";

      let totalLostRevenue = 0;
      let totalRecoverableRevenue = 0;

      const gaps = sessions.map((s: any) => {
        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        const price = parseInt(s.price_cents || 0);
        const openSpots = max - reg;
        const lost = openSpots * price;
        totalLostRevenue += lost;
        const recoverable = Math.round(lost * 0.6);
        totalRecoverableRevenue += recoverable;
        const hoursUntil = (new Date(s.start_at).getTime() - now.getTime()) / 3600000;
        return {
          sessionId: s.id,
          serviceName: s.service_name || "Session",
          startAt: s.start_at,
          registered: reg,
          capacity: max,
          openSpots,
          priceCents: price,
          lostRevenueCents: lost,
          recoverableRevenueCents: recoverable,
          utilizationPct: max > 0 ? Math.round((reg / max) * 100) : 0,
          isUrgent: hoursUntil <= 72,
          urgencyLabel: hoursUntil <= 24 ? "Today" : hoursUntil <= 48 ? "Tomorrow" : hoursUntil <= 72 ? "Next 72h" : null,
        };
      }).filter(g => g.openSpots > 0).sort((a, b) => {
        if (a.isUrgent && !b.isUrgent) return -1;
        if (!a.isUrgent && b.isUrgent) return 1;
        return b.lostRevenueCents - a.lostRevenueCents;
      });

      const cancelledGaps = cancelled.map((s: any) => {
        const max = parseInt(s.max_participants || 6);
        const price = parseInt(s.price_cents || 0);
        const recoverable = max * price;
        totalRecoverableRevenue += Math.round(recoverable * 0.4);
        return {
          sessionId: s.id,
          serviceName: s.service_name || "Session",
          startAt: s.start_at,
          maxRevenueCents: recoverable,
          recoverableRevenueCents: Math.round(recoverable * 0.4),
        };
      });

      // AI per-session recommendations for urgent (72h) sessions
      let gapsWithRecs = gaps.slice(0, 10);
      if (urgent.length > 0) {
        try {
          const urgentList = urgent.map((s: any) => {
            const max = parseInt(s.max_participants || 6);
            const reg = parseInt(s.registered_count || 0);
            return {
              id: s.id,
              label: `"${s.service_name || "Session"}" at ${new Date(s.start_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — ${reg}/${max} registered (${max - reg} open spots)`,
            };
          });

          const aiRes = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
              role: "user",
              content: `You are a scheduling revenue specialist for "${orgName}". Generate 3-5 prioritized, specific recovery actions for EACH of these under-filled sessions (each starting within 72h):\n\n${urgentList.map(u => u.label).join("\n")}\n\nReturn JSON:\n{\n  "sessions": [\n    { "sessionIndex": 0, "recommendations": [{ "action": "...", "rationale": "...", "impact": "high|medium|low" }] },\n    ...\n  ]\n}`,
            }],
            response_format: { type: "json_object" },
            max_tokens: 700,
          });
          const content = aiRes.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(content);
          const sessionRecs: any[] = Array.isArray(parsed.sessions) ? parsed.sessions : [];

          // Merge per-session recommendations into gaps
          gapsWithRecs = gapsWithRecs.map(g => {
            const idx = urgent.findIndex((u: any) => u.id === g.sessionId);
            if (idx === -1) return g;
            const sessRec = sessionRecs.find((sr: any) => sr.sessionIndex === idx);
            return { ...g, recommendations: sessRec?.recommendations ?? [] };
          });
        } catch {
          // Fallback: attach generic recommendations to urgent gaps
          gapsWithRecs = gapsWithRecs.map(g => {
            if (!g.isUrgent) return g;
            return {
              ...g,
              recommendations: [
                { action: "Text waitlist contacts about this open session immediately", rationale: "Fastest fill path within 72h", impact: "high" },
                { action: "Post a flash offer on social media with session details", rationale: "Creates urgency and attracts price-sensitive prospects", impact: "high" },
                { action: "Email inactive clients who attended this session type before", rationale: "Familiar sessions have higher conversion rates", impact: "medium" },
              ],
            };
          });
        }
      }

      res.json({
        summary: {
          totalLostRevenueCents: totalLostRevenue,
          totalRecoverableRevenueCents: totalRecoverableRevenue,
          sessionsWithGaps: gaps.length,
          cancelledSessions: cancelledGaps.length,
          urgentSessions: urgent.length,
        },
        gaps: gapsWithRecs,
        cancelled: cancelledGaps,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch revenue recovery", error: e.message });
    }
  });

  // ─── Retention Risk ───────────────────────────────────────────────────────
  app.get("/api/scheduling-intelligence/retention-risk", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      const sixtyDaysAgo = new Date(now);
      sixtyDaysAgo.setDate(now.getDate() - 60);
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(now.getDate() - 90);

      const clientsRaw = await db.execute(sql`
        SELECT u.id, u.first_name, u.last_name,
               MAX(b.start_at) as last_booking_at,
               COUNT(CASE WHEN b.start_at >= ${ninetyDaysAgo.toISOString()} THEN 1 END) as bookings_90d,
               COUNT(CASE WHEN b.start_at >= ${thirtyDaysAgo.toISOString()} THEN 1 END) as bookings_30d,
               COUNT(CASE WHEN b.status = 'CANCELLED' AND b.start_at >= ${thirtyDaysAgo.toISOString()} THEN 1 END) as cancellations_30d,
               COUNT(b.id) as total_bookings
        FROM users u
        JOIN booking_participants bp ON bp.user_id = u.id
        JOIN bookings b ON bp.booking_id = b.id
        WHERE b.organization_id = ${orgId}
          AND u.organization_id = ${orgId}
        GROUP BY u.id, u.first_name, u.last_name
        HAVING MAX(b.start_at) IS NOT NULL
        ORDER BY MAX(b.start_at) ASC
        LIMIT 50
      `).catch(() => ({ rows: [] }));

      const clients = getRows(clientsRaw);

      const riskProfiles = clients.map((c: any) => {
        const lastBooking = c.last_booking_at ? new Date(c.last_booking_at) : null;
        const daysSinceLast = lastBooking
          ? Math.floor((now.getTime() - lastBooking.getTime()) / 86400000)
          : 999;
        const bookings90 = parseInt(c.bookings_90d || 0);
        const bookings30 = parseInt(c.bookings_30d || 0);
        const cancellations30 = parseInt(c.cancellations_30d || 0);
        const total = parseInt(c.total_bookings || 0);

        const frequencyDrop = bookings90 > 0
          ? Math.max(0, Math.round((1 - (bookings30 / (bookings90 / 3))) * 100))
          : 0;
        const cancelRate = bookings30 > 0
          ? Math.round((cancellations30 / bookings30) * 100)
          : 0;

        let riskScore = 0;
        if (daysSinceLast >= 60) riskScore += 40;
        else if (daysSinceLast >= 30) riskScore += 25;
        else if (daysSinceLast >= 14) riskScore += 10;
        riskScore += Math.min(30, frequencyDrop * 0.3);
        riskScore += Math.min(30, cancelRate * 0.3);
        riskScore = Math.min(100, Math.round(riskScore));

        const riskLevel = riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";

        return {
          clientId: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Client",
          riskScore,
          riskLevel,
          daysSinceLastBooking: daysSinceLast,
          bookingsLast30Days: bookings30,
          bookingsLast90Days: bookings90,
          frequencyDropPct: frequencyDrop,
          cancellationRate: cancelRate,
          totalBookings: total,
          lastBookingAt: c.last_booking_at,
        };
      }).filter(c => c.riskScore >= 20)
        .sort((a, b) => b.riskScore - a.riskScore);

      res.json({
        atRisk: riskProfiles,
        clients: riskProfiles,
        summary: {
          highRisk: riskProfiles.filter(c => c.riskLevel === "high").length,
          mediumRisk: riskProfiles.filter(c => c.riskLevel === "medium").length,
          lowRisk: riskProfiles.filter(c => c.riskLevel === "low").length,
          totalAtRisk: riskProfiles.length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute retention risk", error: e.message });
    }
  });

  // ─── Demand Forecast (per-session) ───────────────────────────────────────
  app.get("/api/scheduling-intelligence/demand-forecast/:bookingId", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      const { bookingId } = req.params;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const [bookingRaw, historicalRaw] = await Promise.all([
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                 s.price_cents, s.id as service_id,
                 COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.id = ${bookingId} AND b.organization_id = ${orgId}
          GROUP BY b.id, s.name, s.price_cents, s.id
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT AVG(sub.fill_pct) as avg_fill_pct, COUNT(*) as sample_size,
                 AVG(sub.registered) as avg_registered,
                 MAX(sub.fill_pct) as max_fill_pct, MIN(sub.fill_pct) as min_fill_pct
          FROM (
            SELECT b2.id,
                   COUNT(bp2.id)::float / NULLIF(b2.max_participants, 0) as fill_pct,
                   COUNT(bp2.id) as registered
            FROM bookings b2
            LEFT JOIN booking_participants bp2 ON bp2.booking_id = b2.id
            WHERE b2.organization_id = ${orgId}
              AND b2.service_id = (SELECT service_id FROM bookings WHERE id = ${bookingId} LIMIT 1)
              AND b2.status IN ('CONFIRMED', 'COMPLETED')
              AND b2.start_at >= ${ninetyDaysAgo.toISOString()}
              AND b2.id != ${bookingId}
            GROUP BY b2.id, b2.max_participants
          ) sub
        `).catch(() => ({ rows: [] })),
      ]);

      const booking = getRows(bookingRaw)[0];
      if (!booking) return res.status(404).json({ message: "Session not found" });

      const historical = getRows(historicalRaw)[0];
      const max = parseInt(booking.max_participants || 6);
      const currentReg = parseInt(booking.registered_count || 0);
      const price = parseInt(booking.price_cents || 0);

      const avgFillPct = parseFloat(historical?.avg_fill_pct || 0) * 100;
      const sampleSize = parseInt(historical?.sample_size || 0);
      const maxFillPct = parseFloat(historical?.max_fill_pct || 0) * 100;

      // Confidence based on sample size
      const confidence = sampleSize >= 10 ? "high" : sampleSize >= 5 ? "medium" : "low";
      const confidenceScore = Math.min(100, sampleSize * 10);

      // Predicted fill based on historical avg (or current if no history)
      const predictedFillPct = sampleSize > 0 ? Math.round(avgFillPct) : Math.round((currentReg / max) * 100);
      const predictedRegistered = Math.round((predictedFillPct / 100) * max);
      const predictedRevenueCents = predictedRegistered * price;
      const maxRevenueCents = Math.round((maxFillPct / 100) * max) * price;

      res.json({
        bookingId,
        serviceName: booking.service_name || "Session",
        startAt: booking.start_at,
        currentRegistered: currentReg,
        capacity: max,
        predictedFillPct,
        predictedRegistered,
        predictedRevenueCents,
        maxRevenueCents,
        historicalAvgFillPct: Math.round(avgFillPct),
        sampleSize,
        confidence,
        confidenceScore,
        insight: predictedFillPct >= 80
          ? "Strong historical demand — this session typically fills well."
          : predictedFillPct >= 50
          ? "Moderate demand — some outreach may improve fill rate."
          : "Below-average fill rate historically — proactive filling recommended.",
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute session demand forecast", error: e.message });
    }
  });

  // ─── Demand Forecast (org-level) ──────────────────────────────────────────
  app.get("/api/scheduling-intelligence/demand-forecast", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(now.getDate() - 90);

      const [historicalRaw, upcomingRaw] = await Promise.all([
        db.execute(sql`
          SELECT
            EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York') as day_of_week,
            EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'America/New_York') as hour_of_day,
            COUNT(*) as booking_count,
            AVG(b.max_participants) as avg_capacity,
            AVG(sub.registered) as avg_registered
          FROM bookings b
          JOIN (
            SELECT booking_id, COUNT(*) as registered FROM booking_participants GROUP BY booking_id
          ) sub ON sub.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status IN ('CONFIRMED', 'COMPLETED')
            AND b.start_at >= ${ninetyDaysAgo.toISOString()}
          GROUP BY EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York'),
                   EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'America/New_York')
          ORDER BY booking_count DESC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT
            EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York') as day_of_week,
            EXTRACT(WEEK FROM b.start_at) as week_num,
            COUNT(*) as session_count,
            SUM(b.max_participants) as total_capacity,
            COUNT(bp.id) as total_registered
          FROM bookings b
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${new Date(now.getTime() + 14 * 86400000).toISOString()}
          GROUP BY EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York'),
                   EXTRACT(WEEK FROM b.start_at)
          ORDER BY day_of_week
        `).catch(() => ({ rows: [] })),
      ]);

      const historical = getRows(historicalRaw);
      const upcoming = getRows(upcomingRaw);

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      const peakDays = historical.slice(0, 7).map((h: any) => ({
        dayName: dayNames[parseInt(h.day_of_week)] || "Unknown",
        dayOfWeek: parseInt(h.day_of_week),
        hour: parseInt(h.hour_of_day),
        bookingCount: parseInt(h.booking_count),
        avgUtilization: h.avg_capacity > 0
          ? Math.round((parseFloat(h.avg_registered || 0) / parseFloat(h.avg_capacity)) * 100)
          : 0,
      }));

      const upcomingDemand = upcoming.map((u: any) => ({
        dayName: dayNames[parseInt(u.day_of_week)] || "Unknown",
        sessions: parseInt(u.session_count),
        capacity: parseInt(u.total_capacity || 0),
        registered: parseInt(u.total_registered || 0),
        utilizationPct: u.total_capacity > 0
          ? Math.round((parseInt(u.total_registered || 0) / parseInt(u.total_capacity)) * 100)
          : 0,
      }));

      const recommendations: string[] = [];
      peakDays.forEach(d => {
        if (d.avgUtilization >= 85) {
          recommendations.push(`${d.dayName}s at ${d.hour}:00 are consistently high-demand — consider adding sessions.`);
        }
      });
      upcomingDemand.forEach(d => {
        if (d.utilizationPct <= 40 && d.sessions > 0) {
          recommendations.push(`${d.dayName} next week has low projected fill (${d.utilizationPct}%) — send proactive outreach.`);
        }
      });

      res.json({
        peakDays,
        upcomingDemand,
        recommendations: recommendations.slice(0, 5),
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute demand forecast", error: e.message });
    }
  });

  // ─── Utilization Intelligence (coach recommendations) ─────────────────────
  app.get("/api/scheduling-intelligence/utilization-intelligence", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const coachesRaw = await db.execute(sql`
        SELECT cp.id, cp.user_id, u.first_name, u.last_name,
               COUNT(DISTINCT b.id) as session_count_week,
               SUM(CASE WHEN b.status IN ('CONFIRMED','COMPLETED') THEN 1 ELSE 0 END) as confirmed_week,
               COUNT(DISTINCT CASE WHEN b.start_at >= ${thirtyDaysAgo.toISOString()} THEN b.id END) as sessions_30d,
               SUM(CASE WHEN b.status IN ('CONFIRMED','COMPLETED')
                         AND b.start_at >= ${thirtyDaysAgo.toISOString()} THEN
                         COALESCE(sub.registered, 0) * COALESCE(s.price_cents, 0) ELSE 0 END) as revenue_30d
        FROM coach_profiles cp
        LEFT JOIN users u ON cp.user_id = u.id
        LEFT JOIN bookings b ON b.coach_id = cp.id
          AND b.start_at >= ${weekStart.toISOString()}
          AND b.start_at <= ${weekEnd.toISOString()}
        LEFT JOIN services s ON b.service_id = s.id
        LEFT JOIN (SELECT booking_id, COUNT(*) as registered FROM booking_participants GROUP BY booking_id) sub ON sub.booking_id = b.id
        WHERE cp.organization_id = ${orgId}
        GROUP BY cp.id, cp.user_id, u.first_name, u.last_name
      `).catch(() => ({ rows: [] }));

      const coaches = getRows(coachesRaw);

      const profiles = coaches.map((c: any) => {
        const sessionsWeek = parseInt(c.session_count_week || 0);
        const sessions30d = parseInt(c.sessions_30d || 0);
        const revenue30d = parseInt(c.revenue_30d || 0);
        const avgSessionsPerWeek = Math.round(sessions30d / 4);

        const recommendations: string[] = [];
        const WEEKLY_CAPACITY = 30; // default full-time capacity
        let status: "optimal" | "underutilized" | "overloaded" | "near_capacity" | "inactive" = "optimal";

        if (sessionsWeek === 0 && sessions30d === 0) {
          status = "inactive";
          recommendations.push("No sessions recorded in 30 days. Verify coach is active and has availability blocks set.");
        } else if (sessionsWeek <= 10 && sessions30d > 0) {
          status = "underutilized";
          recommendations.push("Low weekly volume — run a fill campaign for open slots.");
          recommendations.push("Consider assigning additional semi-private or group sessions.");
          if (sessions30d < 20) recommendations.push("Reach out to inactive clients from this coach's roster.");
        } else if (sessionsWeek >= 41) {
          status = "overloaded";
          recommendations.push("Session count is critically high — reduce load to prevent burnout.");
          recommendations.push("Redistribute clients to other coaches and pause new bookings immediately.");
        } else if (sessionsWeek >= 31) {
          status = "near_capacity";
          recommendations.push("Approaching full capacity — accept new bookings only for high-priority clients.");
          recommendations.push("Monitor for signs of fatigue; proactively manage the schedule for next week.");
        }

        if (revenue30d < 50000 && sessions30d > 5) {
          recommendations.push("Revenue per session is below average — review pricing or session length.");
        }

        return {
          coachId: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Coach",
          sessionsThisWeek: sessionsWeek,
          sessions30Days: sessions30d,
          revenue30DayCents: revenue30d,
          avgSessionsPerWeek,
          status,
          recommendations,
        };
      });

      res.json({ coaches: profiles });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute utilization intelligence", error: e.message });
    }
  });

  // ─── Fill Campaign: Recipient Intelligence (deterministic, no AI) ──────────
  app.get("/api/scheduling-intelligence/fill-campaign/:bookingId/recipients", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });
      const { bookingId } = req.params;
      const result = await rankFillRecipients(bookingId, orgId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to rank recipients", error: e.message });
    }
  });

  // ─── Fill Campaign Generator (AI) ─────────────────────────────────────────
  app.post("/api/scheduling-intelligence/fill-campaign/:bookingId", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const { bookingId } = req.params;
      const {
        sessionName, startAt, openSpots,
        selectedCount, recipientIds, recipientSummary,
      } = req.body;
      const sessionId = bookingId || req.body.sessionId;

      // ── Fetch session context from DB ─────────────────────────────────────
      const [sessionRaw, orgRaw] = await Promise.all([
        db.execute(sql`
          SELECT b.start_at, b.max_participants,
                 s.name AS service_name,
                 u.first_name AS coach_first, u.last_name AS coach_last
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          WHERE b.id = ${sessionId} AND b.organization_id = ${orgId}
          LIMIT 1
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT name FROM organizations WHERE id = ${orgId} LIMIT 1
        `).catch(() => ({ rows: [] })),
      ]);

      const sessRow = (Array.isArray(sessionRaw) ? sessionRaw : (sessionRaw as any)?.rows ?? [])[0];
      const orgRow = (Array.isArray(orgRaw) ? orgRaw : (orgRaw as any)?.rows ?? [])[0];

      const resolvedSessionName = sessRow?.service_name || sessionName || "Group Training Session";
      const resolvedCoachName = sessRow
        ? `${sessRow.coach_first || ""} ${sessRow.coach_last || ""}`.trim() || "your coach"
        : "your coach";
      const resolvedOrgName = orgRow?.name || "our studio";

      const start = startAt ? new Date(startAt) : (sessRow?.start_at ? new Date(sessRow.start_at) : new Date());
      const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const timeStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const resolvedOpenSpots = openSpots ?? (sessRow?.max_participants ?? "a few");
      const resolvedSelectedCount = selectedCount ?? resolvedOpenSpots;

      // ── Build audience context block ──────────────────────────────────────
      const audienceLines: string[] = [];
      if (resolvedSelectedCount) audienceLines.push(`- ${resolvedSelectedCount} athletes selected for outreach`);
      if (recipientSummary) {
        const s = recipientSummary as any;
        if (s.avgScore) audienceLines.push(`- Average relevance score: ${s.avgScore}%`);
        if (s.topReasons?.length) {
          audienceLines.push("- Key audience characteristics:");
          (s.topReasons as string[]).slice(0, 5).forEach((r: string) => audienceLines.push(`  • ${r}`));
        }
        if (s.sportMix?.length) audienceLines.push(`- Sport/program mix: ${(s.sportMix as string[]).join(", ")}`);
        if (s.waitlistedCount) audienceLines.push(`- ${s.waitlistedCount} athletes are waitlisted for this session`);
        if (s.coachRegularsCount) audienceLines.push(`- ${s.coachRegularsCount} regularly train with Coach ${resolvedCoachName}`);
      }
      const audienceBlock = audienceLines.length
        ? `\nAUDIENCE SUMMARY:\n${audienceLines.join("\n")}\n`
        : "";

      const MODEL = "gpt-4o";
      const GENERATION_VERSION = "phase2-v1";

      const prompt = `You are an expert fitness business outreach specialist. Write a personalized fill-campaign for a strength and conditioning studio.
${audienceBlock}
SESSION DETAILS:
- Session: ${resolvedSessionName}
- Coach: ${resolvedCoachName}
- Studio: ${resolvedOrgName}
- Date/Time: ${dateStr} at ${timeStr}
- Open spots: ${resolvedOpenSpots}
- Outreach audience: ${resolvedSelectedCount} selected athletes

INSTRUCTIONS:
- Write copy that feels tailored to this specific audience — reference their history with the coach and session naturally (not by name).
- Create urgency around the limited spots without being pushy.
- Tone: warm, personal, motivating. Not corporate. Not generic.
- For email: 3-4 short paragraphs, max 200 words total.
- For SMS: 2-3 sentences, max 70 words, conversational.
- For push: ultra-short, max 12 words, action-oriented.
- Subject line: max 9 words, creates curiosity or urgency.
- Preview text: 1 sentence, teases the email, max 15 words.
- Social caption: 1-2 punchy sentences with 2-3 hashtags, optional use.

Return ONLY a JSON object with these exact keys:
{
  "subject": "...",
  "previewText": "...",
  "emailBody": "...",
  "smsBody": "...",
  "pushBody": "...",
  "socialCaption": "..."
}`;

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 800,
      });

      const content = completion.choices[0]?.message?.content ?? "{}";
      let draft: any;
      try {
        draft = JSON.parse(content);
      } catch {
        draft = {
          subject: "Spots still open — reserve yours today",
          previewText: "A few spots remain in this week's session.",
          emailBody: "Hey! A few spots just opened up in an upcoming session with Coach " + resolvedCoachName + ". Based on your training history this is a great fit — and spaces are filling fast.\n\nThis is the same session many of you have attended before. Don't miss the chance to lock in your spot.\n\nReply or book directly to confirm your place.",
          smsBody: "Hey! A spot just opened in " + resolvedSessionName + " with Coach " + resolvedCoachName + " on " + dateStr + ". Only " + resolvedOpenSpots + " left — grab it before it's gone.",
          pushBody: resolvedOpenSpots + " spots left in " + resolvedSessionName + ".",
          socialCaption: "Spots available in this week\u2019s session \u2014 DM to reserve. \uD83D\uDCAA #TrainingDay #SpotAvailable",
        };
      }

      const nowIso = new Date().toISOString();

      // ── Persist with rich metadata ────────────────────────────────────────
      if (sessionId) {
        await db.execute(sql`
          INSERT INTO fill_campaign_drafts (
            org_id, booking_id, subject, body,
            preview_text, sms_body, push_body, social_caption,
            target_count, selected_recipient_count,
            recipient_ids, recipient_summary,
            model_used, generation_version, generated_at, status
          ) VALUES (
            ${orgId}, ${sessionId},
            ${draft.subject || ""},
            ${draft.emailBody || ""},
            ${draft.previewText || ""},
            ${draft.smsBody || ""},
            ${draft.pushBody || ""},
            ${draft.socialCaption || ""},
            ${resolvedOpenSpots || 0},
            ${resolvedSelectedCount || 0},
            ${JSON.stringify(recipientIds ?? [])},
            ${JSON.stringify(recipientSummary ?? {})},
            ${MODEL}, ${GENERATION_VERSION}, ${nowIso}, 'draft'
          )
        `).catch(() => {});
      }

      res.json({
        sessionId,
        subject: draft.subject || "",
        previewText: draft.previewText || "",
        emailBody: draft.emailBody || "",
        smsBody: draft.smsBody || "",
        pushBody: draft.pushBody || "",
        socialCaption: draft.socialCaption || "",
        generatedAt: nowIso,
        modelUsed: MODEL,
        generationVersion: GENERATION_VERSION,
        selectedCount: resolvedSelectedCount,
        openSpots: resolvedOpenSpots,
        sessionName: resolvedSessionName,
        coachName: resolvedCoachName,
        orgName: resolvedOrgName,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to generate fill campaign", error: e.message });
    }
  });

  // ─── Capacity Optimization ────────────────────────────────────────────────
  app.get("/api/scheduling-intelligence/capacity-optimization", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const now = new Date();
      const next30d = new Date(now);
      next30d.setDate(now.getDate() + 30);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);

      const [oversubscribedRaw, underutilizedRaw, waitlistPressureRaw, peakHoursRaw] = await Promise.all([
        // Sessions consistently over 90% full in past 30d
        db.execute(sql`
          SELECT b.id, s.name as service_name, b.max_participants,
                 COUNT(bp.id) as registered, b.start_at,
                 u.first_name as coach_first, u.last_name as coach_last
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status IN ('CONFIRMED', 'COMPLETED')
            AND b.start_at >= ${thirtyDaysAgo.toISOString()}
          GROUP BY b.id, s.name, b.max_participants, b.start_at, u.first_name, u.last_name
          HAVING COUNT(bp.id)::float / NULLIF(b.max_participants, 0) >= 0.9
          ORDER BY b.start_at DESC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        // Upcoming sessions under 30% fill
        db.execute(sql`
          SELECT b.id, s.name as service_name, b.max_participants,
                 COUNT(bp.id) as registered, b.start_at,
                 u.first_name as coach_first, u.last_name as coach_last,
                 s.price_cents
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${next30d.toISOString()}
          GROUP BY b.id, s.name, b.max_participants, b.start_at, u.first_name, u.last_name, s.price_cents
          HAVING COUNT(bp.id)::float / NULLIF(b.max_participants, 0) < 0.3
          ORDER BY b.start_at ASC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        // Sessions with waitlist > 3
        db.execute(sql`
          SELECT wh.booking_id, COUNT(*) as waitlist_size,
                 b.max_participants, s.name as service_name,
                 EXTRACT(DOW FROM b.start_at) as day_of_week,
                 EXTRACT(HOUR FROM b.start_at) as hour_of_day
          FROM waitlist_holds wh
          JOIN bookings b ON wh.booking_id = b.id
          LEFT JOIN services s ON b.service_id = s.id
          WHERE b.organization_id = ${orgId}
            AND wh.status = 'waiting'
          GROUP BY wh.booking_id, b.max_participants, s.name, b.start_at
          HAVING COUNT(*) > 2
          ORDER BY COUNT(*) DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Peak demand hours
        db.execute(sql`
          SELECT
            EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York') as dow,
            EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'America/New_York') as hour,
            COUNT(*) as sessions,
            AVG(COUNT(bp.id)) OVER (PARTITION BY EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York'), EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'America/New_York')) as avg_registered
          FROM bookings b
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status IN ('CONFIRMED', 'COMPLETED')
            AND b.start_at >= ${thirtyDaysAgo.toISOString()}
          GROUP BY EXTRACT(DOW FROM b.start_at AT TIME ZONE 'America/New_York'), EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'America/New_York'), b.id
          ORDER BY COUNT(*) DESC
          LIMIT 15
        `).catch(() => ({ rows: [] })),
      ]);

      const oversubscribed = getRows(oversubscribedRaw);
      const underutilized = getRows(underutilizedRaw);
      const waitlistPressure = getRows(waitlistPressureRaw);
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      const recommendations: any[] = [];

      // High demand → expand capacity or add sessions
      if (oversubscribed.length > 0) {
        recommendations.push({
          type: "expand_capacity",
          priority: "high",
          title: `${oversubscribed.length} session${oversubscribed.length !== 1 ? "s" : ""} consistently at or near full capacity`,
          description: "These sessions show strong demand. Consider increasing max participants or adding a second session in the same time slot.",
          affectedSessions: oversubscribed.slice(0, 5).map((s: any) => ({
            id: s.id,
            name: s.service_name,
            registered: parseInt(s.registered || 0),
            capacity: parseInt(s.max_participants || 6),
            coach: `${s.coach_first || ""} ${s.coach_last || ""}`.trim(),
          })),
          actionLabel: "Add Session",
        });
      }

      // Low fill → cancel or merge
      if (underutilized.length > 0) {
        const totalLoss = underutilized.reduce((s: number, u: any) => {
          const open = parseInt(u.max_participants || 6) - parseInt(u.registered || 0);
          return s + open * parseInt(u.price_cents || 0);
        }, 0);
        recommendations.push({
          type: "reduce_capacity",
          priority: "medium",
          title: `${underutilized.length} upcoming sessions are less than 30% full`,
          description: `These sessions have significant open spots. Consider targeted outreach or merging sessions. Estimated revenue gap: $${Math.round(totalLoss / 100).toLocaleString()}.`,
          affectedSessions: underutilized.slice(0, 5).map((s: any) => ({
            id: s.id,
            name: s.service_name,
            registered: parseInt(s.registered || 0),
            capacity: parseInt(s.max_participants || 6),
            coach: `${s.coach_first || ""} ${s.coach_last || ""}`.trim(),
            startAt: s.start_at,
          })),
          actionLabel: "Run Fill Campaign",
        });
      }

      // Waitlist pressure → add sessions
      waitlistPressure.forEach((w: any) => {
        const wSize = parseInt(w.waitlist_size || 0);
        const dow = parseInt(w.day_of_week || 0);
        const hour = parseInt(w.hour_of_day || 0);
        recommendations.push({
          type: "add_session",
          priority: "high",
          title: `Add a ${dayNames[dow]} ${hour > 12 ? `${hour - 12}pm` : `${hour}am`} session — ${wSize} athletes waiting`,
          description: `"${w.service_name || "Session"}" has ${wSize} people on the waitlist. Adding another session at the same time could immediately capture this demand.`,
          actionLabel: "Create Session",
          waitlistSize: wSize,
          suggestedDay: dayNames[dow],
          suggestedHour: hour,
        });
      });

      res.json({ recommendations });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute capacity optimization", error: e.message });
    }
  });

  // ─── Athlete Session Recommendations (auth-scoped) ────────────────────────
  app.get("/api/scheduling-intelligence/athlete-recommendations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      const authUserId = (req as any).user?.id;
      const authRole = (req as any).user?.role;
      if (!orgId) return res.status(403).json({ message: "No org" });

      // Auth-scoped: default to the authenticated user; privileged roles may override with ?userId=
      const isPrivileged = authRole === "ADMIN" || authRole === "COACH" || authRole === "STAFF";
      const requestedUserId = req.query.userId as string | undefined;
      const targetUserId = isPrivileged && requestedUserId ? requestedUserId : authUserId;

      const now = new Date();
      const next14d = new Date(now);
      next14d.setDate(now.getDate() + 14);
      const sixtyDaysAgo = new Date(now);
      sixtyDaysAgo.setDate(now.getDate() - 60);

      const [profileRaw, historyRaw, upcomingRaw] = await Promise.all([
        db.execute(sql`
          SELECT sport, training_level FROM athlete_scheduling_profiles
          WHERE user_id = ${targetUserId} AND org_id = ${orgId}
          LIMIT 1
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT DISTINCT b.service_id, s.name, s.sport, s.skill_level
          FROM bookings b
          JOIN booking_participants bp ON bp.booking_id = b.id
          JOIN services s ON b.service_id = s.id
          WHERE bp.user_id = ${targetUserId}
            AND b.organization_id = ${orgId}
            AND b.status IN ('CONFIRMED', 'COMPLETED')
            AND b.start_at >= ${sixtyDaysAgo.toISOString()}
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                 s.sport, s.skill_level, s.price_cents, s.age_range,
                 u.first_name as coach_first, u.last_name as coach_last,
                 COUNT(bp.id) as registered_count
          FROM bookings b
          LEFT JOIN services s ON b.service_id = s.id
          LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN booking_participants bp ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status = 'CONFIRMED'
            AND b.start_at > ${now.toISOString()}
            AND b.start_at < ${next14d.toISOString()}
            AND NOT EXISTS (
              SELECT 1 FROM booking_participants bp2
              WHERE bp2.booking_id = b.id AND bp2.user_id = ${targetUserId}
            )
          GROUP BY b.id, s.name, s.sport, s.skill_level, s.price_cents, s.age_range, u.first_name, u.last_name
          HAVING COUNT(bp.id) < b.max_participants
          ORDER BY b.start_at ASC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
      ]);

      const profile = getRows(profileRaw)[0];
      const history = getRows(historyRaw);
      const upcoming = getRows(upcomingRaw);

      const previousSports = new Set(history.map((h: any) => (h.sport || "").toLowerCase()).filter(Boolean));
      const previousServices = new Set(history.map((h: any) => h.service_id).filter(Boolean));

      const scored = upcoming.map((s: any) => {
        let score = 50;
        const reasons: string[] = [];

        if (profile?.sport && s.sport && profile.sport.toLowerCase() === (s.sport || "").toLowerCase()) {
          score += 20;
          reasons.push("Matches your sport");
        } else if (s.sport && previousSports.has((s.sport || "").toLowerCase())) {
          score += 15;
          reasons.push("Sport you've trained in before");
        }

        if (profile?.training_level && s.skill_level &&
            profile.training_level.toLowerCase() === (s.skill_level || "").toLowerCase()) {
          score += 15;
          reasons.push("Matches your skill level");
        }

        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        const fillPct = max > 0 ? reg / max : 0;
        if (fillPct < 0.5) { score += 10; reasons.push("Spots available"); }
        if (fillPct >= 0.7) { score += 5; reasons.push("Popular session"); }

        if (previousServices.has(s.service_id)) {
          score += 10;
          reasons.push("Session type you've attended");
        }

        return {
          sessionId: s.id,
          serviceName: s.service_name || "Session",
          sport: s.sport,
          skillLevel: s.skill_level,
          startAt: s.start_at,
          coach: `${s.coach_first || ""} ${s.coach_last || ""}`.trim(),
          registered: parseInt(s.registered_count || 0),
          capacity: max,
          openSpots: max - parseInt(s.registered_count || 0),
          priceCents: parseInt(s.price_cents || 0),
          matchScore: Math.min(100, score),
          matchReasons: reasons,
        };
      }).sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);

      res.json({
        recommendations: scored,
        hasProfile: !!profile,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch athlete recommendations", error: e.message });
    }
  });

  // ─── Persist fill campaign draft ──────────────────────────────────────────
  app.post("/api/scheduling-intelligence/fill-campaign/save", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });
      const { sessionId, subject, emailBody, smsBody, targetCount } = req.body;
      await db.execute(sql`
        INSERT INTO fill_campaign_drafts (org_id, booking_id, subject, body, target_count, status)
        VALUES (${orgId}, ${sessionId}, ${subject}, ${emailBody || smsBody}, ${targetCount || 0}, 'draft')
      `).catch(() => {});
      res.json({ saved: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to save campaign draft", error: e.message });
    }
  });

  // ─── Snapshot health score ────────────────────────────────────────────────
  app.post("/api/scheduling-intelligence/health-score/snapshot", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any)._authProfile?.orgId;
      if (!orgId) return res.status(403).json({ message: "No org" });
      const { score, label, summary, breakdown } = req.body;
      await db.execute(sql`
        INSERT INTO scheduling_health_snapshots (org_id, score, utilization_score, revenue_score, attendance_score, retention_score, waitlist_score, label, summary)
        VALUES (${orgId}, ${score}, ${breakdown?.utilization ?? 0}, ${breakdown?.revenue ?? 0}, ${breakdown?.attendance ?? 0}, ${breakdown?.retention ?? 0}, ${breakdown?.waitlist ?? 0}, ${label}, ${summary})
      `).catch(() => {});
      res.json({ saved: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to snapshot health score", error: e.message });
    }
  });

  // ─── AI Scheduling Copilot ────────────────────────────────────────────────

  /**
   * Extract a coach name from the user's question using common patterns.
   * Returns the matched name string, or null if no specific coach is referenced.
   */
  function extractCoachNameFromQuestion(question: string): string | null {
    const patterns = [
      /show\s+me\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'s?\s+schedule/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'s?\s+schedule/i,
      /schedule\s+(?:for|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /what(?:'s|\s+is|\s+does)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:'s?\s+schedule|\s+have|\s+scheduled)/i,
      /(?:for|show|pull up|get)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:schedule|sessions|bookings|calendar)/i,
    ];
    for (const pattern of patterns) {
      const match = question.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  }

  /**
   * Fuzzy-match a name string against a list of coaches.
   * Returns all coaches whose full name contains any word from the query, or
   * whose first or last name matches any word from the query.
   */
  function matchCoaches(
    requestedName: string,
    coaches: Array<{ coach_profile_id: string; first_name: string; last_name: string }>
  ) {
    const queryWords = requestedName.toLowerCase().split(/\s+/).filter(Boolean);
    return coaches.filter((c) => {
      const fullName = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
      return queryWords.every((word) => fullName.includes(word));
    });
  }

  app.post("/api/scheduling-intelligence/copilot", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    console.log("[copilot] route entered");
    try {
      const authProfile = (req as any)._authProfile;
      console.log("[copilot] auth passed — userId:", authProfile?.userId, "orgId:", authProfile?.orgId, "role:", authProfile?.role);
      if (!authProfile?.orgId) {
        console.log("[copilot] BLOCKED: no orgId in _authProfile");
        return res.status(403).json({ message: "No org" });
      }
      const { orgId } = authProfile;

      const { question, conversationHistory } = req.body;
      console.log("[copilot] payload keys:", Object.keys(req.body), "question length:", question?.length ?? 0);
      if (!question) return res.status(400).json({ message: "Question required" });

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);

      // ── Step 1: Resolve coach scope ──────────────────────────────────────
      // Fetch all coaches for this org so we can match by name.
      const allCoachesRaw = await db.execute(sql`
        SELECT cp.id as coach_profile_id, u.first_name, u.last_name
        FROM coach_profiles cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.organization_id = ${orgId}
        ORDER BY u.last_name, u.first_name
      `).catch(() => ({ rows: [] }));
      const allCoaches = getRows(allCoachesRaw) as Array<{ coach_profile_id: string; first_name: string; last_name: string }>;

      const requestedName = extractCoachNameFromQuestion(question);
      let filteredCoachProfileId: string | null = null;
      let coachScopeLabel = "all coaches";

      if (requestedName) {
        const matches = matchCoaches(requestedName, allCoaches);
        console.log(`[copilot] coach name detected: "${requestedName}", matches: ${matches.length}`);

        if (matches.length === 0) {
          const coachList = allCoaches.length
            ? allCoaches.map((c) => `${c.first_name} ${c.last_name}`).join(", ")
            : "none on record";
          return res.json({
            answer: `I couldn't find a coach named "${requestedName}" in your organization. Available coaches are: ${coachList}. Could you clarify which coach you're looking for?`,
            question,
            supportingData: {
              sessionsThisWeek: 0, cancellationsThisWeek: 0, sessions30Days: 0,
              upcomingSessions: [], recentClients: [], generatedAt: now.toISOString(),
            },
          });
        }

        if (matches.length > 1) {
          const nameList = matches.map((c) => `${c.first_name} ${c.last_name}`).join(", ");
          return res.json({
            answer: `I found multiple coaches matching "${requestedName}": ${nameList}. Could you use their full name so I can show the right schedule?`,
            question,
            supportingData: {
              sessionsThisWeek: 0, cancellationsThisWeek: 0, sessions30Days: 0,
              upcomingSessions: [], recentClients: [], generatedAt: now.toISOString(),
            },
          });
        }

        filteredCoachProfileId = matches[0].coach_profile_id;
        coachScopeLabel = `${matches[0].first_name} ${matches[0].last_name}`;
        console.log(`[copilot] resolved coach scope → ${coachScopeLabel} (profileId: ${filteredCoachProfileId})`);
      }

      // ── Step 2: Fetch scheduling context (coach-scoped if applicable) ────
      console.log("[copilot] fetching scheduling context from DB");
      const [statsRaw, upcomingRaw, recentRaw] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('CONFIRMED','COMPLETED') AND start_at >= ${weekStart.toISOString()} AND start_at <= ${weekEnd.toISOString()}) as sessions_this_week,
            COUNT(*) FILTER (WHERE status = 'CANCELLED' AND start_at >= ${weekStart.toISOString()}) as cancellations_this_week,
            COUNT(*) FILTER (WHERE status IN ('CONFIRMED','COMPLETED') AND start_at >= ${thirtyDaysAgo.toISOString()}) as sessions_30d
          FROM bookings WHERE organization_id = ${orgId}
        `).catch((err: any) => { console.log("[copilot] stats query failed:", err?.message); return { rows: [{}] }; }),

        // Upcoming sessions — strictly filtered by coach_id when a specific coach was requested.
        filteredCoachProfileId
          ? db.execute(sql`
              SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                     u.first_name as coach_first, u.last_name as coach_last,
                     COUNT(bp.id) as registered
              FROM bookings b
              LEFT JOIN services s ON b.service_id = s.id
              LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
              LEFT JOIN users u ON cp.user_id = u.id
              LEFT JOIN booking_participants bp ON bp.booking_id = b.id
              WHERE b.organization_id = ${orgId}
                AND b.coach_id = ${filteredCoachProfileId}
                AND b.status = 'CONFIRMED'
                AND b.start_at > ${now.toISOString()}
                AND b.start_at < ${new Date(now.getTime() + 7 * 86400000).toISOString()}
              GROUP BY b.id, s.name, u.first_name, u.last_name
              ORDER BY b.start_at ASC
              LIMIT 20
            `).catch((err: any) => { console.log("[copilot] upcoming (coach) query failed:", err?.message); return { rows: [] }; })
          : db.execute(sql`
              SELECT b.id, b.start_at, b.max_participants, s.name as service_name,
                     u.first_name as coach_first, u.last_name as coach_last,
                     COUNT(bp.id) as registered
              FROM bookings b
              LEFT JOIN services s ON b.service_id = s.id
              LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
              LEFT JOIN users u ON cp.user_id = u.id
              LEFT JOIN booking_participants bp ON bp.booking_id = b.id
              WHERE b.organization_id = ${orgId}
                AND b.status = 'CONFIRMED'
                AND b.start_at > ${now.toISOString()}
                AND b.start_at < ${new Date(now.getTime() + 7 * 86400000).toISOString()}
              GROUP BY b.id, s.name, u.first_name, u.last_name
              ORDER BY b.start_at ASC
              LIMIT 10
            `).catch((err: any) => { console.log("[copilot] upcoming query failed:", err?.message); return { rows: [] }; }),

        db.execute(sql`
          SELECT u.first_name, u.last_name, MAX(b.start_at) as last_booking,
                 COUNT(b.id) as total_bookings
          FROM users u
          JOIN booking_participants bp ON bp.user_id = u.id
          JOIN bookings b ON bp.booking_id = b.id
          WHERE b.organization_id = ${orgId}
            AND b.status IN ('CONFIRMED','COMPLETED')
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY MAX(b.start_at) DESC
          LIMIT 10
        `).catch((err: any) => { console.log("[copilot] recent clients query failed:", err?.message); return { rows: [] }; }),
      ]);
      console.log("[copilot] scheduling context OK");

      const stats = getRows(statsRaw)[0] || {};
      const upcoming = getRows(upcomingRaw);
      const recent = getRows(recentRaw);

      const contextData = {
        currentDate: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        coachScope: coachScopeLabel,
        sessionsThisWeek: parseInt(stats.sessions_this_week || 0),
        cancellationsThisWeek: parseInt(stats.cancellations_this_week || 0),
        sessions30Days: parseInt(stats.sessions_30d || 0),
        upcomingSessions: upcoming.map((s: any) => ({
          name: s.service_name,
          coach: `${s.coach_first || ""} ${s.coach_last || ""}`.trim(),
          start: s.start_at,
          registered: parseInt(s.registered || 0),
          capacity: parseInt(s.max_participants || 6),
        })),
        recentClients: recent.map((c: any) => ({
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
          lastBooking: c.last_booking,
          totalBookings: parseInt(c.total_bookings || 0),
        })),
      };

      const coachScopeNote = filteredCoachProfileId
        ? `IMPORTANT: The upcomingSessions list has been pre-filtered to ONLY include sessions for ${coachScopeLabel}. Do NOT mention or include any other coaches in your answer.`
        : `The upcomingSessions list includes sessions across all coaches. Group by coach where helpful.`;

      const systemPrompt = `You are an expert scheduling intelligence assistant for a strength and conditioning coaching business. You have access to live scheduling data.

${coachScopeNote}

Current Data Context:
${JSON.stringify(contextData, null, 2)}

Answer questions about scheduling, utilization, revenue opportunities, client activity, and coaching operations. Be specific with numbers from the data. Keep answers concise (under 200 words). If you don't have enough data to answer precisely, say so and give your best guidance.`;

      const messages: any[] = [
        { role: "system", content: systemPrompt },
      ];

      if (Array.isArray(conversationHistory)) {
        conversationHistory.slice(-6).forEach((m: any) => {
          if (m.role === "user" || m.role === "assistant") {
            messages.push({ role: m.role, content: m.content });
          }
        });
      }

      messages.push({ role: "user", content: question });

      console.log("[copilot] calling OpenAI model=gpt-4o-mini messages=", messages.length, "coachScope:", coachScopeLabel);
      let completion: any;
      try {
        completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 500,
        });
        console.log("[copilot] OpenAI call succeeded");
      } catch (openaiErr: any) {
        console.error("[copilot] OpenAI call FAILED:", openaiErr?.status, openaiErr?.message, openaiErr?.code);
        return res.status(500).json({
          message: "OpenAI call failed",
          error: openaiErr?.message,
          code: openaiErr?.code,
          status: openaiErr?.status,
        });
      }

      const answer = completion.choices[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
      console.log("[copilot] responding OK answer length:", answer.length);

      res.json({
        answer,
        question,
        supportingData: {
          sessionsThisWeek: contextData.sessionsThisWeek,
          cancellationsThisWeek: contextData.cancellationsThisWeek,
          sessions30Days: contextData.sessions30Days,
          upcomingSessions: contextData.upcomingSessions.slice(0, 5),
          recentClients: contextData.recentClients.slice(0, 5),
          generatedAt: now.toISOString(),
        },
      });
    } catch (e: any) {
      console.error("[copilot] unexpected error:", e?.message, e?.stack?.split("\n")[1]);
      res.status(500).json({ message: "Failed to get copilot response", error: e.message });
    }
  });

  // ─── Contract Alias Routes ─────────────────────────────────────────────────
  // These aliases ensure the API contract names are supported alongside the
  // implementation names, without duplicating handler logic.

  // performance-score is the contract name for session-performance
  app.get("/api/scheduling-intelligence/performance-score/:bookingId", isAuthenticated, privilegedOnly, async (req: Request, res: Response) => {
    req.url = req.url.replace("/performance-score/", "/session-performance/");
    res.redirect(307, `/api/scheduling-intelligence/session-performance/${req.params.bookingId}`);
  });

  // coach-utilization-intelligence is the contract name for utilization-intelligence
  app.get("/api/scheduling-intelligence/coach-utilization-intelligence", isAuthenticated, privilegedOnly, (req: Request, res: Response) => {
    res.redirect(307, "/api/scheduling-intelligence/utilization-intelligence" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""));
  });
}
