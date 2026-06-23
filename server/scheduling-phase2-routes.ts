import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

async function initPhase2Tables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS athlete_scheduling_profiles (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) UNIQUE,
      sport VARCHAR DEFAULT '',
      training_level VARCHAR DEFAULT '',
      birth_year INTEGER,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_attendance (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      user_id VARCHAR REFERENCES users(id),
      participant_name VARCHAR,
      status VARCHAR NOT NULL DEFAULT 'present',
      marked_by VARCHAR,
      marked_at TIMESTAMP DEFAULT NOW(),
      notes TEXT DEFAULT '',
      organization_id VARCHAR
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_recurrence_rules (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id VARCHAR REFERENCES bookings(id) ON DELETE CASCADE,
      recurring_group_id VARCHAR,
      organization_id VARCHAR,
      frequency VARCHAR NOT NULL DEFAULT 'weekly',
      days_of_week INTEGER[] DEFAULT '{}',
      end_date DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS waitlist_holds (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id),
      hold_expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_waitlists (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id),
      participant_name VARCHAR,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(booking_id, user_id)
    )
  `);
}

let tablesInitialized = false;
async function ensureTables() {
  if (!tablesInitialized) {
    await initPhase2Tables();
    tablesInitialized = true;
  }
}

function requireRole(...roles: string[]) {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: "Unauthorized" });
    next();
  };
}

export async function registerSchedulingPhase2Routes(app: Express, isAuthenticated: any) {
  await ensureTables();

  // ── Athlete Scheduling Profile ────────────────────────────────────────────

  app.get("/api/scheduling/athlete-profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const result = await db.execute(sql`
        SELECT * FROM athlete_scheduling_profiles WHERE user_id = ${userId}
      `);
      const r = rows(result);
      res.json(r[0] || { userId, sport: "", trainingLevel: "", birthYear: null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/scheduling/athlete-profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const { sport, trainingLevel, birthYear } = req.body;
      await db.execute(sql`
        INSERT INTO athlete_scheduling_profiles (user_id, sport, training_level, birth_year)
        VALUES (${userId}, ${sport || ""}, ${trainingLevel || ""}, ${birthYear || null})
        ON CONFLICT (user_id) DO UPDATE SET
          sport = EXCLUDED.sport,
          training_level = EXCLUDED.training_level,
          birth_year = EXCLUDED.birth_year,
          updated_at = NOW()
      `);
      const result = await db.execute(sql`SELECT * FROM athlete_scheduling_profiles WHERE user_id = ${userId}`);
      res.json(rows(result)[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Session Attendance ────────────────────────────────────────────────────

  app.get("/api/scheduling/attendance/:bookingId", isAuthenticated, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT sa.*, u.first_name, u.last_name, u.profile_image_url
        FROM session_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.booking_id = ${req.params.bookingId}
        ORDER BY sa.marked_at ASC
      `);
      res.json(rows(result));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/scheduling/attendance/:bookingId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const { attendanceRecords } = req.body as {
        attendanceRecords: Array<{ userId?: string; participantName?: string; status: string; notes?: string }>
      };

      if (!attendanceRecords || !Array.isArray(attendanceRecords)) {
        return res.status(400).json({ message: "attendanceRecords array required" });
      }

      const bookingId = req.params.bookingId;
      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Session not found" });

      // Upsert each attendance record
      const saved = [];
      for (const rec of attendanceRecords) {
        if (rec.userId) {
          await db.execute(sql`
            INSERT INTO session_attendance (booking_id, user_id, status, marked_by, notes, organization_id)
            VALUES (${bookingId}, ${rec.userId}, ${rec.status}, ${userId}, ${rec.notes || ""}, ${booking.organizationId || null})
            ON CONFLICT (booking_id, user_id) WHERE user_id IS NOT NULL
            DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
              notes = EXCLUDED.notes, marked_at = NOW()
          `).catch(async () => {
            // Fallback if partial unique index not supported
            await db.execute(sql`
              DELETE FROM session_attendance WHERE booking_id = ${bookingId} AND user_id = ${rec.userId}
            `);
            await db.execute(sql`
              INSERT INTO session_attendance (booking_id, user_id, status, marked_by, notes, organization_id)
              VALUES (${bookingId}, ${rec.userId}, ${rec.status}, ${userId}, ${rec.notes || ""}, ${booking.organizationId || null})
            `);
          });
        } else if (rec.participantName) {
          await db.execute(sql`
            DELETE FROM session_attendance WHERE booking_id = ${bookingId} AND participant_name = ${rec.participantName}
          `);
          await db.execute(sql`
            INSERT INTO session_attendance (booking_id, participant_name, status, marked_by, notes, organization_id)
            VALUES (${bookingId}, ${rec.participantName}, ${rec.status}, ${userId}, ${rec.notes || ""}, ${booking.organizationId || null})
          `);
        }
        saved.push(rec);
      }
      res.json({ saved: saved.length });
    } catch (e: any) {
      console.error("Attendance error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Attendance Stats (per user) ───────────────────────────────────────────

  app.get("/api/scheduling/attendance-stats/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const callerId = req.user.claims?.sub ?? req.user.id;
      const callerProfile = await storage.getUserProfile(callerId);
      const isCoachOrAdmin = callerProfile?.role === "COACH" || callerProfile?.role === "ADMIN";
      if (!isCoachOrAdmin && callerId !== req.params.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const result = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'present') AS present_count,
          COUNT(*) FILTER (WHERE status = 'late') AS late_count,
          COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
          COUNT(*) FILTER (WHERE status = 'excused') AS excused_count,
          COUNT(*) AS total_count
        FROM session_attendance
        WHERE user_id = ${req.params.userId}
      `);
      const r = rows(result)[0] || {};

      const present = parseInt(r.present_count || 0);
      const late = parseInt(r.late_count || 0);
      const absent = parseInt(r.absent_count || 0);
      const excused = parseInt(r.excused_count || 0);
      const total = parseInt(r.total_count || 0);
      const attendedCount = present + late;
      const attendancePct = total > 0 ? Math.round((attendedCount / total) * 100) : null;

      let risk: "Excellent" | "Good" | "At Risk" | "High Risk" | "Insufficient Data";
      if (attendancePct === null) risk = "Insufficient Data";
      else if (attendancePct >= 90) risk = "Excellent";
      else if (attendancePct >= 75) risk = "Good";
      else if (attendancePct >= 50) risk = "At Risk";
      else risk = "High Risk";

      // Consecutive misses (recent sessions)
      const recentResult = await db.execute(sql`
        SELECT status FROM session_attendance
        WHERE user_id = ${req.params.userId}
        ORDER BY marked_at DESC LIMIT 10
      `);
      let consecutiveMisses = 0;
      for (const row of rows(recentResult)) {
        if (row.status === "absent") consecutiveMisses++;
        else break;
      }

      res.json({ present, late, absent, excused, total, attendancePct, risk, consecutiveMisses });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Organization-wide attendance stats ───────────────────────────────────

  app.get("/api/scheduling/attendance-org-stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No org" });
      const orgId = profile.organizationId;

      const result = await db.execute(sql`
        SELECT
          sa.user_id,
          u.first_name,
          u.last_name,
          COUNT(*) FILTER (WHERE sa.status = 'present') AS present_count,
          COUNT(*) FILTER (WHERE sa.status = 'late') AS late_count,
          COUNT(*) FILTER (WHERE sa.status = 'absent') AS absent_count,
          COUNT(*) FILTER (WHERE sa.status = 'excused') AS excused_count,
          COUNT(*) AS total_count
        FROM session_attendance sa
        LEFT JOIN users u ON sa.user_id = u.id
        WHERE sa.organization_id = ${orgId} AND sa.user_id IS NOT NULL
        GROUP BY sa.user_id, u.first_name, u.last_name
        ORDER BY total_count DESC
        LIMIT 50
      `);

      const athletes = rows(result).map(r => {
        const present = parseInt(r.present_count || 0);
        const late = parseInt(r.late_count || 0);
        const absent = parseInt(r.absent_count || 0);
        const excused = parseInt(r.excused_count || 0);
        const total = parseInt(r.total_count || 0);
        const pct = total > 0 ? Math.round(((present + late) / total) * 100) : null;
        let risk = "Insufficient Data";
        if (pct !== null) {
          if (pct >= 90) risk = "Excellent";
          else if (pct >= 75) risk = "Good";
          else if (pct >= 50) risk = "At Risk";
          else risk = "High Risk";
        }
        return { userId: r.user_id, firstName: r.first_name, lastName: r.last_name, present, late, absent, excused, total, attendancePct: pct, risk };
      });

      res.json(athletes);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Coach Capacity Analytics ──────────────────────────────────────────────

  app.get("/api/scheduling/coach-capacity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No org" });
      const orgId = profile.organizationId;

      const { period = "week" } = req.query as { period?: string };
      const now = new Date();
      let startDate: Date;
      let endDate: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

      if (period === "week") {
        const day = now.getDay();
        startDate = new Date(now); startDate.setDate(now.getDate() - day); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6); endDate.setHours(23, 59, 59, 999);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      }

      const result = await db.execute(sql`
        SELECT
          cp.id AS coach_id,
          u.first_name,
          u.last_name,
          cp.photo_url,
          COUNT(b.id) AS session_count,
          SUM(EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 3600.0) AS booked_hours,
          SUM(COALESCE(b.max_participants, 1)) AS total_capacity,
          SUM(bp.participant_count) AS total_registered,
          SUM(
            COALESCE(b.max_participants, 1) - COALESCE(bp.participant_count, 0)
          ) AS open_spots
        FROM coach_profiles cp
        JOIN users u ON cp.user_id = u.id
        LEFT JOIN bookings b ON b.coach_id = cp.id
          AND b.organization_id = ${orgId}
          AND b.start_at >= ${startDate.toISOString()}
          AND b.start_at <= ${endDate.toISOString()}
          AND b.status NOT IN ('CANCELLED')
          AND b.max_participants IS NOT NULL
        LEFT JOIN (
          SELECT booking_id, COUNT(*) AS participant_count
          FROM booking_participants
          GROUP BY booking_id
        ) bp ON bp.booking_id = b.id
        WHERE cp.organization_id = ${orgId} AND cp.is_active = true
        GROUP BY cp.id, u.first_name, u.last_name, cp.photo_url
        ORDER BY booked_hours DESC NULLS LAST
      `);

      // Fetch revenue per coach (sum of registrations * service price)
      const revenueResult = await db.execute(sql`
        SELECT
          b.coach_id,
          SUM(s.price_cents * COALESCE(bp.participant_count, 0)) AS revenue_cents
        FROM bookings b
        JOIN services s ON b.service_id = s.id
        LEFT JOIN (
          SELECT booking_id, COUNT(*) AS participant_count
          FROM booking_participants
          GROUP BY booking_id
        ) bp ON bp.booking_id = b.id
        WHERE b.organization_id = ${orgId}
          AND b.start_at >= ${startDate.toISOString()}
          AND b.start_at <= ${endDate.toISOString()}
          AND b.status NOT IN ('CANCELLED')
          AND b.max_participants IS NOT NULL
        GROUP BY b.coach_id
      `);

      const revenueByCoach = new Map<string, number>();
      rows(revenueResult).forEach((r: any) => {
        revenueByCoach.set(r.coach_id, parseInt(r.revenue_cents || 0));
      });

      const availableHoursPerPeriod = period === "week" ? 40 : 160;

      const coaches = rows(result).map((r: any) => {
        const bookedHours = parseFloat(r.booked_hours || 0);
        const utilizationPct = availableHoursPerPeriod > 0 ? Math.round((bookedHours / availableHoursPerPeriod) * 100) : 0;
        const revenueCents = revenueByCoach.get(r.coach_id) || 0;
        return {
          coachId: r.coach_id,
          firstName: r.first_name,
          lastName: r.last_name,
          photoUrl: r.photo_url,
          sessionCount: parseInt(r.session_count || 0),
          bookedHours: Math.round(bookedHours * 10) / 10,
          availableHours: availableHoursPerPeriod,
          utilizationPct,
          openSpots: parseInt(r.open_spots || 0),
          totalCapacity: parseInt(r.total_capacity || 0),
          totalRegistered: parseInt(r.total_registered || 0),
          revenueCents,
        };
      });

      res.json({ coaches, period, startDate, endDate });
    } catch (e: any) {
      console.error("Coach capacity error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Scheduling Command Center ─────────────────────────────────────────────

  app.get("/api/scheduling/command-center", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No org" });
      const orgId = profile.organizationId;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(todayStart.getDate() + 1);
      const tomorrowEnd = new Date(todayEnd); tomorrowEnd.setDate(todayEnd.getDate() + 1);
      const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - now.getDay());
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      // Fetch all group sessions for this org (open/upcoming)
      const allSessionsResult = await db.execute(sql`
        SELECT
          b.*,
          s.name AS service_name,
          s.price_cents,
          s.description AS service_description,
          u.first_name AS coach_first,
          u.last_name AS coach_last,
          cp.photo_url AS coach_photo,
          COALESCE(bp.participant_count, 0) AS registered_count
        FROM bookings b
        LEFT JOIN services s ON b.service_id = s.id
        LEFT JOIN coach_profiles cp ON b.coach_id = cp.id
        LEFT JOIN users u ON cp.user_id = u.id
        LEFT JOIN (
          SELECT booking_id, COUNT(*) AS participant_count
          FROM booking_participants
          GROUP BY booking_id
        ) bp ON bp.booking_id = b.id
        WHERE b.organization_id = ${orgId}
          AND b.max_participants IS NOT NULL
          AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
        ORDER BY b.start_at ASC
      `);

      const all = rows(allSessionsResult);

      const todaySessions = all.filter((s: any) => {
        const d = new Date(s.start_at);
        return d >= todayStart && d <= todayEnd;
      });

      const tomorrowSessions = all.filter((s: any) => {
        const d = new Date(s.start_at);
        return d >= tomorrowStart && d <= tomorrowEnd;
      });

      const openSessions = all.filter((s: any) => {
        const reg = parseInt(s.registered_count || 0);
        const max = parseInt(s.max_participants || 6);
        const d = new Date(s.start_at);
        return reg < max && d >= now;
      });

      const fullSessions = all.filter((s: any) => {
        const reg = parseInt(s.registered_count || 0);
        const max = parseInt(s.max_participants || 6);
        return reg >= max;
      });

      // Sessions with waitlist entries
      const waitlistResult = await db.execute(sql`
        SELECT sw.booking_id, COUNT(*) AS wait_count
        FROM session_waitlists sw
        JOIN bookings b ON sw.booking_id = b.id
        WHERE b.organization_id = ${orgId}
        GROUP BY sw.booking_id
      `);
      const waitlistCounts = new Map<string, number>();
      rows(waitlistResult).forEach((r: any) => waitlistCounts.set(r.booking_id, parseInt(r.wait_count)));

      const waitlistedSessions = all
        .filter((s: any) => waitlistCounts.has(s.id))
        .map((s: any) => ({ ...s, waitlistCount: waitlistCounts.get(s.id) }));

      // Revenue calculations
      const calcRevenue = (sessions: any[]) => sessions.reduce((sum: number, s: any) => {
        return sum + (parseInt(s.price_cents || 0) * parseInt(s.registered_count || 0));
      }, 0);

      const weekRevenue = calcRevenue(all.filter((s: any) => {
        const d = new Date(s.start_at);
        return d >= weekStart && d <= weekEnd;
      }));

      const monthRevenue = calcRevenue(all.filter((s: any) => {
        const d = new Date(s.start_at);
        return d >= monthStart && d <= monthEnd;
      }));

      // Week projection (extrapolate from current pace)
      const daysElapsed = now.getDay() + 1; // 1-7
      const weekProjection = daysElapsed > 0 ? Math.round((weekRevenue / daysElapsed) * 7) : weekRevenue;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dayOfMonth = now.getDate();
      const monthProjection = dayOfMonth > 0 ? Math.round((monthRevenue / dayOfMonth) * daysInMonth) : monthRevenue;

      // Highest revenue sessions (upcoming)
      const highestRevenueSessions = [...all]
        .filter((s: any) => new Date(s.start_at) >= now)
        .map((s: any) => ({
          ...s,
          sessionRevenue: parseInt(s.price_cents || 0) * parseInt(s.registered_count || 0),
          maxRevenue: parseInt(s.price_cents || 0) * parseInt(s.max_participants || 6),
          utilizationPct: parseInt(s.max_participants || 6) > 0
            ? Math.round((parseInt(s.registered_count || 0) / parseInt(s.max_participants || 6)) * 100)
            : 0,
        }))
        .sort((a: any, b: any) => b.sessionRevenue - a.sessionRevenue)
        .slice(0, 5);

      // Lowest utilization (upcoming, with at least 1 capacity)
      const lowestUtilizationSessions = [...all]
        .filter((s: any) => new Date(s.start_at) >= now && parseInt(s.max_participants || 0) > 0)
        .map((s: any) => ({
          ...s,
          utilizationPct: Math.round((parseInt(s.registered_count || 0) / parseInt(s.max_participants || 6)) * 100),
        }))
        .sort((a: any, b: any) => a.utilizationPct - b.utilizationPct)
        .slice(0, 5);

      // Coach utilization summary
      const coachUtilResult = await db.execute(sql`
        SELECT
          u.first_name,
          u.last_name,
          cp.id AS coach_id,
          COUNT(b.id) AS session_count,
          SUM(EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 3600.0) AS booked_hours
        FROM coach_profiles cp
        JOIN users u ON cp.user_id = u.id
        LEFT JOIN bookings b ON b.coach_id = cp.id
          AND b.organization_id = ${orgId}
          AND b.start_at >= ${weekStart.toISOString()}
          AND b.start_at <= ${weekEnd.toISOString()}
          AND b.status NOT IN ('CANCELLED')
          AND b.max_participants IS NOT NULL
        WHERE cp.organization_id = ${orgId} AND cp.is_active = true
        GROUP BY cp.id, u.first_name, u.last_name
        ORDER BY booked_hours DESC NULLS LAST
        LIMIT 10
      `);

      const coachUtilization = rows(coachUtilResult).map((r: any) => ({
        coachId: r.coach_id,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        sessionCount: parseInt(r.session_count || 0),
        bookedHours: Math.round(parseFloat(r.booked_hours || 0) * 10) / 10,
        utilizationPct: Math.round((parseFloat(r.booked_hours || 0) / 40) * 100),
      }));

      res.json({
        todaySessions: todaySessions.length,
        tomorrowSessions: tomorrowSessions.length,
        todaySessionList: todaySessions.slice(0, 10),
        tomorrowSessionList: tomorrowSessions.slice(0, 10),
        openSessionsCount: openSessions.length,
        fullSessionsCount: fullSessions.length,
        waitlistedSessionsCount: waitlistedSessions.length,
        waitlistedSessions: waitlistedSessions.slice(0, 5),
        highestRevenueSessions,
        lowestUtilizationSessions,
        coachUtilization,
        weekRevenueCents: weekRevenue,
        monthRevenueCents: monthRevenue,
        weekProjectionCents: weekProjection,
        monthProjectionCents: monthProjection,
        totalUpcomingSessions: openSessions.length + fullSessions.length,
      });
    } catch (e: any) {
      console.error("[CommandCenter] /api/scheduling/command-center failed", {
        userId: req.user?.claims?.sub ?? req.user?.id ?? "unknown",
        error: e.message,
        code: e.code,
      });
      res.status(500).json({ message: e.message, endpoint: "/api/scheduling/command-center" });
    }
  });

  // ── Session Revenue Stats ─────────────────────────────────────────────────

  app.get("/api/scheduling/session-revenue/:bookingId", isAuthenticated, async (req: any, res) => {
    try {
      const booking = await storage.getBooking(req.params.bookingId);
      if (!booking) return res.status(404).json({ message: "Not found" });

      const participants = await storage.getBookingParticipants(req.params.bookingId);
      const service = await storage.getService(booking.serviceId);
      const priceCents = service?.priceCents || 0;
      const capacity = booking.maxParticipants || 6;
      const registered = participants.length;
      const revenueCents = priceCents * registered;
      const maxRevenueCents = priceCents * capacity;
      const utilizationPct = capacity > 0 ? Math.round((registered / capacity) * 100) : 0;

      let utilizationColor: "green" | "yellow" | "red";
      if (utilizationPct >= 80) utilizationColor = "green";
      else if (utilizationPct >= 50) utilizationColor = "yellow";
      else utilizationColor = "red";

      res.json({ capacity, registered, revenueCents, maxRevenueCents, utilizationPct, utilizationColor, priceCents });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Recurrence Rules ──────────────────────────────────────────────────────

  app.post("/api/scheduling/recurrence-rules", isAuthenticated, async (req: any, res) => {
    try {
      const { bookingId, recurringGroupId, frequency, daysOfWeek, endDate, organizationId } = req.body;
      const result = await db.execute(sql`
        INSERT INTO session_recurrence_rules
          (booking_id, recurring_group_id, frequency, days_of_week, end_date, organization_id)
        VALUES
          (${bookingId || null}, ${recurringGroupId || null}, ${frequency || "weekly"},
           ${daysOfWeek ? JSON.stringify(daysOfWeek) : "{}"}::integer[],
           ${endDate || null}, ${organizationId || null})
        RETURNING *
      `);
      res.json(rows(result)[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/scheduling/recurrence-rules/:bookingId", isAuthenticated, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT * FROM session_recurrence_rules
        WHERE booking_id = ${req.params.bookingId}
           OR recurring_group_id = (
             SELECT recurring_group_id FROM bookings WHERE id = ${req.params.bookingId}
           )
        LIMIT 1
      `);
      res.json(rows(result)[0] || null);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
