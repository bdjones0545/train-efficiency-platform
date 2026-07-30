/**
 * retention-context-service.ts — Builds the retention analysis context payload
 * sent to Kevin for the Retention Agent.
 *
 * Only includes data necessary for retention analysis.
 * Never sends raw credentials, secrets, or unrelated org data.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface ClientProfile {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  joinedAt: string | null;
}

export interface AttendanceSummary {
  totalBookings: number;
  attendedCount: number;
  cancelledCount: number;
  noShowCount: number;
  attendanceRate: number;
  last30DaysBookings: number;
  last30DaysAttended: number;
  last90DaysBookings: number;
  last90DaysAttended: number;
  daysSinceLastAttended: number | null;
}

export interface UpcomingSession {
  bookingId: string;
  scheduledAt: string;
  serviceType: string | null;
}

export interface EngagementSignals {
  accountAgedays: number;
  hasUpcomingSessions: boolean;
  upcomingSessionCount: number;
}

export interface PaymentSignals {
  hasActiveSubscription: boolean;
  subscriptionStatus: string | null;
  subscriptionPlanName: string | null;
  totalLifetimeCents: number;
}

export interface RetentionContext {
  clientProfile: ClientProfile;
  attendanceSummary: AttendanceSummary;
  upcomingSessions: UpcomingSession[];
  engagementSignals: EngagementSignals;
  paymentSignals: PaymentSignals;
}

/**
 * Builds the retention context for a client.
 * Validates that the client belongs to the given organization.
 * Returns null if the client is not found or doesn't belong to the org.
 */
export async function buildRetentionContext(
  clientId: string,
  organizationId: string,
): Promise<RetentionContext | null> {
  // ── 1. Client profile (with org membership check) ────────────────────────
  const profileRows = await db.execute(sql`
    SELECT
      u.id           AS user_id,
      u.email        AS email,
      COALESCE(u.first_name || ' ' || u.last_name, u.email) AS display_name,
      up.organization_id,
      u.created_at   AS joined_at
    FROM users u
    JOIN user_profiles up ON up.user_id = u.id
    WHERE u.id = ${clientId}
      AND up.organization_id = ${organizationId}
    LIMIT 1
  `);

  const profileData = Array.isArray(profileRows) ? profileRows : (profileRows as any).rows ?? [];
  if (!profileData.length) return null;

  const p = profileData[0];
  const clientProfile: ClientProfile = {
    userId: String(p.user_id),
    email: String(p.email),
    displayName: String(p.display_name),
    organizationId: String(p.organization_id),
    joinedAt: p.joined_at ? new Date(p.joined_at as string).toISOString() : null,
  };

  // ── 2. Attendance summary ─────────────────────────────────────────────────
  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const day90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const attendanceRows = await db.execute(sql`
    SELECT
      COUNT(*)                                                   AS total_bookings,
      COUNT(*) FILTER (WHERE status = 'CONFIRMED')       AS attended_count,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')       AS cancelled_count,
      COUNT(*) FILTER (WHERE status = 'NO_SHOW')         AS no_show_count,
      COUNT(*) FILTER (WHERE start_at >= ${day30})           AS last_30_days,
      COUNT(*) FILTER (WHERE start_at >= ${day30} AND status = 'CONFIRMED') AS last_30_attended,
      COUNT(*) FILTER (WHERE start_at >= ${day90})           AS last_90_days,
      COUNT(*) FILTER (WHERE start_at >= ${day90} AND status = 'CONFIRMED') AS last_90_attended,
      MAX(CASE WHEN status = 'CONFIRMED' THEN start_at END) AS last_attended_at
    FROM bookings
    WHERE client_id = ${clientId}
      AND organization_id = ${organizationId}
  `);

  const atRows = Array.isArray(attendanceRows) ? attendanceRows : (attendanceRows as any).rows ?? [];
  const at = atRows[0] ?? {};

  const total = Number(at.total_bookings ?? 0);
  const attended = Number(at.attended_count ?? 0);
  const lastAttendedAt = at.last_attended_at
    ? new Date(at.last_attended_at as string)
    : null;
  const daysSinceLastAttended = lastAttendedAt
    ? Math.floor((now.getTime() - lastAttendedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const attendanceSummary: AttendanceSummary = {
    totalBookings: total,
    attendedCount: attended,
    cancelledCount: Number(at.cancelled_count ?? 0),
    noShowCount: Number(at.no_show_count ?? 0),
    attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
    last30DaysBookings: Number(at.last_30_days ?? 0),
    last30DaysAttended: Number(at.last_30_attended ?? 0),
    last90DaysBookings: Number(at.last_90_days ?? 0),
    last90DaysAttended: Number(at.last_90_attended ?? 0),
    daysSinceLastAttended,
  };

  // ── 3. Upcoming sessions ──────────────────────────────────────────────────
  const upcomingRows = await db.execute(sql`
    SELECT b.id, b.start_at, s.name AS service_type
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.client_id = ${clientId}
      AND b.organization_id = ${organizationId}
      AND b.start_at > NOW()
      AND b.status = 'CONFIRMED'
    ORDER BY b.start_at ASC
    LIMIT 5
  `);

  const upRows = Array.isArray(upcomingRows) ? upcomingRows : (upcomingRows as any).rows ?? [];
  const upcomingSessions: UpcomingSession[] = upRows.map((r: any) => ({
    bookingId: String(r.id),
    scheduledAt: new Date(r.start_at as string).toISOString(),
    serviceType: r.service_type ? String(r.service_type) : null,
  }));

  // ── 4. Payment signals ────────────────────────────────────────────────────
  const paymentRows = await db.execute(sql`
    SELECT
      us.status,
      sp.name AS plan_name,
      COALESCE(sp.amount_cents, 0) AS lifetime_cents
    FROM user_subscriptions us
    LEFT JOIN organization_subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = ${clientId}
      AND us.organization_id = ${organizationId}
    ORDER BY us.created_at DESC
    LIMIT 1
  `);

  const payRows = Array.isArray(paymentRows) ? paymentRows : (paymentRows as any).rows ?? [];
  const pay = payRows[0] ?? {};

  const paymentSignals: PaymentSignals = {
    hasActiveSubscription: String(pay.status ?? "") === "active",
    subscriptionStatus: pay.status ? String(pay.status) : null,
    subscriptionPlanName: pay.plan_name ? String(pay.plan_name) : null,
    totalLifetimeCents: Number(pay.lifetime_cents ?? 0),
  };

  // ── 5. Engagement signals ─────────────────────────────────────────────────
  const accountAgeMs = clientProfile.joinedAt
    ? now.getTime() - new Date(clientProfile.joinedAt).getTime()
    : 0;

  const engagementSignals: EngagementSignals = {
    accountAgedays: Math.floor(accountAgeMs / (24 * 60 * 60 * 1000)),
    hasUpcomingSessions: upcomingSessions.length > 0,
    upcomingSessionCount: upcomingSessions.length,
  };

  return {
    clientProfile,
    attendanceSummary,
    upcomingSessions,
    engagementSignals,
    paymentSignals,
  };
}
