/**
 * Athlete Onboarding Alerts — Central Alert Service
 * ─────────────────────────────────────────────────
 * Pure computation of onboarding risk alerts from checklist state.
 * No side effects. Reused by:
 *   - GET /api/admin/athlete-onboarding (per-record alerts)
 *   - GET /api/admin/athlete-onboarding/alerts (flat list)
 *   - syncAttentionItems() (attention inbox)
 *   - buildPriorityList() in CEO Heartbeat
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OnboardingAlertType =
  | "welcome_draft_stuck"
  | "first_session_missing"
  | "program_missing"
  | "guardian_missing"
  | "onboarding_stuck";

export type OnboardingAlertSeverity = "critical" | "high" | "medium" | "low";

export interface OnboardingAlertRecord {
  id: string;
  athleteUserId: string;
  athleteName: string;
  leadSubmissionId: string | null;
  parentEmail: string | null;
  guardianLinked: boolean;
  accountInviteSent: boolean;
  welcomeDraftQueued: boolean;
  welcomeDraftApproved: boolean;
  pailContextSeeded: boolean;
  firstSessionScheduled: boolean;
  programAssigned: boolean;
  paymentSetup: boolean;
  waiverCompleted: boolean;
  firstSessionCompleted: boolean;
  status: "pending" | "in_progress" | "complete";
  createdAt: string | null;
}

export interface OnboardingAlert {
  key: string;
  type: OnboardingAlertType;
  severity: OnboardingAlertSeverity;
  title: string;
  message: string;
  athleteUserId: string;
  athleteName: string;
  checklistId: string;
  leadSubmissionId: string | null;
  ageHours: number;
  ageDays: number;
  actionLabel: string;
  actionUrl: string;
  createdAt: string | null;
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function severityOrder(s: OnboardingAlertSeverity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s];
}

export function highestSeverity(alerts: OnboardingAlert[]): OnboardingAlertSeverity | null {
  if (alerts.length === 0) return null;
  return alerts.reduce((best, a) =>
    severityOrder(a.severity) > severityOrder(best) ? a.severity : best,
    alerts[0].severity
  );
}

// ─── Pure alert computation ───────────────────────────────────────────────────

export function computeOnboardingAlerts(record: OnboardingAlertRecord): OnboardingAlert[] {
  // Complete records have no alerts
  if (record.status === "complete") return [];

  const now = Date.now();
  const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : now;
  const ageHours = (now - createdAt) / 3600000;
  const ageDays = ageHours / 24;

  const alerts: OnboardingAlert[] = [];

  // ── 1. Welcome Draft Stuck ─────────────────────────────────────────────────
  if (record.welcomeDraftQueued && !record.welcomeDraftApproved && ageHours >= 24) {
    const severity: OnboardingAlertSeverity = ageHours >= 72 ? "high" : "medium";
    alerts.push({
      key: `onboarding:welcome_draft_stuck:${record.id}`,
      type: "welcome_draft_stuck",
      severity,
      title: "Welcome draft not approved",
      message: `Welcome draft has not been approved for ${record.athleteName}.`,
      athleteUserId: record.athleteUserId,
      athleteName: record.athleteName,
      checklistId: record.id,
      leadSubmissionId: record.leadSubmissionId,
      ageHours: Math.round(ageHours),
      ageDays: Math.round(ageDays * 10) / 10,
      actionLabel: "Review Draft",
      actionUrl: "/admin/ai-approvals",
      createdAt: record.createdAt,
    });
  }

  // ── 2. First Session Not Scheduled ────────────────────────────────────────
  if (!record.firstSessionScheduled && ageHours >= 24) {
    const severity: OnboardingAlertSeverity = ageHours >= 72 ? "critical" : "high";
    alerts.push({
      key: `onboarding:first_session_missing:${record.id}`,
      type: "first_session_missing",
      severity,
      title: "First session not scheduled",
      message: `First session has not been scheduled for ${record.athleteName}.`,
      athleteUserId: record.athleteUserId,
      athleteName: record.athleteName,
      checklistId: record.id,
      leadSubmissionId: record.leadSubmissionId,
      ageHours: Math.round(ageHours),
      ageDays: Math.round(ageDays * 10) / 10,
      actionLabel: "Schedule Session",
      actionUrl: "/admin/scheduling-command-center",
      createdAt: record.createdAt,
    });
  }

  // ── 3. Program Not Assigned ───────────────────────────────────────────────
  if (!record.programAssigned && ageHours >= 24) {
    const severity: OnboardingAlertSeverity = ageHours >= 72 ? "high" : "medium";
    alerts.push({
      key: `onboarding:program_missing:${record.id}`,
      type: "program_missing",
      severity,
      title: "Training program not assigned",
      message: `No training program has been assigned to ${record.athleteName}.`,
      athleteUserId: record.athleteUserId,
      athleteName: record.athleteName,
      checklistId: record.id,
      leadSubmissionId: record.leadSubmissionId,
      ageHours: Math.round(ageHours),
      ageDays: Math.round(ageDays * 10) / 10,
      actionLabel: "Assign Program",
      actionUrl: "/admin/athlete-onboarding",
      createdAt: record.createdAt,
    });
  }

  // ── 4. Guardian Missing ───────────────────────────────────────────────────
  if (record.parentEmail && !record.guardianLinked && ageHours >= 24) {
    alerts.push({
      key: `onboarding:guardian_missing:${record.id}`,
      type: "guardian_missing",
      severity: "medium",
      title: "Guardian not linked",
      message: `Parent/guardian account has not been linked for ${record.athleteName}.`,
      athleteUserId: record.athleteUserId,
      athleteName: record.athleteName,
      checklistId: record.id,
      leadSubmissionId: record.leadSubmissionId,
      ageHours: Math.round(ageHours),
      ageDays: Math.round(ageDays * 10) / 10,
      actionLabel: "Link Guardian",
      actionUrl: "/admin/athlete-onboarding",
      createdAt: record.createdAt,
    });
  }

  // ── 5. Onboarding Stuck ───────────────────────────────────────────────────
  if (ageHours >= 72) {
    const severity: OnboardingAlertSeverity = ageHours >= 168 ? "critical" : "high";
    const daysLabel = Math.round(ageDays);
    alerts.push({
      key: `onboarding:onboarding_stuck:${record.id}`,
      type: "onboarding_stuck",
      severity,
      title: "Onboarding has been open too long",
      message: `Onboarding has been open for ${daysLabel} day${daysLabel !== 1 ? "s" : ""} for ${record.athleteName}.`,
      athleteUserId: record.athleteUserId,
      athleteName: record.athleteName,
      checklistId: record.id,
      leadSubmissionId: record.leadSubmissionId,
      ageHours: Math.round(ageHours),
      ageDays: Math.round(ageDays * 10) / 10,
      actionLabel: "View Onboarding",
      actionUrl: "/admin/athlete-onboarding",
      createdAt: record.createdAt,
    });
  }

  // Deduplicate by type (one per type per checklist — guaranteed by key design)
  return alerts;
}

// ─── Org-wide async computation (for attention engine + heartbeat) ────────────

/**
 * Fetch all onboarding checklists for an org and compute active alerts.
 * Fails open — returns [] on error.
 */
