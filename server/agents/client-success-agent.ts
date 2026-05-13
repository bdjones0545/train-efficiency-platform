import { db } from "../db";
import { bookings, users, userProfiles } from "@shared/schema";
import { eq, and, gte, lte, lt, inArray, desc, sql } from "drizzle-orm";
import { subDays, subMonths, startOfMonth, endOfMonth } from "date-fns";

export interface ClientSuccessSignal {
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

export interface ClientSuccessRecommendation {
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

export interface ClientSuccessAgentResult {
  signals: ClientSuccessSignal[];
  recommendations: ClientSuccessRecommendation[];
  summary: {
    avgCompletionRate: number;
    lowAdherenceClients: number;
    highNoShowClients: number;
    totalClientsMonitored: number;
  };
}

export async function runClientSuccessAgent(orgId: string): Promise<ClientSuccessAgentResult> {
  const signals: ClientSuccessSignal[] = [];
  const recommendations: ClientSuccessRecommendation[] = [];
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);

  // --- Get org clients ---
  const clientProfiles = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(and(eq(userProfiles.organizationId, orgId), eq(userProfiles.role, "CLIENT")));

  const clientIds = clientProfiles.map((p) => p.userId);
  if (clientIds.length === 0) {
    return {
      signals,
      recommendations,
      summary: { avgCompletionRate: 0, lowAdherenceClients: 0, highNoShowClients: 0, totalClientsMonitored: 0 },
    };
  }

  // --- Get all bookings for the last 30 days ---
  const recentBookings = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      status: bookings.status,
      startAt: bookings.startAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, thirtyDaysAgo),
        lte(bookings.startAt, now),
        inArray(bookings.clientId, clientIds)
      )
    );

  // --- Aggregate per client ---
  const clientStats: Record<
    string,
    { completed: number; cancelled: number; noShow: number; total: number }
  > = {};

  for (const b of recentBookings) {
    if (!b.clientId) continue;
    if (!clientStats[b.clientId]) clientStats[b.clientId] = { completed: 0, cancelled: 0, noShow: 0, total: 0 };
    clientStats[b.clientId].total++;
    if (b.status === "COMPLETED") clientStats[b.clientId].completed++;
    else if (b.status === "CANCELLED") clientStats[b.clientId].cancelled++;
    else if (b.status === "NO_SHOW") clientStats[b.clientId].noShow++;
  }

  // --- Find low adherence clients (completion rate < 60%) ---
  const lowAdherenceIds = Object.entries(clientStats)
    .filter(([, s]) => s.total >= 2 && s.completed / s.total < 0.6)
    .map(([id]) => id);

  const highNoShowIds = Object.entries(clientStats)
    .filter(([, s]) => s.noShow >= 2)
    .map(([id]) => id);

  const problematicIds = [...new Set([...lowAdherenceIds, ...highNoShowIds])];

  if (problematicIds.length > 0) {
    const problematicUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(inArray(users.id, problematicIds.slice(0, 10)));

    for (const u of problematicUsers) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
      const stats = clientStats[u.id];
      if (!stats) continue;

      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      const isLowAdherence = lowAdherenceIds.includes(u.id);
      const isHighNoShow = highNoShowIds.includes(u.id);

      const severity: "critical" | "high" | "medium" | "low" =
        completionRate < 40 || stats.noShow >= 3 ? "high" : "medium";

      signals.push({
        signalType: isHighNoShow ? "high_no_show" : "low_adherence",
        entityType: "client",
        entityId: u.id,
        entityName: name,
        title: `${name}: ${completionRate}% session completion`,
        description: `${stats.completed} completed, ${stats.cancelled} cancelled, ${stats.noShow} no-show out of ${stats.total} sessions in 30 days`,
        severity,
        score: 60 + (100 - completionRate) * 0.3,
        metadata: { completionRate, ...stats, email: u.email },
      });

      if (severity === "high") {
        recommendations.push({
          title: `Check in with ${name}`,
          description: `${name} has a ${completionRate}% session completion rate with ${stats.noShow} no-show(s). A personal check-in could uncover barriers to attendance.`,
          reason: `Low adherence and high no-shows are early indicators of churn. Proactive outreach improves retention by 40%.`,
          entityType: "client",
          entityId: u.id,
          entityName: name,
          severity,
          estimatedImpact: 12000,
          priorityScore: 60 + (100 - completionRate) * 0.3,
          actionType: "client_checkin",
          crossAgentTypes: ["retention"],
          metadata: { completionRate, ...stats, email: u.email },
        });
      }
    }
  }

  // --- Overall completion rate signal ---
  const allStats = Object.values(clientStats);
  const totalCompleted = allStats.reduce((s, v) => s + v.completed, 0);
  const totalBooked = allStats.reduce((s, v) => s + v.total, 0);
  const avgCompletionRate = totalBooked > 0 ? Math.round((totalCompleted / totalBooked) * 100) : 0;

  if (avgCompletionRate < 70 && totalBooked >= 5) {
    signals.push({
      signalType: "low_overall_completion",
      entityType: "org",
      entityId: orgId,
      entityName: "Overall Completion Rate",
      title: `Overall session completion at ${avgCompletionRate}%`,
      description: `${totalCompleted} of ${totalBooked} sessions completed across all clients in the last 30 days`,
      severity: avgCompletionRate < 50 ? "high" : "medium",
      score: 60 + (70 - avgCompletionRate) * 0.5,
      metadata: { avgCompletionRate, totalCompleted, totalBooked },
    });
  }

  return {
    signals,
    recommendations,
    summary: {
      avgCompletionRate,
      lowAdherenceClients: lowAdherenceIds.length,
      highNoShowClients: highNoShowIds.length,
      totalClientsMonitored: Object.keys(clientStats).length,
    },
  };
}
