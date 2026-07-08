/**
 * Readiness Service — Phase 9
 * ────────────────────────────
 * Three deterministic readiness helpers:
 *   computeBillingReadiness  — Is the athlete financially set up?
 *   computeWaiverReadiness   — Has the required waiver been completed?
 *   computeOperationalReadiness — Can the athlete begin training?
 *
 * All helpers are pure-async, no AI, no inference.
 * Returns explicit "not configured" / "unknown" instead of fabricating data.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillingReadiness {
  ready: boolean;
  stripeCustomerExists: boolean;
  activeMembership: boolean;
  packageAssigned: boolean;
  paymentMethodOnFile: boolean;
  outstandingBalance: number;
  reason?: string;
}

export interface WaiverReadiness {
  required: boolean;
  signed: boolean;
  signedAt?: string;
  expiresAt?: string;
  reason?: string;
}

export interface OperationalReadiness {
  readyToTrain: boolean;
  blockingItems: string[];
  warnings: string[];
  readinessScore: number;
}

export type EnrichedReadinessState =
  | "needs_onboarding"
  | "needs_billing"
  | "needs_waiver"
  | "needs_program"
  | "needs_first_session"
  | "ready_to_train"
  | "actively_training";

export interface ReadinessBundle {
  billingReadiness: BillingReadiness;
  waiverReadiness: WaiverReadiness;
  operationalReadiness: OperationalReadiness;
  readinessState: EnrichedReadinessState;
  readinessScore: number;
}

// ─── Billing readiness ────────────────────────────────────────────────────────

export async function computeBillingReadiness(
  orgId: string,
  athleteUserId: string,
  checklistRow?: {
    paymentSetup?: boolean;
  }
): Promise<BillingReadiness> {
  let stripeCustomerExists = false;
  let activeMembership = false;
  let packageAssigned = false;
  let paymentMethodOnFile = checklistRow?.paymentSetup ?? false;
  let outstandingBalance = 0;

  try {
    const { db } = await import("../db");
    const { userSubscriptions, creditLedgerEvents } = await import("@shared/schema");
    const { users: usersTable } = await import("@shared/models/auth");
    const { eq, and, gt } = await import("drizzle-orm");

    // Stripe customer ID
    const [userRow] = await db.select({
      stripeCustomerId: usersTable.stripeCustomerId,
      balanceCents: usersTable.balanceCents,
    })
    .from(usersTable)
    .where(eq(usersTable.id, athleteUserId))
    .limit(1);

    if (userRow) {
      stripeCustomerExists = !!userRow.stripeCustomerId;
      outstandingBalance = userRow.balanceCents ?? 0;
    }

    // Active subscription
    const [sub] = await db.select({ id: userSubscriptions.id, status: userSubscriptions.status })
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.userId, athleteUserId),
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "active"),
      ))
      .limit(1);
    activeMembership = !!sub;

    // Package credits (any positive-balance credit event)
    const [creditRow] = await db.select({ id: creditLedgerEvents.id })
      .from(creditLedgerEvents)
      .where(and(
        eq(creditLedgerEvents.userId, athleteUserId),
        eq(creditLedgerEvents.orgId, orgId),
        gt(creditLedgerEvents.creditDelta, 0),
      ))
      .limit(1);
    packageAssigned = !!creditRow;

  } catch (err: any) {
    console.warn("[readiness] computeBillingReadiness:", err.message);
  }

  const ready = paymentMethodOnFile || activeMembership || packageAssigned;

  let reason: string | undefined;
  if (!ready) {
    if (!stripeCustomerExists) {
      reason = "No Stripe customer record — billing integration not yet configured for this athlete";
    } else if (!activeMembership && !packageAssigned && !paymentMethodOnFile) {
      reason = "No active membership, package, or payment method on file";
    }
  }

  return { ready, stripeCustomerExists, activeMembership, packageAssigned, paymentMethodOnFile, outstandingBalance, reason };
}

// ─── Waiver readiness ─────────────────────────────────────────────────────────

export async function computeWaiverReadiness(
  orgId: string,
  athleteUserId: string,
  checklistRow?: {
    waiverCompleted?: boolean;
  }
): Promise<WaiverReadiness> {
  // No dedicated waiver platform — waiver tracking is manual via the onboarding checklist.
  // required: false until a waiver platform is integrated.
  const signed = checklistRow?.waiverCompleted ?? false;

  return {
    required: false,
    signed,
    signedAt: undefined,
    expiresAt: undefined,
    reason: signed
      ? "Waiver marked complete via onboarding checklist"
      : "Waiver tracking is manual — mark waiver_completed on the onboarding checklist when the athlete signs",
  };
}

// ─── Operational readiness ────────────────────────────────────────────────────

export interface ChecklistSnapshot {
  accountInviteSent: boolean;
  welcomeDraftApproved: boolean;
  pailContextSeeded: boolean;
  guardianLinked: boolean;
  programAssigned: boolean;
  firstSessionScheduled: boolean;
  firstSessionCompleted: boolean;
  paymentSetup: boolean;
  waiverCompleted: boolean;
  parentEmail?: string | null;
}

export function computeOperationalReadiness(
  snapshot: ChecklistSnapshot,
  billing: BillingReadiness,
  waiver: WaiverReadiness
): OperationalReadiness {
  const blockingItems: string[] = [];
  const warnings: string[] = [];

  // Blocking items — prevent training
  if (!snapshot.accountInviteSent) blockingItems.push("Account invite not yet sent");
  if (!snapshot.programAssigned) blockingItems.push("No training program assigned");
  if (!snapshot.firstSessionScheduled) blockingItems.push("First session not scheduled");
  if (!billing.ready) blockingItems.push("Billing not set up — payment method, membership, or package required");
  if (waiver.required && !waiver.signed) blockingItems.push("Required waiver not signed");

  // Warnings — should be done but don't block
  if (!snapshot.welcomeDraftApproved) warnings.push("Welcome email not yet approved");
  if (!snapshot.pailContextSeeded) warnings.push("PAIL athlete intelligence not seeded");
  if (snapshot.parentEmail && !snapshot.guardianLinked) warnings.push("Parent email on file but guardian not linked");
  if (!snapshot.waiverCompleted) warnings.push("Waiver not marked as completed");
  if (billing.outstandingBalance < 0) warnings.push(`Outstanding balance: $${Math.abs(billing.outstandingBalance / 100).toFixed(2)}`);

  const readyToTrain = snapshot.programAssigned && snapshot.firstSessionScheduled && (billing.ready || !billing.stripeCustomerExists);

  // Score (deterministic, 0–100)
  let score = 0;
  if (snapshot.accountInviteSent) score += 10;
  if (snapshot.welcomeDraftApproved) score += 8;
  if (snapshot.pailContextSeeded) score += 5;
  if (snapshot.guardianLinked || !snapshot.parentEmail) score += 5;
  if (snapshot.programAssigned) score += 20;
  if (snapshot.firstSessionScheduled) score += 20;
  if (snapshot.paymentSetup || billing.activeMembership || billing.packageAssigned) score += 20;
  if (snapshot.waiverCompleted) score += 7;
  if (snapshot.firstSessionCompleted) score += 5;
  // Maximum = 100

  return { readyToTrain, blockingItems, warnings, readinessScore: Math.min(100, score) };
}

// ─── Enriched readiness state ─────────────────────────────────────────────────

export function computeEnrichedReadinessState(
  snapshot: ChecklistSnapshot,
  billing: BillingReadiness,
  waiver: WaiverReadiness
): EnrichedReadinessState {
  if (snapshot.firstSessionCompleted) return "actively_training";
  if (!snapshot.accountInviteSent) return "needs_onboarding";
  if (!snapshot.programAssigned) return "needs_program";
  if (!snapshot.firstSessionScheduled) return "needs_first_session";
  if (!billing.ready) return "needs_billing";
  if (waiver.required && !waiver.signed) return "needs_waiver";
  return "ready_to_train";
}

// ─── Bundle helper (for use in route handlers) ────────────────────────────────

export async function computeReadinessBundle(
  orgId: string,
  athleteUserId: string,
  snapshot: ChecklistSnapshot
): Promise<ReadinessBundle> {
  const [billing, waiver] = await Promise.all([
    computeBillingReadiness(orgId, athleteUserId, snapshot),
    computeWaiverReadiness(orgId, athleteUserId, snapshot),
  ]);
  const operational = computeOperationalReadiness(snapshot, billing, waiver);
  const readinessState = computeEnrichedReadinessState(snapshot, billing, waiver);

  return {
    billingReadiness: billing,
    waiverReadiness: waiver,
    operationalReadiness: operational,
    readinessState,
    readinessScore: operational.readinessScore,
  };
}

// ─── Org-wide readiness summary ───────────────────────────────────────────────

export interface OrgReadinessSummary {
  totalAthletes: number;
  readyToTrain: number;
  activelyTraining: number;
  needsBilling: number;
  needsWaiver: number;
  operationallyBlocked: number;
  needsProgram: number;
  needsFirstSession: number;
  needsOnboarding: number;
  averageReadinessScore: number;
  readinessDistribution: { state: EnrichedReadinessState; count: number }[];
  estimatedRevenueAtRiskCents: number;
}

export async function computeOrgReadinessSummary(orgId: string): Promise<OrgReadinessSummary> {
  try {
    const { db } = await import("../db");
    const { athleteOnboardingChecklists, userSubscriptions } = await import("@shared/schema");
    const { users: usersTable } = await import("@shared/models/auth");
    const { eq, and } = await import("drizzle-orm");

    // Fetch all checklists for org
    const rows = await db.select({
      athleteUserId: athleteOnboardingChecklists.athleteUserId,
      accountInviteSent: athleteOnboardingChecklists.accountInviteSent,
      welcomeDraftApproved: athleteOnboardingChecklists.welcomeDraftApproved,
      pailContextSeeded: athleteOnboardingChecklists.pailContextSeeded,
      guardianLinked: athleteOnboardingChecklists.guardianLinked,
      programAssigned: athleteOnboardingChecklists.programAssigned,
      firstSessionScheduled: athleteOnboardingChecklists.firstSessionScheduled,
      firstSessionCompleted: athleteOnboardingChecklists.firstSessionCompleted,
      paymentSetup: athleteOnboardingChecklists.paymentSetup,
      waiverCompleted: athleteOnboardingChecklists.waiverCompleted,
    })
    .from(athleteOnboardingChecklists)
    .where(eq(athleteOnboardingChecklists.orgId, orgId));

    if (rows.length === 0) {
      return { totalAthletes: 0, readyToTrain: 0, activelyTraining: 0, needsBilling: 0, needsWaiver: 0, operationallyBlocked: 0, needsProgram: 0, needsFirstSession: 0, needsOnboarding: 0, averageReadinessScore: 0, readinessDistribution: [], estimatedRevenueAtRiskCents: 0 };
    }

    // Batch-check active subscriptions for all athletes
    const athleteIds = rows.map(r => r.athleteUserId);
    const activeSubs = await db.select({ userId: userSubscriptions.userId })
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "active"),
      ));
    const activeSubSet = new Set(activeSubs.map(s => s.userId));

    // Batch-check Stripe customer IDs
    const { sql } = await import("drizzle-orm");
    const stripeUsers = athleteIds.length > 0
      ? await db.select({ id: usersTable.id, stripeCustomerId: usersTable.stripeCustomerId })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(athleteIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
      : [];
    const stripeMap = new Set(stripeUsers.filter(u => u.stripeCustomerId).map(u => u.id));

    // Compute state for each athlete
    const distribution = new Map<EnrichedReadinessState, number>();
    let totalScore = 0;
    let blockedByBilling = 0;
    let blockedByWaiver = 0;
    let blockedOperationally = 0;

    for (const row of rows) {
      const hasActiveSub = activeSubSet.has(row.athleteUserId);
      const hasStripe = stripeMap.has(row.athleteUserId);

      const billing: BillingReadiness = {
        ready: row.paymentSetup || hasActiveSub,
        stripeCustomerExists: hasStripe,
        activeMembership: hasActiveSub,
        packageAssigned: false,
        paymentMethodOnFile: row.paymentSetup,
        outstandingBalance: 0,
      };
      const waiver: WaiverReadiness = { required: false, signed: row.waiverCompleted };

      const snapshot: ChecklistSnapshot = {
        accountInviteSent: row.accountInviteSent,
        welcomeDraftApproved: row.welcomeDraftApproved,
        pailContextSeeded: row.pailContextSeeded,
        guardianLinked: row.guardianLinked,
        programAssigned: row.programAssigned,
        firstSessionScheduled: row.firstSessionScheduled,
        firstSessionCompleted: row.firstSessionCompleted,
        paymentSetup: row.paymentSetup,
        waiverCompleted: row.waiverCompleted,
        parentEmail: null,
      };

      const state = computeEnrichedReadinessState(snapshot, billing, waiver);
      const { readinessScore } = computeOperationalReadiness(snapshot, billing, waiver);

      distribution.set(state, (distribution.get(state) ?? 0) + 1);
      totalScore += readinessScore;

      if (state === "needs_billing") blockedByBilling++;
      if (state === "needs_waiver") blockedByWaiver++;
      if (state !== "actively_training" && state !== "ready_to_train") {
        if (!row.programAssigned || !row.firstSessionScheduled) blockedOperationally++;
      }
    }

    const readinessDistribution: { state: EnrichedReadinessState; count: number }[] =
      (["actively_training", "ready_to_train", "needs_first_session", "needs_program", "needs_billing", "needs_waiver", "needs_onboarding"] as const).map(s => ({
        state: s,
        count: distribution.get(s) ?? 0,
      }));

    return {
      totalAthletes: rows.length,
      readyToTrain: distribution.get("ready_to_train") ?? 0,
      activelyTraining: distribution.get("actively_training") ?? 0,
      needsBilling: blockedByBilling,
      needsWaiver: blockedByWaiver,
      operationallyBlocked: blockedOperationally,
      needsProgram: distribution.get("needs_program") ?? 0,
      needsFirstSession: distribution.get("needs_first_session") ?? 0,
      needsOnboarding: distribution.get("needs_onboarding") ?? 0,
      averageReadinessScore: rows.length > 0 ? Math.round(totalScore / rows.length) : 0,
      readinessDistribution,
      estimatedRevenueAtRiskCents: blockedByBilling * 150_00,
    };
  } catch (err: any) {
    console.warn("[readiness] computeOrgReadinessSummary error:", err.message);
    return { totalAthletes: 0, readyToTrain: 0, activelyTraining: 0, needsBilling: 0, needsWaiver: 0, operationallyBlocked: 0, needsProgram: 0, needsFirstSession: 0, needsOnboarding: 0, averageReadinessScore: 0, readinessDistribution: [], estimatedRevenueAtRiskCents: 0 };
  }
}