export async function computeOnboardingAlertsForOrg(orgId: string): Promise<OnboardingAlert[]> {
  try {
    const { db } = await import("../db");
    const { athleteOnboardingChecklists, leadCaptureSubmissions } = await import("@shared/schema");
    const { users: usersTable } = await import("@shared/models/auth");
    const { eq } = await import("drizzle-orm");

    const rows = await db.select({
      id: athleteOnboardingChecklists.id,
      athleteUserId: athleteOnboardingChecklists.athleteUserId,
      leadSubmissionId: athleteOnboardingChecklists.leadSubmissionId,
      accountInviteSent: athleteOnboardingChecklists.accountInviteSent,
      welcomeDraftQueued: athleteOnboardingChecklists.welcomeDraftQueued,
      welcomeDraftApproved: athleteOnboardingChecklists.welcomeDraftApproved,
      pailContextSeeded: athleteOnboardingChecklists.pailContextSeeded,
      guardianLinked: athleteOnboardingChecklists.guardianLinked,
      firstSessionScheduled: athleteOnboardingChecklists.firstSessionScheduled,
      programAssigned: athleteOnboardingChecklists.programAssigned,
      paymentSetup: athleteOnboardingChecklists.paymentSetup,
      waiverCompleted: athleteOnboardingChecklists.waiverCompleted,
      firstSessionCompleted: athleteOnboardingChecklists.firstSessionCompleted,
      status: athleteOnboardingChecklists.status,
      createdAt: athleteOnboardingChecklists.createdAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      parentEmail: leadCaptureSubmissions.parentEmail,
    })
    .from(athleteOnboardingChecklists)
    .leftJoin(usersTable, eq(usersTable.id, athleteOnboardingChecklists.athleteUserId))
    .leftJoin(leadCaptureSubmissions, eq(leadCaptureSubmissions.id, athleteOnboardingChecklists.leadSubmissionId))
    .where(eq(athleteOnboardingChecklists.orgId, orgId));

    const allAlerts: OnboardingAlert[] = [];
    for (const row of rows) {
      const athleteName = `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.email || "Unknown Athlete";
      const record: OnboardingAlertRecord = {
        id: row.id,
        athleteUserId: row.athleteUserId,
        athleteName,
        leadSubmissionId: row.leadSubmissionId,
        parentEmail: (row as any).parentEmail || null,
        guardianLinked: row.guardianLinked,
        accountInviteSent: row.accountInviteSent,
        welcomeDraftQueued: row.welcomeDraftQueued,
        welcomeDraftApproved: row.welcomeDraftApproved,
        pailContextSeeded: row.pailContextSeeded,
        firstSessionScheduled: row.firstSessionScheduled,
        programAssigned: row.programAssigned,
        paymentSetup: row.paymentSetup,
        waiverCompleted: row.waiverCompleted,
        firstSessionCompleted: row.firstSessionCompleted,
        status: row.status as "pending" | "in_progress" | "complete",
        createdAt: row.createdAt?.toISOString() || null,
      };
      allAlerts.push(...computeOnboardingAlerts(record));
    }

    return allAlerts;
  } catch (err: any) {
    console.warn("[OnboardingAlerts] computeOnboardingAlertsForOrg error:", err.message);
    return [];
  }
}

// ─── Summary stats helper ─────────────────────────────────────────────────────

export interface OnboardingAlertSummary {
  alertsTotal: number;
  criticalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  stuckOnboardingCount: number;
}

export function computeAlertSummary(recordAlerts: { alerts: OnboardingAlert[]; highestSeverity: OnboardingAlertSeverity | null }[]): OnboardingAlertSummary {
  const allAlerts = recordAlerts.flatMap(r => r.alerts);
  return {
    alertsTotal: allAlerts.length,
    criticalAlerts: recordAlerts.filter(r => r.highestSeverity === "critical").length,
    highAlerts: recordAlerts.filter(r => r.highestSeverity === "high").length,
    mediumAlerts: recordAlerts.filter(r => r.highestSeverity === "medium").length,
    stuckOnboardingCount: allAlerts.filter(a => a.type === "onboarding_stuck").length,
  };
}
