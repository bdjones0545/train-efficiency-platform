/**
 * System-wide Event Types — Phase 4
 *
 * All events that flow through the TrainEfficiency intelligence network.
 * Every event has a structured payload, metadata, and a source system label.
 * Events are named using <domain>.<entity>.<action> convention.
 */

// ─── Base Event Envelope ─────────────────────────────────────────────────────

export interface EventMetadata {
  eventId: string;
  timestamp: string;
  sourceSystem: string;
  orgId: string;
  athleteUserId?: string;
  coachUserId?: string;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface SystemEvent<T = Record<string, unknown>> {
  type: EventType;
  meta: EventMetadata;
  payload: T;
}

// ─── Athlete Events ───────────────────────────────────────────────────────────

export interface AthleteReadinessUpdatedPayload {
  athleteUserId: string;
  athleteName: string;
  readinessScore: number;
  previousScore?: number;
  trend: "improving" | "declining" | "stable";
  daysLow?: number;
  contextSnapshotId?: string;
}

export interface AthleteComplianceDeclinedPayload {
  athleteUserId: string;
  athleteName: string;
  complianceRate: number;
  previousRate?: number;
  weeksDeclinig?: number;
  missedSessionCount?: number;
  contextSnapshotId?: string;
}

export interface AthleteRiskEscalatedPayload {
  athleteUserId: string;
  athleteName: string;
  riskLevel: "yellow" | "red";
  previousRiskLevel?: string;
  triggerSignals: string[];
  priorityScore?: number;
  contextSnapshotId?: string;
}

export interface AthleteSessionCompletedPayload {
  athleteUserId: string;
  athleteName: string;
  sessionId: string;
  rpe?: number;
  completionRate?: number;
  notesPresent?: boolean;
}

export interface AthleteSessionMissedPayload {
  athleteUserId: string;
  athleteName: string;
  sessionId?: string;
  consecutiveMissed?: number;
  lastCompletedAt?: string;
}

export interface AthletePainReportedPayload {
  athleteUserId: string;
  athleteName: string;
  painLocation?: string;
  severity?: number;
  reportedAt: string;
  sessionId?: string;
}

export interface AthleteInterventionCreatedPayload {
  athleteUserId: string;
  athleteName: string;
  interventionType: string;
  draftId: string;
  priorityScore: number;
  triggerSignals: string[];
  sourceSystem: string;
}

export interface AthleteInterventionApprovedPayload {
  athleteUserId: string;
  athleteName: string;
  interventionType: string;
  draftId: string;
  approvedBy: string;
  outcomeTrackingId?: string;
}

export interface AthleteInterventionFailedPayload {
  athleteUserId: string;
  athleteName: string;
  draftId: string;
  reason: string;
}

export interface AthleteEducationCompletedPayload {
  athleteUserId: string;
  athleteName: string;
  moduleId: string;
  moduleTitle: string;
  score?: number;
}

// ─── Escalation Events ────────────────────────────────────────────────────────

export interface AthleteEscalationTriggeredPayload {
  athleteUserId: string;
  athleteName: string;
  escalationLevel: 1 | 2 | 3 | 4;
  escalationReason: string;
  daysSinceFirstSignal: number;
  unresolvedSignals: string[];
  previousActions: string[];
}

// ─── Business / Org Events ────────────────────────────────────────────────────

export interface OrgRevenueDropDetectedPayload {
  orgId: string;
  currentMRR?: number;
  previousMRR?: number;
  dropPercent?: number;
  likelyCauses?: string[];
}

export interface OrgScheduleGapDetectedPayload {
  orgId: string;
  gapWindowStart: string;
  gapWindowEnd: string;
  affectedSessions?: number;
  affectedAthletes?: string[];
}

export interface OrgLeadHighValueDetectedPayload {
  orgId: string;
  leadId: string;
  leadName: string;
  estimatedValue?: number;
  engagementSignals?: string[];
}

export interface OrgRetentionRiskDetectedPayload {
  orgId: string;
  atRiskAthleteIds: string[];
  atRiskCount: number;
  riskFactors: string[];
  estimatedChurnRevenue?: number;
}

export interface OrgIntelligenceStateUpdatedPayload {
  orgId: string;
  overallHealthScore: number;
  criticalAthleteCount: number;
  unresolvedInterventions: number;
}

// ─── Coach Events ─────────────────────────────────────────────────────────────

export interface CoachOverloadedPayload {
  coachUserId: string;
  coachName: string;
  pendingInterventions: number;
  activeAthletes: number;
  criticalAthletes: number;
}

export interface CoachInterventionPendingPayload {
  coachUserId: string;
  athleteUserId: string;
  athleteName: string;
  interventionType: string;
  priorityScore: number;
  draftId: string;
  daysWaiting?: number;
}

export interface CoachFollowupRequiredPayload {
  coachUserId: string;
  athleteUserId: string;
  athleteName: string;
  followupReason: string;
  urgency: "low" | "medium" | "high" | "critical";
  suggestedActions: string[];
}

// ─── Daily Ops Events ─────────────────────────────────────────────────────────

export interface DailyOperationsBriefingGeneratedPayload {
  orgId: string;
  criticalAthleteCount: number;
  unresolvedInterventions: number;
  predictedChurnRisks: number;
  recommendedActionsCount: number;
  generatedAt: string;
}

// ─── Union Type ───────────────────────────────────────────────────────────────

export type EventType =
  | "athlete.readiness.updated"
  | "athlete.compliance.declined"
  | "athlete.risk.escalated"
  | "athlete.session.completed"
  | "athlete.session.missed"
  | "athlete.pain.reported"
  | "athlete.intervention.created"
  | "athlete.intervention.approved"
  | "athlete.intervention.failed"
  | "athlete.education.completed"
  | "athlete.escalation.triggered"
  | "org.revenue.drop.detected"
  | "org.schedule.gap.detected"
  | "org.lead.high_value.detected"
  | "org.retention.risk.detected"
  | "org.intelligence.state.updated"
  | "coach.overloaded"
  | "coach.intervention.pending"
  | "coach.followup.required"
  | "ops.daily.briefing.generated";

// Map event types to their payload types for type safety
export type EventPayloadMap = {
  "athlete.readiness.updated": AthleteReadinessUpdatedPayload;
  "athlete.compliance.declined": AthleteComplianceDeclinedPayload;
  "athlete.risk.escalated": AthleteRiskEscalatedPayload;
  "athlete.session.completed": AthleteSessionCompletedPayload;
  "athlete.session.missed": AthleteSessionMissedPayload;
  "athlete.pain.reported": AthletePainReportedPayload;
  "athlete.intervention.created": AthleteInterventionCreatedPayload;
  "athlete.intervention.approved": AthleteInterventionApprovedPayload;
  "athlete.intervention.failed": AthleteInterventionFailedPayload;
  "athlete.education.completed": AthleteEducationCompletedPayload;
  "athlete.escalation.triggered": AthleteEscalationTriggeredPayload;
  "org.revenue.drop.detected": OrgRevenueDropDetectedPayload;
  "org.schedule.gap.detected": OrgScheduleGapDetectedPayload;
  "org.lead.high_value.detected": OrgLeadHighValueDetectedPayload;
  "org.retention.risk.detected": OrgRetentionRiskDetectedPayload;
  "org.intelligence.state.updated": OrgIntelligenceStateUpdatedPayload;
  "coach.overloaded": CoachOverloadedPayload;
  "coach.intervention.pending": CoachInterventionPendingPayload;
  "coach.followup.required": CoachFollowupRequiredPayload;
  "ops.daily.briefing.generated": DailyOperationsBriefingGeneratedPayload;
};
