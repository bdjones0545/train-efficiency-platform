import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getRows(result: any): any[] {
  return Array.isArray(result) ? result : ((result as any)?.rows ?? []);
}

export async function registerSchedulingIntelligenceRoutes(
  app: Express,
  isAuthenticated: any
) {
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

  // ─── Health Score ─────────────────────────────────────────────────────────
  app.get("/api/scheduling/health-score", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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

      const label = overallScore >= 90 ? "Elite" :
                    overallScore >= 75 ? "Strong" :
                    overallScore >= 60 ? "Moderate" : "Needs Attention";

      const summary = overallScore >= 90
        ? "Your scheduling operation is running at peak performance."
        : overallScore >= 75
        ? "Strong performance with minor opportunities to optimize."
        : overallScore >= 60
        ? "Moderate health — several opportunities to improve fill rates and revenue."
        : "Scheduling needs attention — low utilization and revenue gaps detected.";

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
  app.get("/api/scheduling/session-performance/:bookingId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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

      const label = score >= 90 ? "Elite" : score >= 75 ? "Strong" : score >= 60 ? "Moderate" : "Needs Attention";
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
  app.get("/api/scheduling/opportunities", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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

      lowFill.forEach((s: any) => {
        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        const price = parseInt(s.price_cents || 0);
        const openSpots = max - reg;
        const estimatedValue = openSpots * price;
        const start = new Date(s.start_at);
        const daysUntil = Math.ceil((start.getTime() - now.getTime()) / 86400000);
        opportunities.push({
          id: `fill-${s.id}`,
          type: "fill_session",
          priority: daysUntil <= 2 ? "high" : daysUntil <= 5 ? "medium" : "low",
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
        const daysUntil = Math.ceil((start.getTime() - now.getTime()) / 86400000);
        opportunities.push({
          id: `cancel-${s.id}`,
          type: "recover_cancellation",
          priority: "high",
          title: `Recover cancelled ${s.service_name || "session"}`,
          description: `Slot opened up ${daysUntil === 0 ? "today" : `in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`} — consider backfilling from waitlist or inactive clients`,
          estimatedValueCents: max * price,
          actionLabel: "Find Replacement",
          sessionId: s.id,
          sessionStart: s.start_at,
        });
      });

      waitlistSessions.forEach((s: any) => {
        const wCount = parseInt(s.waitlist_count || 0);
        const max = parseInt(s.max_participants || 6);
        const reg = parseInt(s.registered_count || 0);
        opportunities.push({
          id: `waitlist-${s.booking_id}`,
          type: "waitlist_demand",
          priority: wCount >= 3 ? "high" : "medium",
          title: `${wCount} athlete${wCount !== 1 ? "s" : ""} waiting for ${s.service_name || "session"}`,
          description: `Session is at ${reg}/${max} capacity with active demand — consider adding another session`,
          estimatedValueCents: 0,
          actionLabel: "Add Session",
          sessionId: s.booking_id,
          waitlistCount: wCount,
        });
      });

      inactive.forEach((client: any) => {
        const lastBooking = new Date(client.last_booking);
        const daysInactive = Math.floor((now.getTime() - lastBooking.getTime()) / 86400000);
        opportunities.push({
          id: `reactivate-${client.id}`,
          type: "reactivation",
          priority: daysInactive >= 60 ? "high" : "medium",
          title: `Reactivate ${client.first_name || ""} ${client.last_name || ""}`,
          description: `${daysInactive} days since last booking · ${client.total_bookings} total sessions`,
          estimatedValueCents: 7000,
          actionLabel: "Send Outreach",
          clientId: client.id,
          daysInactive,
        });
      });

      opportunities.sort((a, b) => {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
      });

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
          high: opportunities.filter(o => o.priority === "high").length,
          medium: opportunities.filter(o => o.priority === "medium").length,
          low: opportunities.filter(o => o.priority === "low").length,
          byType: {
            fill_session: opportunities.filter(o => o.type === "fill_session").length,
            recover_cancellation: opportunities.filter(o => o.type === "recover_cancellation").length,
            waitlist_demand: opportunities.filter(o => o.type === "waitlist_demand").length,
            reactivation: opportunities.filter(o => o.type === "reactivation").length,
          },
        },
        estimatedTotalValueCents: opportunities.reduce((s, o) => s + (o.estimatedValueCents || 0), 0),
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch opportunities", error: e.message });
    }
  });

  // ─── Revenue Recovery (72h focus + AI recommendations) ────────────────────
  app.get("/api/scheduling/revenue-recovery", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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

      // AI recommendations for urgent (72h) sessions
      let urgentRecommendations: any[] = [];
      if (urgent.length > 0) {
        try {
          const urgentList = urgent.map((s: any) => {
            const max = parseInt(s.max_participants || 6);
            const reg = parseInt(s.registered_count || 0);
            return `- "${s.service_name || "Session"}" at ${new Date(s.start_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — ${reg}/${max} registered (${max - reg} open spots), Coach ${s.coach_first || ""} ${s.coach_last || ""}`.trim();
          }).join("\n");

          const aiRes = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
              role: "user",
              content: `You are a scheduling revenue specialist for a strength and conditioning gym called "${orgName}". The following group training sessions are under 50% full and start within the next 72 hours:\n\n${urgentList}\n\nProvide 3-5 specific, actionable recovery recommendations to fill these sessions. Each recommendation should be a concrete action (e.g., "Text the waitlist...", "Offer a 24-hour early-bird discount...", "Post a flash offer on social media..."). Return a JSON array of objects: [{ "action": "...", "rationale": "...", "impact": "high|medium|low" }]`,
            }],
            response_format: { type: "json_object" },
            max_tokens: 400,
          });
          const content = aiRes.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(content);
          urgentRecommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations
            : Array.isArray(parsed) ? parsed : [];
        } catch {
          urgentRecommendations = [
            { action: "Text everyone on your waitlist immediately about open spots", rationale: "Fastest way to fill seats in under 72h", impact: "high" },
            { action: "Post a flash discount offer on social media (10-20% off)", rationale: "Creates urgency and attracts price-sensitive prospects", impact: "high" },
            { action: "Email inactive clients who previously attended this session type", rationale: "Familiar sessions have higher conversion rates", impact: "medium" },
          ];
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
        gaps: gaps.slice(0, 10),
        cancelled: cancelledGaps,
        urgentRecommendations,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch revenue recovery", error: e.message });
    }
  });

  // ─── Retention Risk ───────────────────────────────────────────────────────
  app.get("/api/scheduling/retention-risk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
  app.get("/api/scheduling/demand-forecast/:bookingId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
  app.get("/api/scheduling/demand-forecast", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
  app.get("/api/scheduling/utilization-intelligence", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
        let status: "optimal" | "underutilized" | "overloaded" | "inactive" = "optimal";

        if (sessionsWeek === 0 && sessions30d === 0) {
          status = "inactive";
          recommendations.push("No sessions recorded in 30 days. Verify coach is active and has availability blocks set.");
        } else if (sessionsWeek <= 2 && sessions30d > 0) {
          status = "underutilized";
          recommendations.push("Low weekly volume — run a fill campaign for open slots.");
          recommendations.push("Consider assigning additional semi-private or group sessions.");
          if (sessions30d < 8) recommendations.push("Reach out to inactive clients from this coach's roster.");
        } else if (sessionsWeek >= 15) {
          status = "overloaded";
          recommendations.push("High session count — monitor for signs of burnout.");
          recommendations.push("Consider capping new bookings and redistributing to other coaches.");
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

  // ─── Fill Campaign Generator (AI) ─────────────────────────────────────────
  app.post("/api/scheduling/fill-campaign", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const { sessionId, sessionName, startAt, openSpots, coachName, orgName } = req.body;

      const start = startAt ? new Date(startAt) : new Date();
      const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const timeStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      const prompt = `You are a fitness business outreach specialist. Write a short, compelling fill-campaign message to re-engage clients for an open group training session.

Session: ${sessionName || "Group Training Session"}
Date: ${dateStr} at ${timeStr}
Open spots: ${openSpots || "a few"}
Coach: ${coachName || "your coach"}
Gym/Studio: ${orgName || "our studio"}

Write:
1. A compelling subject line (max 8 words)
2. A short SMS-style body (2-3 sentences, max 80 words, personal, urgent but not pushy)
3. An email body (3-4 sentences, max 150 words, friendly, creates urgency around limited spots)

Return as JSON:
{
  "subject": "...",
  "smsBody": "...",
  "emailBody": "..."
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 400,
      });

      const content = completion.choices[0]?.message?.content ?? "{}";
      let draft: any;
      try {
        draft = JSON.parse(content);
      } catch {
        draft = { subject: "Spots available this week!", smsBody: "Hey! A spot just opened in your session. Grab it before it's gone.", emailBody: "We have a spot available in your upcoming training session. Don't miss this opportunity — spaces fill fast!" };
      }

      if (sessionId) {
        await db.execute(sql`
          INSERT INTO fill_campaign_drafts (org_id, booking_id, subject, body, target_count, status)
          VALUES (${orgId}, ${sessionId}, ${draft.subject || ""}, ${draft.emailBody || draft.smsBody || ""}, ${openSpots || 0}, 'draft')
        `).catch(() => {});
      }

      res.json({
        sessionId,
        subject: draft.subject || "",
        smsBody: draft.smsBody || "",
        emailBody: draft.emailBody || "",
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to generate fill campaign", error: e.message });
    }
  });

  // ─── Capacity Optimization ────────────────────────────────────────────────
  app.get("/api/scheduling/capacity-optimization", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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

  // ─── Athlete Session Recommendations ──────────────────────────────────────
  app.get("/api/scheduling/athlete-recommendations/:userId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
      const authUserId = (req as any).user?.id;
      const authRole = (req as any).user?.role;
      const { userId } = req.params;
      if (!orgId) return res.status(403).json({ message: "No org" });

      // IDOR guard: non-admin/coach users can only query their own recommendations
      const isPrivileged = authRole === "ADMIN" || authRole === "COACH" || authRole === "STAFF";
      const targetUserId = isPrivileged ? userId : authUserId;
      if (!isPrivileged && userId !== authUserId) {
        return res.status(403).json({ message: "Forbidden" });
      }

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
  app.post("/api/scheduling/fill-campaign/save", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
  app.post("/api/scheduling/health-score/snapshot", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
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
  app.post("/api/scheduling/copilot", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).user?.organizationId;
      if (!orgId) return res.status(403).json({ message: "No org" });

      const { question, conversationHistory } = req.body;
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

      const [statsRaw, upcomingRaw, recentRaw] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('CONFIRMED','COMPLETED') AND start_at >= ${weekStart.toISOString()} AND start_at <= ${weekEnd.toISOString()}) as sessions_this_week,
            COUNT(*) FILTER (WHERE status = 'CANCELLED' AND start_at >= ${weekStart.toISOString()}) as cancellations_this_week,
            COUNT(*) FILTER (WHERE status IN ('CONFIRMED','COMPLETED') AND start_at >= ${thirtyDaysAgo.toISOString()}) as sessions_30d
          FROM bookings WHERE organization_id = ${orgId}
        `).catch(() => ({ rows: [{}] })),
        db.execute(sql`
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
        `).catch(() => ({ rows: [] })),
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
        `).catch(() => ({ rows: [] })),
      ]);

      const stats = getRows(statsRaw)[0] || {};
      const upcoming = getRows(upcomingRaw);
      const recent = getRows(recentRaw);

      const contextData = {
        currentDate: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
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

      const systemPrompt = `You are an expert scheduling intelligence assistant for a strength and conditioning coaching business. You have access to live scheduling data.

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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 500,
      });

      const answer = completion.choices[0]?.message?.content ?? "I couldn't generate a response. Please try again.";

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
      res.status(500).json({ message: "Failed to get copilot response", error: e.message });
    }
  });
}
