import { db } from "../db";
import { bookings, users, userSubscriptions, userProfiles } from "@shared/schema";
import { eq, and, lt, gte, inArray, desc, sql } from "drizzle-orm";
import { subDays, subMonths } from "date-fns";

export interface RetentionSignal {
  signalType: string;
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  metadata: Record<string, unknown>;
}

export interface RetentionRecommendation {
  title: string;
  description: string;
  reason: string;
  entityType: string;
  entityId: string;
  entityName: string;
  severity: "critical" | "high" | "medium" | "low";
  estimatedImpact: number;
  priorityScore: number;
  actionType: string;
  crossAgentTypes: string[];
  metadata: Record<string, unknown>;
}

export interface RetentionAgentResult {
  signals: RetentionSignal[];
  recommendations: RetentionRecommendation[];
  summary: {
    inactiveClients: number;
    churnRisks: number;
    expiringSubscriptions: number;
    cancelledRecently: number;
  };
}

export async function runRetentionAgent(orgId: string): Promise<RetentionAgentResult> {
  const signals: RetentionSignal[] = [];
  const recommendations: RetentionRecommendation[] = [];
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);
  const fourteenDaysAgo = subDays(now, 14);
  const sevenDaysAgo = subDays(now, 7);
  const sixty = subDays(now, 60);

  // --- Get org client IDs (users with CLIENT role in this org) ---
  const clientProfiles = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(and(eq(userProfiles.organizationId, orgId), eq(userProfiles.role, "CLIENT")));

  const clientIds = clientProfiles.map((p) => p.userId);
  if (clientIds.length === 0) {
    return {
      signals,
      recommendations,
      summary: { inactiveClients: 0, churnRisks: 0, expiringSubscriptions: 0, cancelledRecently: 0 },
    };
  }

  // --- Inactive clients (no booking in 30 days) ---
  const recentBookingUserIds = await db
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, thirtyDaysAgo),
        inArray(bookings.clientId, clientIds)
      )
    );
  const activeSet = new Set(recentBookingUserIds.map((r) => r.clientId).filter(Boolean));

  // --- Clients with cancellations in last 14 days ---
  const cancelledBookings = await db
    .select({ clientId: bookings.clientId, startAt: bookings.startAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        eq(bookings.status, "CANCELLED" as any),
        gte(bookings.startAt, fourteenDaysAgo),
        inArray(bookings.clientId, clientIds)
      )
    );
  const cancelledSet = new Set(cancelledBookings.map((r) => r.clientId).filter(Boolean));
  const cancelCountByClient: Record<string, number> = {};
  for (const b of cancelledBookings) {
    if (b.clientId) cancelCountByClient[b.clientId] = (cancelCountByClient[b.clientId] || 0) + 1;
  }

  // --- Expiring subscriptions (next 14 days) ---
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const expiringSubscriptions = await db
    .select()
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "active"),
        lt(userSubscriptions.currentPeriodEnd, in14Days),
        gte(userSubscriptions.currentPeriodEnd, now)
      )
    );

  // --- Get user details for inactive clients ---
  const inactiveClientIds = clientIds.filter((id) => !activeSet.has(id));

  let inactiveUsers: { id: string; firstName: string | null; lastName: string | null; email: string; lastSignInAt: Date | null }[] = [];
  if (inactiveClientIds.length > 0) {
    inactiveUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(inArray(users.id, inactiveClientIds.slice(0, 20)));
  }

  // --- Highly inactive clients (60+ days no booking) ---
  const veryOldBookingUserIds = await db
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, sixty),
        inArray(bookings.clientId, inactiveClientIds.slice(0, 20))
      )
    );
  const somewhatActiveSet = new Set(veryOldBookingUserIds.map((r) => r.clientId).filter(Boolean));

  for (const u of inactiveUsers) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
    const isVeryInactive = !somewhatActiveSet.has(u.id);
    const hasCancellations = cancelledSet.has(u.id);
    const cancelCount = cancelCountByClient[u.id] || 0;

    const severity: "critical" | "high" | "medium" | "low" = isVeryInactive && hasCancellations
      ? "critical"
      : isVeryInactive
      ? "high"
      : hasCancellations
      ? "high"
      : "medium";

    const score = isVeryInactive ? 85 : hasCancellations ? 70 : 55;

    signals.push({
      signalType: "inactive_client",
      entityType: "client",
      entityId: u.id,
      entityName: name,
      title: `${name} is inactive`,
      description: `No bookings in 30+ days${hasCancellations ? ` and ${cancelCount} recent cancellation(s)` : ""}${isVeryInactive ? " — high churn risk" : ""}`,
      severity,
      score,
      metadata: { hasCancellations, cancelCount, isVeryInactive, email: u.email },
    });

    if (severity === "critical" || severity === "high") {
      recommendations.push({
        title: `Re-engage ${name}`,
        description: `Send a personal check-in message. ${isVeryInactive ? "Client has been inactive 60+ days." : "Client missed sessions recently."}`,
        reason: `No bookings in 30+ days${hasCancellations ? ` with ${cancelCount} cancellations` : ""}. Churn risk is ${severity}.`,
        entityType: "client",
        entityId: u.id,
        entityName: name,
        severity,
        estimatedImpact: 15000,
        priorityScore: score,
        actionType: "send_reengagement",
        crossAgentTypes: hasCancellations ? ["client_success"] : [],
        metadata: { email: u.email, hasCancellations, cancelCount, isVeryInactive },
      });
    }
  }

  // --- Expiring subscription signals ---
  for (const sub of expiringSubscriptions.slice(0, 5)) {
    const daysLeft = Math.ceil((sub.currentPeriodEnd!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    signals.push({
      signalType: "expiring_subscription",
      entityType: "subscription",
      entityId: sub.id,
      entityName: `Subscription #${sub.id.slice(0, 8)}`,
      title: "Subscription expiring soon",
      description: `Subscription expires in ${daysLeft} days — risk of lapsing`,
      severity: daysLeft <= 7 ? "high" : "medium",
      score: daysLeft <= 7 ? 72 : 55,
      metadata: { daysLeft, userId: sub.userId, planId: sub.planId },
    });

    recommendations.push({
      title: "Prompt subscription renewal",
      description: `Subscription expires in ${daysLeft} days — reach out now to secure renewal.`,
      reason: `Client's subscription expires ${daysLeft <= 3 ? "imminently" : "soon"} — proactive renewal outreach reduces churn.`,
      entityType: "subscription",
      entityId: sub.id,
      entityName: `Subscription #${sub.id.slice(0, 8)}`,
      severity: daysLeft <= 7 ? "high" : "medium",
      estimatedImpact: 20000,
      priorityScore: daysLeft <= 7 ? 72 : 55,
      actionType: "renewal_outreach",
      crossAgentTypes: [],
      metadata: { daysLeft, userId: sub.userId },
    });
  }

  return {
    signals,
    recommendations,
    summary: {
      inactiveClients: inactiveUsers.length,
      churnRisks: inactiveUsers.filter((_, i) => signals[i]?.severity === "critical" || signals[i]?.severity === "high").length,
      expiringSubscriptions: expiringSubscriptions.length,
      cancelledRecently: cancelledSet.size,
    },
  };
}
